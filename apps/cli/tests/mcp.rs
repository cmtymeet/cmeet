#![cfg(unix)]
mod support;
use cmsg::door::surface;
use serde_json::{Value, json};
use support::{Host, ORIGIN};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

async fn receive(reader: &mut BufReader<tokio::process::ChildStdout>) -> Value {
    let mut line = String::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(15),
        reader.read_line(&mut line),
    )
    .await
    .unwrap()
    .unwrap();
    serde_json::from_str(&line).expect("one MCP JSON-RPC response")
}
async fn send(writer: &mut tokio::process::ChildStdin, value: Value) {
    writer
        .write_all(format!("{value}\n").as_bytes())
        .await
        .unwrap();
}
async fn initialize(
    writer: &mut tokio::process::ChildStdin,
    reader: &mut BufReader<tokio::process::ChildStdout>,
) {
    send(writer, json!({"jsonrpc":"2.0","id":0,"method":"initialize","params":{
        "protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"boundary-test","version":"1"}
    }})).await;
    assert_eq!(
        receive(reader).await["result"]["serverInfo"]["name"],
        "cmeet"
    );
    send(
        writer,
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
    )
    .await;
}

#[tokio::test]
async fn actual_mcp_process_uses_owner_tools_http_results_errors_and_events() {
    let host = Host::new().await;
    let mut child = host.spawn("mcp", ORIGIN);
    let mut writer = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    initialize(&mut writer, &mut reader).await;
    send(
        &mut writer,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
    )
    .await;
    let tools = receive(&mut reader).await;
    assert_eq!(tools["result"]["tools"], surface::mcp_tools()["tools"]);
    send(&mut writer, json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"runtime.status","arguments":{}}})).await;
    let status = receive(&mut reader).await;
    assert_eq!(
        status["result"]["structuredContent"]["result"]["preload"],
        "unavailable"
    );
    writer.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"runtime.status\",\"arguments\":{\"extra\":1,\"extra\":2}}}\n").await.unwrap();
    let refusal = receive(&mut reader).await;
    assert_eq!(refusal["result"]["isError"], true);
    assert_eq!(
        refusal["result"]["structuredContent"]["error"],
        "invalid_request"
    );
    send(&mut writer, json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"unknown","arguments":{}}})).await;
    assert!(receive(&mut reader).await["error"].is_object());
    send(
        &mut writer,
        json!({"jsonrpc":"2.0","id":5,"method":"tools/list","params":{"cursor":"unknown"}}),
    )
    .await;
    assert!(receive(&mut reader).await["error"].is_object());
    send(
        &mut writer,
        json!({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"client.revoke"}}),
    )
    .await;
    assert_eq!(
        receive(&mut reader).await["result"]["structuredContent"]["events"],
        json!([{"event":"client_revoked"}])
    );
    send(&mut writer, json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"runtime.status","arguments":{}}})).await;
    assert_eq!(
        receive(&mut reader).await["result"]["structuredContent"]["error"],
        "unauthorized"
    );
    drop(writer);
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    assert!(result.status.success(), "{:?}", result.stderr);
    assert!(result.stderr.is_empty());
}

#[tokio::test]
async fn malformed_duplicate_protocol_and_oversized_frames_close_without_authority_changes() {
    let host = Host::new().await;
    for (case, frame) in [
        b"not JSON\n".to_vec(),
        b"{\"jsonrpc\":\"2.0\",\"id\":1,\"id\":2,\"method\":\"ping\"}\n".to_vec(),
        vec![b'x'; cmeet::mcp::MAX_FRAME_BYTES + 1],
        b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"runtime.status\",\"name\":\"client.revoke\",\"arguments\":{}}}\n".to_vec(),
    ].into_iter().enumerate() {
        let mut child = host.spawn("mcp", ORIGIN);
        let mut writer = child.stdin.take().unwrap();
        let mut reader = BufReader::new(child.stdout.take().unwrap());
        initialize(&mut writer, &mut reader).await;
        let _ = writer.write_all(&frame).await;
        drop(writer);
        let result = tokio::time::timeout(std::time::Duration::from_secs(15), child.wait_with_output()).await.unwrap().unwrap();
        assert!(!result.status.success(), "malformed case {case}");
        assert!(result.stdout.is_empty());
    }
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

#[tokio::test]
async fn excessive_outstanding_requests_duplicate_ids_and_broken_output_terminate() {
    let host = Host::delayed(std::time::Duration::from_secs(2)).await;
    for duplicate in [false, true] {
        let mut child = host.spawn("mcp", ORIGIN);
        let mut writer = child.stdin.take().unwrap();
        let mut reader = BufReader::new(child.stdout.take().unwrap());
        initialize(&mut writer, &mut reader).await;
        for i in 0..=cmeet::mcp::MAX_PENDING {
            let id = if duplicate { 1 } else { i + 1 };
            let message = json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":"runtime.status","arguments":{}}});
            if writer
                .write_all(format!("{message}\n").as_bytes())
                .await
                .is_err()
            {
                break;
            }
        }
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(15), child.wait_with_output())
                .await
                .unwrap()
                .unwrap();
        assert!(!result.status.success());
        drop(writer);
    }
    let mut child = host.spawn("mcp", ORIGIN);
    let mut writer = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    initialize(&mut writer, &mut reader).await;
    drop(reader);
    send(
        &mut writer,
        json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
    )
    .await;
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    assert!(!result.status.success());
}

#[tokio::test(start_paused = true)]
async fn stalled_initialization_and_idle_sessions_do_not_live_forever() {
    let host = Host::new().await;
    let (reader, _held) = tokio::io::duplex(128);
    assert!(matches!(
        cmeet::mcp::serve(
            host.client(),
            reader,
            tokio::io::sink(),
            tokio_util::sync::CancellationToken::new()
        )
        .await,
        Err(cmsg::door::ErrorCode::Unavailable)
    ));
}

#[tokio::test]
async fn eof_without_a_drained_owner_response_reports_unknown_outcome() {
    let host = Host::delayed(std::time::Duration::from_secs(6)).await;
    let mut child = host.spawn("mcp", ORIGIN);
    let mut writer = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    initialize(&mut writer, &mut reader).await;
    send(&mut writer, json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"runtime.status","arguments":{}}})).await;
    drop(writer);
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        result.status.code(),
        Some(i32::from(cmsg::door::ErrorCode::Reconcile.exit_code()))
    );
}

#[tokio::test]
async fn sdk_request_cancellation_preserves_unknown_outcome_without_retry() {
    let host = Host::delayed(std::time::Duration::from_secs(2)).await;
    let mut child = host.spawn("mcp", ORIGIN);
    let mut writer = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    initialize(&mut writer, &mut reader).await;
    send(&mut writer, json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"runtime.status","arguments":{}}})).await;
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while host.calls.load(std::sync::atomic::Ordering::SeqCst) == 0 {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    send(&mut writer, json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1,"reason":"caller cancelled"}})).await;
    send(&mut writer, json!({"jsonrpc":"2.0","id":2,"method":"ping"})).await;
    assert_eq!(receive(&mut reader).await["id"], 2);
    drop(writer);
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        result.status.code(),
        Some(i32::from(cmsg::door::ErrorCode::Reconcile.exit_code()))
    );
    assert_eq!(host.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}
