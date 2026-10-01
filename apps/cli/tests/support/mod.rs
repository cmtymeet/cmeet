use cmsg::door::{Configuration, Door, Role, catalog, native};
use std::{
    collections::{BTreeMap, BTreeSet},
    os::fd::AsRawFd,
    process::Stdio,
    sync::Arc,
};
use tokio::{
    io::AsyncWriteExt,
    net::TcpListener,
    process::{Child, Command},
    task::JoinHandle,
};

pub const ORIGIN: &str = "https://client.example";
struct Clock;
impl native::Clock for Clock {
    fn now(&self) -> u64 {
        10
    }
}

pub struct Host {
    pub endpoint: String,
    token: cmsg::door::ClientToken,
    task: JoinHandle<()>,
    #[allow(dead_code)]
    pub calls: Arc<std::sync::atomic::AtomicUsize>,
}
impl Drop for Host {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Host {
    pub async fn new() -> Self {
        Self::delayed(std::time::Duration::ZERO).await
    }

    pub async fn delayed(delay: std::time::Duration) -> Self {
        Self::configured(delay, false).await
    }

    #[allow(dead_code)]
    pub async fn lost_response() -> Self {
        Self::configured(std::time::Duration::ZERO, true).await
    }

    async fn configured(delay: std::time::Duration, lose_first: bool) -> Self {
        let config = Configuration::new(
            "test".into(),
            BTreeMap::from([(Role::Member, BTreeSet::from([ORIGIN.into()]))]),
        )
        .unwrap();
        let mut door = Door::new(config);
        let token = door
            .pair_client(
                ORIGIN,
                Role::Member,
                catalog().iter().map(|a| a.action.clone()).collect(),
                10,
                20,
            )
            .unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router =
            native::router(door, BTreeSet::from([address.to_string()]), Arc::new(Clock)).unwrap();
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = calls.clone();
        let router = router.layer(axum::middleware::from_fn(
            move |request: axum::extract::Request, next: axum::middleware::Next| {
                let count = count.clone();
                async move {
                    let index = count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    tokio::time::sleep(delay).await;
                    let response = next.run(request).await;
                    if lose_first && index == 0 {
                        let (parts, _) = response.into_parts();
                        axum::response::Response::from_parts(parts, axum::body::Body::empty())
                    } else {
                        response
                    }
                }
            },
        ));
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self {
            endpoint: format!("http://{address}"),
            token,
            task,
            calls,
        }
    }

    #[allow(dead_code)] // Shared real fixture used by distinct integration binaries.
    pub fn client(&self) -> native::Client {
        native::Client::new(
            &self.endpoint,
            ORIGIN,
            cmsg::door::ClientToken::from_protected_transport(zeroize::Zeroizing::new(
                self.token.expose_for_transport().as_bytes().to_vec(),
            ))
            .unwrap(),
        )
        .unwrap()
    }

    #[allow(dead_code)]
    pub fn write_capability(&self, fd: &impl std::os::fd::AsFd) {
        rustix::io::write(fd, self.token.expose_for_transport().as_bytes()).unwrap();
    }

    pub fn spawn(&self, command: &str, origin: &str) -> Child {
        // Anonymous OS pipe is the same protected handoff the product accepts.
        // The child inherits only the read end, so it can observe EOF.
        let (read, write) = rustix::pipe::pipe().unwrap();
        rustix::io::fcntl_setfd(&write, rustix::io::FdFlags::CLOEXEC).unwrap();
        let mut child = if command.starts_with("terminal-") {
            let mut wrapper = Command::new("python3");
            wrapper.args([
                concat!(env!("CARGO_MANIFEST_DIR"), "/tests/terminal.py"),
                env!("CARGO_BIN_EXE_cmeet"),
            ]);
            wrapper.arg(command);
            wrapper
        } else {
            Command::new(env!("CARGO_BIN_EXE_cmeet"))
        };
        child.args([
            if command.starts_with("terminal-") {
                "tui"
            } else {
                command
            },
            "--endpoint",
            &self.endpoint,
            "--origin",
            origin,
            "--capability-fd",
            &read.as_raw_fd().to_string(),
        ]);
        child
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let child = child.spawn().unwrap();
        rustix::io::write(&write, self.token.expose_for_transport().as_bytes()).unwrap();
        child
    }

    pub async fn invoke(&self, bytes: &[u8], origin: &str) -> std::process::Output {
        let mut child = self.spawn("invoke", origin);
        child.stdin.take().unwrap().write_all(bytes).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(15), child.wait_with_output())
            .await
            .unwrap()
            .unwrap()
    }
}
