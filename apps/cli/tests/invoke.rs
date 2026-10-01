#![cfg(unix)]
mod support;
use cmsg::door::{ErrorCode, Output};
use support::{Host, ORIGIN};

#[tokio::test]
async fn actual_process_calls_real_owner_http_and_reports_revocation_event() {
    let host = Host::new().await;
    for action in ["runtime.status", "runtime.describe"] {
        let bytes = format!("{{\"action\":\"{action}\",\"version\":1,\"body\":{{}}}}");
        let result = host.invoke(bytes.as_bytes(), ORIGIN).await;
        assert_eq!(result.status.code(), Some(0));
        assert!(result.stderr.is_empty());
        let output: Output = serde_json::from_slice(&result.stdout).unwrap();
        assert!(matches!(output, Output::Ok { .. }));
        if action == "runtime.status" {
            assert_eq!(serde_json::from_slice::<serde_json::Value>(&result.stdout).unwrap()["result"]["preload"], "unavailable");
        }
    }
    let result = host.invoke(br#"{"action":"client.revoke","version":1,"body":{}}"#, ORIGIN).await;
    assert_eq!(result.status.code(), Some(0));
    let value: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(value["events"], serde_json::json!([{"event":"client_revoked"}]));
    let result = host.invoke(br#"{"action":"runtime.status","version":1,"body":{}}"#, ORIGIN).await;
    assert_eq!(result.status.code(), Some(i32::from(ErrorCode::Unauthorized.exit_code())));
}

#[tokio::test]
async fn original_duplicate_fields_wrong_versions_and_origins_reach_owner_refusal() {
    let host = Host::new().await;
    for (bytes, origin, error) in [
        (br#"{"action":"runtime.status","action":"client.revoke","version":1,"body":{}}"#.as_slice(), ORIGIN, ErrorCode::InvalidRequest),
        (br#"{"action":"runtime.status","version":1,"body":{"extra":1,"extra":2}}"#, ORIGIN, ErrorCode::InvalidRequest),
        (br#"{"action":"runtime.status","version":2,"body":{}}"#, ORIGIN, ErrorCode::UnsupportedVersion),
        (br#"{"action":"unknown","version":1,"body":{}}"#, ORIGIN, ErrorCode::UnsupportedAction),
        (br#"{"action":"runtime.status","version":1,"body":{}}"#, "https://other.example", ErrorCode::Unauthorized),
        (b"not JSON", ORIGIN, ErrorCode::InvalidRequest),
    ] {
        let result = host.invoke(bytes, origin).await;
        assert_eq!(result.status.code(), Some(i32::from(error.exit_code())));
        assert!(matches!(serde_json::from_slice::<Output>(&result.stdout).unwrap(), Output::Error { error: e } if e == error));
        assert!(result.stderr.is_empty());
    }
    let result = host.invoke(&vec![b' '; cmsg::door::MAX_BODY_BYTES + 1], ORIGIN).await;
    assert_eq!(result.status.code(), Some(i32::from(ErrorCode::Capacity.exit_code())));
    // The duplicate action did not revoke the original grant.
    assert!(host.invoke(br#"{"action":"runtime.status","version":1,"body":{}}"#, ORIGIN).await.status.success());
}

#[tokio::test]
async fn capability_import_refuses_stdio_closed_descriptors_and_regular_files() {
    for fd in [0, 1, 2, 999999] {
        assert!(matches!(cmeet::runtime::capability(fd).await, Err(ErrorCode::Unauthorized)));
    }
    use std::os::fd::AsRawFd;
    let file = tempfile::tempfile().unwrap();
    assert!(matches!(cmeet::runtime::capability(file.as_raw_fd() as u32).await, Err(ErrorCode::Unauthorized)));
    for bytes in [b"".as_slice(), b"invalid", &[b'a'; 44]] {
        let (read, write) = rustix::pipe::pipe().unwrap();
        rustix::io::write(&write, bytes).unwrap();
        drop(write);
        assert!(matches!(cmeet::runtime::capability(read.as_raw_fd() as u32).await, Err(ErrorCode::Unauthorized)));
    }
}
