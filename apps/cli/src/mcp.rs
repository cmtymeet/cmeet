//! Official MCP SDK session handling with bounded stdio and original arguments.
//! The adapter owns no action list, schemas, authentication or JSON-RPC engine.
use crate::runtime::{self, IO_DEADLINE};
use cmsg::door::{ErrorCode, Output, catalog, native::Client, surface};
use futures::{SinkExt, StreamExt};
use rmcp::{McpError, RoleServer, ServerHandler, ServiceExt, model::*, service::RequestContext,
    transport::{Transport, async_rw::JsonRpcMessageCodec}};
use serde::Deserialize;
use serde_json::value::RawValue;
use std::{collections::HashSet, io, sync::{Arc, atomic::{AtomicBool, Ordering}}, time::Duration};
use tokio::{io::{AsyncRead, AsyncWrite}, sync::Mutex};
use tokio_util::{codec::{FramedRead, FramedWrite}, sync::CancellationToken};

pub const MAX_FRAME_BYTES: usize = cmsg::door::MAX_BODY_BYTES + 8192;
pub const MAX_PENDING: usize = 32;
pub const MAX_OUTPUT_BYTES: usize = 4 * cmsg::door::MAX_RESULT_BYTES;
pub const IDLE_DEADLINE: Duration = Duration::from_secs(300);

#[derive(Clone)]
struct RawArguments(Arc<str>);

/// Preserve the tools/call arguments before the SDK's object decoding. Only
/// protocol fields are inspected here; cmsg alone decodes the original body.
fn decode(raw: &str) -> Result<ClientJsonRpcMessage, serde_json::Error> {
    #[derive(Deserialize)]
    struct Envelope {
        #[serde(rename = "jsonrpc")] _jsonrpc: String,
        #[serde(rename = "id")] _id: Option<Box<RawValue>>,
        #[serde(rename = "method")] _method: Option<String>,
        params: Option<Box<RawValue>>,
    }
    #[derive(Deserialize)]
    struct Call {
        #[serde(rename = "name")] _name: String,
        arguments: Option<Box<RawValue>>,
    }
    let envelope: Envelope = serde_json::from_str(raw)?;
    let mut message: ClientJsonRpcMessage = serde_json::from_str(raw)?;
    if let JsonRpcMessage::Request(request) = &mut message
        && let ClientRequest::CallToolRequest(call) = &mut request.request
    {
        let params: Call = serde_json::from_str(envelope.params.as_deref().map_or("{}", RawValue::get))?;
        call.extensions.insert(RawArguments(Arc::from(params.arguments.as_deref().map_or("{}", RawValue::get))));
    }
    Ok(message)
}

pub struct Server { client: Client }
impl Server {
    pub fn new(client: Client) -> Self { Self { client } }
}
impl ServerHandler for Server {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("cmeet", env!("CARGO_PKG_VERSION")))
    }
    async fn list_tools(&self, request: Option<PaginatedRequestParams>, _: RequestContext<RoleServer>) -> Result<ListToolsResult, McpError> {
        if request.and_then(|r| r.cursor).is_some() {
            return Err(McpError::invalid_params("Unknown cursor", None));
        }
        let tools: Vec<Tool> = serde_json::from_value(surface::mcp_tools()["tools"].clone())
            .map_err(|_| McpError::internal_error("Registry unavailable", None))?;
        Ok(ListToolsResult::with_all_items(tools))
    }
    async fn call_tool(&self, request: CallToolRequestParams, context: RequestContext<RoleServer>) -> Result<CallToolResponse, McpError> {
        let action = catalog().into_iter().find(|a| a.action == request.name)
            .ok_or_else(|| McpError::invalid_params("Unknown owner action", None))?;
        let raw = context.extensions.get::<RawArguments>()
            .ok_or_else(|| McpError::invalid_request("Original arguments unavailable", None))?;
        // Encode only the wrapper. RawValue keeps all original body bytes,
        // including duplicate fields, for the owner's typed refusal.
        let name = serde_json::to_string(&action.action).expect("a string encodes as JSON");
        let bytes = format!("{{\"action\":{name},\"version\":{},\"body\":{}}}", action.version, raw.0);
        let output = tokio::select! {
            biased;
            _ = context.ct.cancelled() => Output::Error { error: ErrorCode::Reconcile },
            output = runtime::invoke(&self.client, bytes.as_bytes()) => output,
        };
        let error = matches!(output, Output::Error { .. });
        let value = serde_json::to_value(output).map_err(|_| McpError::internal_error("Output unavailable", None))?;
        let result = if error { CallToolResult::structured_error(value) } else { CallToolResult::structured(value) };
        Ok(result.into())
    }
}

