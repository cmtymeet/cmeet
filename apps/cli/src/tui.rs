//! Terminal presentation of the one owner registry and real owner responses.
use crate::runtime;
use cmsg::door::{ActionDescription, ErrorCode, Output, catalog, native::Client};
use crossterm::event::{Event, EventStream, KeyCode, KeyEventKind, KeyModifiers};
use futures::{Stream, StreamExt};
use ratatui::{Frame, Terminal, backend::Backend, layout::{Constraint, Layout}, widgets::{Block, List, ListState, Paragraph, Wrap}};
use std::{io, io::IsTerminal};
use tokio_util::sync::CancellationToken;

pub struct View {
    actions: Vec<ActionDescription>,
    selection: usize,
    body: String,
    result: String,
    exit_code: u8,
}
impl Default for View {
    fn default() -> Self {
        Self { actions: catalog(), selection: 0, body: "{}".into(),
            result: "No action invoked. Runtime readiness is unknown.".into(), exit_code: 0 }
    }
}
impl View {
    pub fn draw(&self, frame: &mut Frame) {
        let [commands, body, result, help] = Layout::vertical([
            Constraint::Length(7), Constraint::Length(5), Constraint::Min(3), Constraint::Length(2),
        ]).areas(frame.area());
        let list = List::new(self.actions.iter().map(|action| format!("{} (v{})", action.action, action.version)))
            .block(Block::bordered().title("cmsg commands")).highlight_symbol("> ");
        frame.render_stateful_widget(list, commands, &mut ListState::default().with_selected(Some(self.selection)));
        // JSON text remains escaped; raw terminal control sequences never render.
        let body_text = serde_json::to_string(&self.body).expect("string JSON");
        frame.render_widget(Paragraph::new(body_text).block(Block::bordered().title("Raw JSON body")).wrap(Wrap { trim: false }), body);
        frame.render_widget(Paragraph::new(self.result.as_str()).block(Block::bordered().title("Owner Output / events")).wrap(Wrap { trim: false }), result);
        frame.render_widget(Paragraph::new("Up/Down select | type body | Ctrl-U clear | Enter invoke\nEsc/Ctrl-C exit | No retries after cancellation or I/O failure"), help);
    }

    pub fn event(&mut self, event: Event) -> Intent {
        let Event::Key(key) = event else { return Intent::Draw; };
        if key.kind == KeyEventKind::Release { return Intent::Draw; }
        match (key.code, key.modifiers) {
            (KeyCode::Esc, _) | (KeyCode::Char('c'), KeyModifiers::CONTROL) => Intent::Exit,
            (KeyCode::Up, _) => { self.selection = self.selection.saturating_sub(1); Intent::Draw }
            (KeyCode::Down, _) => { self.selection = (self.selection + 1).min(self.actions.len().saturating_sub(1)); Intent::Draw }
            (KeyCode::Char('u'), KeyModifiers::CONTROL) => { self.body.clear(); Intent::Draw }
            (KeyCode::Backspace, _) => { self.body.pop(); Intent::Draw }
            (KeyCode::Char(c), KeyModifiers::NONE | KeyModifiers::SHIFT) => {
                if !c.is_control() && self.body.len() + c.len_utf8() <= cmsg::door::MAX_BODY_BYTES { self.body.push(c); }
                Intent::Draw
            }
            (KeyCode::Enter, _) => Intent::Invoke,
            _ => Intent::Draw,
        }
    }

    pub fn invocation(&self) -> Result<Vec<u8>, ErrorCode> {
        let action = self.actions.get(self.selection).ok_or(ErrorCode::Unavailable)?;
        // RawValue validates syntax, retaining duplicate fields for cmsg to reject.
        let raw: &serde_json::value::RawValue = serde_json::from_str(&self.body).map_err(|_| ErrorCode::InvalidRequest)?;
        let name = serde_json::to_string(&action.action).expect("string JSON");
        Ok(format!("{{\"action\":{name},\"version\":{},\"body\":{raw}}}", action.version).into_bytes())
    }

