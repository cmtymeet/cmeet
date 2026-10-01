use super::*;
use serde_json::json;
use tokio::io::AsyncWriteExt;

fn transport<W: AsyncWrite + Unpin + Send + 'static>(
    writer: W,
) -> (
    BoundedTransport<tokio::io::DuplexStream, W>,
    tokio::io::DuplexStream,
) {
    let (reader, input) = tokio::io::duplex(MAX_FRAME_BYTES + 1);
    (
        BoundedTransport {
            reader: FramedRead::new(
                reader,
                JsonRpcMessageCodec::new_with_max_length(MAX_FRAME_BYTES),
            ),
            writer: Arc::new(Mutex::new(FramedWrite::new(
                writer,
                JsonRpcMessageCodec::new(),
            ))),
            pending: Arc::new(Mutex::new(HashSet::new())),
            failed: Arc::new(AtomicBool::new(false)),
            cancel: CancellationToken::new(),
        },
        input,
    )
}
fn response(value: serde_json::Value) -> ServerJsonRpcMessage {
    serde_json::from_value(json!({"jsonrpc":"2.0","id":1,"result":value})).unwrap()
}

#[tokio::test(start_paused = true)]
async fn idle_and_stalled_output_deadlines_close_the_transport() {
    let (mut transport, _input) = transport(tokio::io::sink());
    assert!(transport.receive().await.is_none());
    assert!(transport.failed.load(Ordering::Relaxed));
    assert!(transport.cancel.is_cancelled());
    let (writer, _held) = tokio::io::duplex(1);
    let (mut blocked, _input) = self::transport(writer);
    assert_eq!(
        blocked.send(response(json!({}))).await.unwrap_err().kind(),
        io::ErrorKind::TimedOut
    );
    assert!(blocked.cancel.is_cancelled());
    blocked.close().await.unwrap();
}

#[tokio::test]
async fn emitted_message_cap_and_error_notification_paths_are_bounded() {
    let (mut transport, _input) = transport(tokio::io::sink());
    let oversized =
        response(json!({"content":[{"type":"text","text":"x".repeat(MAX_OUTPUT_BYTES)}]}));
    assert_eq!(
        transport.send(oversized).await.unwrap_err().kind(),
        io::ErrorKind::InvalidData
    );
    let (mut transport, mut input) = self::transport(tokio::io::sink());
    input
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n")
        .await
        .unwrap();
    assert!(transport.receive().await.is_some());
    let error = serde_json::from_value(
        json!({"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"refused"}}),
    )
    .unwrap();
    transport.send(error).await.unwrap();
    assert!(transport.pending.lock().await.is_empty());
    let notification = serde_json::from_value(
        json!({"jsonrpc":"2.0","method":"notifications/tools/list_changed"}),
    )
    .unwrap();
    transport.send(notification).await.unwrap();
    drop(input);
    assert!(transport.receive().await.is_none());
    assert!(!transport.failed.load(Ordering::Relaxed));
}

#[test]
fn incompatible_tool_projection_is_refused() {
    assert!(project_tools(json!({"tools":null})).is_err());
    assert!(!project_tools(surface::mcp_tools()).unwrap().is_empty());
}