/// The SDK owns negotiation, routing, request cancellation and protocol errors.
/// This transport adds bounded frames, outstanding requests and send deadlines.
/// Admission stays occupied until the corresponding response is flushed, so a
/// stalled reader cannot create an unbounded backlog of completed results.
struct BoundedTransport<R, W> {
    reader: FramedRead<R, JsonRpcMessageCodec<Box<RawValue>>>,
    writer: Arc<Mutex<FramedWrite<W, JsonRpcMessageCodec<ServerJsonRpcMessage>>>>,
    pending: Arc<Mutex<HashSet<RequestId>>>,
    failed: Arc<AtomicBool>,
    cancel: CancellationToken,
}
impl<R: AsyncRead + Unpin + Send, W: AsyncWrite + Unpin + Send + 'static> Transport<RoleServer> for BoundedTransport<R, W> {
    type Error = io::Error;
    fn send(&mut self, item: ServerJsonRpcMessage) -> impl Future<Output = io::Result<()>> + Send + 'static {
        let writer = self.writer.clone();
        let pending = self.pending.clone();
        let failed = self.failed.clone();
        let cancel = self.cancel.clone();
        async move {
            let id = match &item {
                JsonRpcMessage::Response(r) => Some(r.id.clone()),
                JsonRpcMessage::Error(r) => r.id.clone(),
                _ => None,
            };
            let send = async {
                if serde_json::to_vec(&item)?.len() > MAX_OUTPUT_BYTES {
                    return Err(io::ErrorKind::InvalidData.into());
                }
                writer.lock().await.send(item).await.map_err(io::Error::from)
            };
            let result = tokio::time::timeout(IO_DEADLINE, send).await
                .map_err(|_| io::Error::from(io::ErrorKind::TimedOut)).and_then(|r| r);
            if result.is_err() {
                failed.store(true, Ordering::Relaxed);
                cancel.cancel();
            } else if let Some(id) = id {
                pending.lock().await.remove(&id);
            }
            result
        }
    }
    async fn receive(&mut self) -> Option<ClientJsonRpcMessage> {
        let frame = tokio::time::timeout(IDLE_DEADLINE, self.reader.next()).await;
        let message = match frame {
            Ok(Some(Ok(raw))) => decode(raw.get()).ok(),
            Ok(None) => return None,
            _ => None,
        };
        if let Some(message) = message {
            let admitted = if let JsonRpcMessage::Request(request) = &message {
                let mut pending = self.pending.lock().await;
                pending.len() < MAX_PENDING && pending.insert(request.id.clone())
            } else { true };
            if admitted { return Some(message); }
        }
        self.failed.store(true, Ordering::Relaxed);
        self.cancel.cancel();
        None
    }
    async fn close(&mut self) -> io::Result<()> {
        // Drop owns stdio. Never wait on a blocked reader or flush again after an
        // unknown output failure; each send already flushes under a deadline.
        Ok(())
    }
}

pub async fn serve(
    client: Client,
    reader: impl AsyncRead + Unpin + Send + 'static,
    writer: impl AsyncWrite + Unpin + Send + 'static,
    cancel: CancellationToken,
) -> Result<(), ErrorCode> {
    let failed = Arc::new(AtomicBool::new(false));
    let pending = Arc::new(Mutex::new(HashSet::new()));
    let transport = BoundedTransport {
        reader: FramedRead::new(reader, JsonRpcMessageCodec::new_with_max_length(MAX_FRAME_BYTES)),
        writer: Arc::new(Mutex::new(FramedWrite::new(writer, JsonRpcMessageCodec::new()))),
        pending: pending.clone(),
        failed: failed.clone(), cancel: cancel.clone(),
    };
    let service = tokio::time::timeout(IO_DEADLINE, Server::new(client).serve_with_ct(transport, cancel))
        .await.map_err(|_| ErrorCode::Unavailable)?.map_err(|_| ErrorCode::Unavailable)?;
    let reason = service.waiting().await.map_err(|_| ErrorCode::Unavailable)?;
    if !pending.lock().await.is_empty() { return Err(ErrorCode::Reconcile); }
    if failed.load(Ordering::Relaxed) { return Err(ErrorCode::Unavailable); }
    match reason {
        rmcp::service::QuitReason::Closed => Ok(()),
        _ => Err(ErrorCode::Reconcile),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::AsyncWriteExt;

    fn transport<W: AsyncWrite + Unpin + Send + 'static>(writer: W) -> (BoundedTransport<tokio::io::DuplexStream, W>, tokio::io::DuplexStream) {
        let (reader, input) = tokio::io::duplex(MAX_FRAME_BYTES + 1);
        (BoundedTransport {
            reader: FramedRead::new(reader, JsonRpcMessageCodec::new_with_max_length(MAX_FRAME_BYTES)),
            writer: Arc::new(Mutex::new(FramedWrite::new(writer, JsonRpcMessageCodec::new()))),
            pending: Arc::new(Mutex::new(HashSet::new())),
            failed: Arc::new(AtomicBool::new(false)), cancel: CancellationToken::new(),
        }, input)
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
        assert_eq!(blocked.send(response(json!({}))).await.unwrap_err().kind(), io::ErrorKind::TimedOut);
        assert!(blocked.cancel.is_cancelled());
        blocked.close().await.unwrap();
    }

    #[tokio::test]
    async fn emitted_message_cap_and_error_notification_paths_are_bounded() {
        let (mut transport, _input) = transport(tokio::io::sink());
        let oversized = response(json!({"content":[{"type":"text","text":"x".repeat(MAX_OUTPUT_BYTES)}]}));
        assert_eq!(transport.send(oversized).await.unwrap_err().kind(), io::ErrorKind::InvalidData);
        let (mut transport, mut input) = self::transport(tokio::io::sink());
        input.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n").await.unwrap();
        assert!(transport.receive().await.is_some());
        let error = serde_json::from_value(json!({"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"refused"}})).unwrap();
        transport.send(error).await.unwrap();
        assert!(transport.pending.lock().await.is_empty());
        let notification = serde_json::from_value(json!({"jsonrpc":"2.0","method":"notifications/tools/list_changed"})).unwrap();
        transport.send(notification).await.unwrap();
        drop(input);
        assert!(transport.receive().await.is_none());
        assert!(!transport.failed.load(Ordering::Relaxed));
    }
}
