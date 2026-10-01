#![cfg(unix)]
mod support;
use cmeet::tui::{Intent, View, session};
use cmsg::door::{ErrorCode, Output, catalog};
use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::{Terminal, backend::TestBackend};
use support::{Host, ORIGIN};
use tokio_util::sync::CancellationToken;
fn key(code: KeyCode) -> Event {
    Event::Key(KeyEvent::new(code, KeyModifiers::NONE))
}
fn control(c: char) -> Event {
    Event::Key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::CONTROL))
}

#[test]
fn registry_editing_and_safe_rendering_preserve_original_owner_input() {
    let mut view = View::default();
    for (i, action) in catalog().iter().enumerate() {
        let value: serde_json::Value = serde_json::from_slice(&view.invocation().unwrap()).unwrap();
        assert_eq!(value["action"], action.action);
        assert_eq!(value["version"], action.version);
        if i + 1 < catalog().len() {
            view.event(key(KeyCode::Down));
        }
    }
    view.event(key(KeyCode::Down));
    for _ in 0..catalog().len() + 1 {
        view.event(key(KeyCode::Up));
    }
    view.event(control('u'));
    assert!(matches!(view.invocation(), Err(ErrorCode::InvalidRequest)));
    for c in "{\"extra\":1,\"extra\":2}x".chars() {
        view.event(key(KeyCode::Char(c)));
    }
    view.event(key(KeyCode::Backspace));
    assert!(
        String::from_utf8(view.invocation().unwrap())
            .unwrap()
            .contains("\"extra\":1,\"extra\":2")
    );
    assert_eq!(view.event(key(KeyCode::Enter)), Intent::Invoke);
    assert_eq!(view.event(key(KeyCode::Esc)), Intent::Exit);
    assert_eq!(view.event(control('c')), Intent::Exit);
    view.event(Event::Resize(80, 24));
    view.event(Event::Key(KeyEvent::new_with_kind(
        KeyCode::Enter,
        KeyModifiers::NONE,
        KeyEventKind::Release,
    )));
    view.event(key(KeyCode::Tab));
    view.event(key(KeyCode::Char('\x1b')));
    view.complete(&Output::Error {
        error: ErrorCode::Unavailable,
    });
    let mut terminal = Terminal::new(TestBackend::new(100, 30)).unwrap();
    terminal.draw(|f| view.draw(f)).unwrap();
    let screen = format!("{:?}", terminal.backend().buffer());
    assert!(screen.contains("unavailable"));
    assert!(!screen.contains("ready"));
    view.complete(&Output::Ok {
        result: serde_json::json!({"value":"\u{1b}[2J","large":"é".repeat(100000)}),
        events: vec![],
    });
    terminal.draw(|f| view.draw(f)).unwrap();
    for _ in 0..cmsg::door::MAX_BODY_BYTES {
        view.event(key(KeyCode::Char('x')));
    }
    view.event(key(KeyCode::Char('é')));
}

#[tokio::test]
async fn actual_terminal_process_invokes_owner_and_restores_terminal_after_error() {
    let host = Host::new().await;
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(40),
        host.spawn("terminal-test", ORIGIN).wait_with_output(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[tokio::test]
async fn terminal_requires_real_tty_and_handles_closed_input_and_cancellation() {
    let host = Host::new().await;
    let result = host.spawn("tui", ORIGIN).wait_with_output().await.unwrap();
    assert_eq!(
        result.status.code(),
        Some(i32::from(ErrorCode::Unavailable.exit_code()))
    );
    let mut terminal = Terminal::new(TestBackend::new(100, 30)).unwrap();
    let client = host.client();
    assert!(
        host.invoke(
            br#"{"action":"runtime.status","version":1,"body":{}}"#,
            ORIGIN
        )
        .await
        .status
        .success()
    );
    assert!(matches!(
        session(
            &client,
            &mut terminal,
            futures::stream::empty(),
            CancellationToken::new()
        )
        .await,
        Err(ErrorCode::Unavailable)
    ));
    assert!(matches!(
        session(
            &client,
            &mut terminal,
            futures::stream::iter([Err(std::io::ErrorKind::BrokenPipe.into())]),
            CancellationToken::new()
        )
        .await,
        Err(ErrorCode::Unavailable)
    ));
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(matches!(
        session(&client, &mut terminal, futures::stream::pending(), cancel).await,
        Err(ErrorCode::Reconcile)
    ));
    assert_eq!(
        session(
            &client,
            &mut terminal,
            futures::stream::iter([Ok(key(KeyCode::Esc))]),
            CancellationToken::new()
        )
        .await
        .unwrap(),
        0
    );
    assert!(matches!(
        session(
            &client,
            &mut terminal,
            futures::stream::iter([Ok(key(KeyCode::Enter)), Ok(key(KeyCode::Esc))]),
            CancellationToken::new()
        )
        .await,
        Err(ErrorCode::Reconcile)
    ));
}
