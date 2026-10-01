#![cfg(unix)]
mod support;
use cmeet::runtime;
use cmsg::door::{ErrorCode, Output};
use std::{
    io,
    os::fd::AsRawFd,
    pin::Pin,
    task::{Context, Poll},
};
use support::{Host, ORIGIN};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf};

struct FailedIo;
impl AsyncRead for FailedIo {
    fn poll_read(
        self: Pin<&mut Self>,
        _: &mut Context<'_>,
        _: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Poll::Ready(Err(io::ErrorKind::BrokenPipe.into()))
    }
}
impl AsyncWrite for FailedIo {
    fn poll_write(self: Pin<&mut Self>, _: &mut Context<'_>, _: &[u8]) -> Poll<io::Result<usize>> {
        Poll::Ready(Err(io::ErrorKind::BrokenPipe.into()))
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Err(io::ErrorKind::BrokenPipe.into()))
    }
    fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
}

#[tokio::test(start_paused = true)]
async fn byte_limits_closed_io_and_stalled_peers_are_bounded() {
    assert_eq!(
        runtime::input(b"exact".as_slice(), 5).await.unwrap(),
        b"exact"
    );
    assert!(matches!(
        runtime::input(b"excess".as_slice(), 5).await,
        Err(ErrorCode::Capacity)
    ));
    assert!(matches!(
        runtime::input(FailedIo, 5).await,
        Err(ErrorCode::Unavailable)
    ));
    let (reader, _held_writer) = tokio::io::duplex(32);
    assert!(matches!(
        runtime::input(reader, 5).await,
        Err(ErrorCode::Unavailable)
    ));
    let value = Output::Error {
        error: ErrorCode::Unavailable,
    };
    assert_eq!(
        runtime::output(&mut FailedIo, &value)
            .await
            .unwrap_err()
            .kind(),
        io::ErrorKind::BrokenPipe
    );
    let (mut writer, _held_reader) = tokio::io::duplex(1);
    assert_eq!(
        runtime::output(&mut writer, &value)
            .await
            .unwrap_err()
            .kind(),
        io::ErrorKind::TimedOut
    );
    let mut writer = Vec::new();
    runtime::output(&mut writer, &value).await.unwrap();
    assert_eq!(
        writer,
        b"{\"status\":\"error\",\"error\":\"unavailable\"}\n"
    );
}

#[tokio::test(start_paused = true)]
async fn capability_never_waits_forever_and_refuses_shared_pipe_permissions() {
    let (read, _write) = rustix::pipe::pipe().unwrap();
    assert!(matches!(
        runtime::capability(read.as_raw_fd() as u32).await,
        Err(ErrorCode::Unavailable)
    ));
    rustix::fs::fchmod(&read, rustix::fs::Mode::from_raw_mode(0o644)).unwrap();
    assert!(matches!(
        runtime::capability(read.as_raw_fd() as u32).await,
        Err(ErrorCode::Unauthorized)
    ));
}

#[tokio::test]
async fn stopped_owner_transport_returns_its_error_without_retry() {
    let host = Host::new().await;
    let client = host.client();
    drop(host);
    tokio::task::yield_now().await;
    assert!(matches!(
        runtime::invoke(
            &client,
            br#"{"action":"runtime.status","version":1,"body":{}}"#
        )
        .await,
        Output::Error { .. }
    ));
}

#[tokio::test]
async fn invoke_cancels_stalled_stdin_and_reports_output_failure() {
    let host = Host::new().await;
    let mut child = host.spawn("invoke", ORIGIN);
    let held = child.stdin.take().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    let status = std::process::Command::new("kill")
        .args(["-INT", &child.id().unwrap().to_string()])
        .status()
        .unwrap();
    assert!(status.success());
    let result = tokio::time::timeout(std::time::Duration::from_secs(2), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    drop(held);
    assert_eq!(
        result.status.code(),
        Some(i32::from(ErrorCode::Reconcile.exit_code()))
    );
    assert!(matches!(
        serde_json::from_slice::<Output>(&result.stdout).unwrap(),
        Output::Error {
            error: ErrorCode::Reconcile
        }
    ));
    let mut child = host.spawn("invoke", ORIGIN);
    drop(child.stdout.take());
    child
        .stdin
        .take()
        .unwrap()
        .write_all(br#"{"action":"runtime.status","version":1,"body":{}}"#)
        .await
        .unwrap();
    let result = child.wait_with_output().await.unwrap();
    assert_eq!(result.status.code(), Some(1));
    assert!(!result.stderr.is_empty());
    assert!(
        host.invoke(
            br#"{"action":"runtime.status","version":1,"body":{}}"#,
            ORIGIN
        )
        .await
        .status
        .success()
    );
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn capability_refuses_a_pipe_owned_by_another_user() {
    // The public Ubuntu CI runner supplies passwordless sudo. Change ownership
    // only on this ephemeral anonymous pipe; no host configuration is modified.
    let (read, _write) = rustix::pipe::pipe().unwrap();
    rustix::fs::fchmod(&read, rustix::fs::Mode::from_raw_mode(0o644)).unwrap();
    let path = format!("/proc/{}/fd/{}", std::process::id(), read.as_raw_fd());
    assert!(std::process::Command::new("sudo").args(["-n", "chown", "65534", &path]).status().unwrap().success());
    assert!(matches!(runtime::capability(read.as_raw_fd() as u32).await, Err(ErrorCode::Unauthorized)));
}

#[tokio::test]
async fn cancellation_during_protected_handoff_never_waits_for_its_writer() {
    let (read, write) = rustix::pipe::pipe().unwrap();
    rustix::io::fcntl_setfd(&write, rustix::io::FdFlags::CLOEXEC).unwrap();
    let child = tokio::process::Command::new(env!("CARGO_BIN_EXE_cmeet"))
        .args(["invoke", "--endpoint", "http://127.0.0.1:1", "--origin", ORIGIN, "--capability-fd", &read.as_raw_fd().to_string()])
        .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true).spawn().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(std::process::Command::new("kill").args(["-INT", &child.id().unwrap().to_string()]).status().unwrap().success());
    let result = tokio::time::timeout(std::time::Duration::from_secs(2), child.wait_with_output()).await.unwrap().unwrap();
    assert_eq!(result.status.code(), Some(i32::from(ErrorCode::Reconcile.exit_code())));
    drop(write);
}