    pub fn complete(&mut self, output: &Output) {
        self.exit_code = runtime::exit_code(output);
        self.result = serde_json::to_string_pretty(output).expect("owner JSON");
        const DISPLAY_LIMIT: usize = 64 * 1024;
        if self.result.len() > DISPLAY_LIMIT {
            let mut end = DISPLAY_LIMIT;
            while !self.result.is_char_boundary(end) { end -= 1; }
            self.result.truncate(end);
            self.result.push_str("\n[Display truncated; cmeet invoke emits the complete owner Output.]");
        }
    }
}
#[derive(PartialEq, Eq, Debug)]
pub enum Intent { Draw, Invoke, Exit }

/// One operation at a time. Esc/Ctrl-C during a call ends with the owner's
/// Reconcile code: dropping a request cannot establish whether an effect ran.
pub async fn session<B: Backend, E: Stream<Item = io::Result<Event>> + Unpin>(
    client: &Client, terminal: &mut Terminal<B>, mut events: E, cancel: CancellationToken,
) -> Result<u8, ErrorCode> {
    let mut view = View::default();
    loop {
        terminal.draw(|frame| view.draw(frame)).map_err(|_| ErrorCode::Unavailable)?;
        let event = tokio::select! {
            _ = cancel.cancelled() => return Err(ErrorCode::Reconcile),
            event = events.next() => event.ok_or(ErrorCode::Unavailable)?.map_err(|_| ErrorCode::Unavailable)?,
        };
        match view.event(event) {
            Intent::Exit => return Ok(view.exit_code),
            Intent::Draw => (),
            Intent::Invoke => {
                let output = match view.invocation() {
                    Err(error) => Output::Error { error },
                    Ok(bytes) => {
                        view.result = "Waiting for owner response. Outcome unknown.".into();
                        terminal.draw(|frame| view.draw(frame)).map_err(|_| ErrorCode::Unavailable)?;
                        let operation = runtime::invoke(client, &bytes);
                        tokio::pin!(operation);
                        loop {
                            tokio::select! {
                                _ = cancel.cancelled() => return Err(ErrorCode::Reconcile),
                                output = &mut operation => break output,
                                event = events.next() => {
                                    let event = event.ok_or(ErrorCode::Reconcile)?.map_err(|_| ErrorCode::Reconcile)?;
                                    if view.event(event) == Intent::Exit { return Err(ErrorCode::Reconcile); }
                                    // Keyboard edits affect only the next invocation. No concurrent dispatch.
                                }
                            }
                        }
                    }
                };
                view.complete(&output);
            }
        }
    }
}

#[cfg(unix)]
pub async fn run(client: Client, cancel: CancellationToken) -> Result<u8, ErrorCode> {
    if !io::stdin().is_terminal() || !io::stdout().is_terminal() { return Err(ErrorCode::Unavailable); }
    // Terminal output cannot block indefinitely behind a stopped PTY reader.
    // Restore both raw terminal state and descriptor flags on every exit.
    struct Restore(rustix::fs::OFlags);
    impl Drop for Restore {
        fn drop(&mut self) { ratatui::restore(); let _ = rustix::fs::fcntl_setfl(io::stdout(), self.0); }
    }
    let flags = rustix::fs::fcntl_getfl(io::stdout()).map_err(|_| ErrorCode::Unavailable)?;
    let _restore = Restore(flags);
    rustix::fs::fcntl_setfl(io::stdout(), flags | rustix::fs::OFlags::NONBLOCK).map_err(|_| ErrorCode::Unavailable)?;
    let mut terminal = ratatui::try_init().map_err(|_| ErrorCode::Unavailable)?;
    session(&client, &mut terminal, EventStream::new(), cancel).await
}
#[cfg(not(unix))]
pub async fn run(_: Client, _: CancellationToken) -> Result<u8, ErrorCode> { Err(ErrorCode::Unavailable) }
