# cmeet command line

One Rust client consumes the cmsg action registry and native HTTP client. It
supports registry inspection, one-shot invocation, MCP stdio and a terminal UI.
The current owner implements runtime status, runtime description and local-client
revocation. Member workflows and production custody/bootstrap remain unavailable.
These adapters do not constitute a working community network.

## Commands

`cmeet api [cli|mcp|openapi|bundle] [--pretty]` exports owner descriptions without a
runtime connection. `api mcp` is the tool-description projection.

The three connected modes require the same options:

```text
cmeet invoke --endpoint http://127.0.0.1:PORT --origin ORIGIN --capability-fd N
cmeet mcp    --endpoint http://127.0.0.1:PORT --origin ORIGIN --capability-fd N
cmeet tui    --endpoint http://127.0.0.1:PORT --origin ORIGIN --capability-fd N
```

The trusted runtime must already have paired this local client. It supplies the
existing opaque capability through an inherited private Unix pipe, descriptor 3
or higher, and closes the write end. The pipe must belong to the current user
and have no group/other permissions. The descriptor number is public; its bytes
never belong in arguments, environment variables, regular files or logs. The
owner validates the capability; import neither pairs nor mints a grant. A real
custody/bootstrap integration must provide this channel before ordinary users
can connect. Other platforms currently refuse the handoff.

`invoke` reads one complete raw owner envelope from stdin, for example:

```json
{"action":"runtime.status","version":1,"body":{}}
```

It forwards the original bytes and prints the complete owner `Output`, including
events, as one JSON line. Duplicate fields remain visible to the owner. Domain
failures use `ErrorCode::exit_code`; shell argument errors use Clap's exit 2,
output failure uses exit 1, and successful inspection/invocation uses exit 0.
Input and capability reads, HTTP requests and output writes have ten-second
bounds. A transport or output failure never retries an action. SIGINT cancels
with the owner's `Reconcile` code because an outstanding effect may have run.

`mcp` negotiates and serves tools on stdin/stdout using the official
[rmcp SDK](https://github.com/modelcontextprotocol/rust-sdk). Every tool and schema
comes from `cmsg::door::surface`, and every invocation uses the same owner Client.
Original `tools/call` arguments are attached to the SDK request before its object
decoder can normalize duplicates. SDK session handling owns JSON-RPC, negotiation
and cancellation. Successful and refused owner envelopes are returned intact in
`structuredContent`, with owner events and `isError` for refusals. Unknown tools
and invalid MCP protocol fields are protocol errors or terminate the session;
stdout contains protocol messages only.

MCP frames are capped at the owner request limit plus 8 KiB, emitted messages at
four times the owner result limit, and outstanding requests at 32. Admission
remains occupied until a response flushes. Initialization and each output have
ten-second deadlines; inactive sessions expire after five minutes. Malformed,
oversized, repeated in-flight request IDs and output failures close the session.
Outstanding effects require reconciliation after cancellation or lost output.
If the SDK suppresses a cancelled request's response, that request retains its
admission slot until session close; repeated cancellation remains bounded.

`tui` uses [Ratatui](https://docs.rs/ratatui/latest/ratatui/) and
[Crossterm](https://docs.rs/crossterm/latest/crossterm/event/struct.EventStream.html).
Up/Down selects an owner-generated command; typing edits its raw JSON body,
Ctrl-U clears, Enter invokes, and Esc/Ctrl-C exits. The UI displays actual owner
results and events, including unavailable readiness and refusal. It starts with
unknown readiness and dispatches only when asked. Body size, display size and
one-at-a-time calls are bounded. Terminal controls are escaped; stalled terminal
output fails instead of blocking. Terminal state and descriptor flags are
restored on exit. Its exit code is the last displayed owner result, or Reconcile
when an in-flight call is cancelled.

## Boundaries and verification

No adapter owns a command/schema copy, authorization protocol or domain rule.
All future member/admin/root actions use cmsg; admin/root routing remains
cmsg → Foyer → cvld. No frontend calls a server door directly or implements
admission, proof verification, key custody or DHT storage.

CI tests exercise a real cmsg Door and native loopback HTTP, child-process stdin
and stdout, real MCP negotiation/calls, and an actual pseudo-terminal. The test
host's owner `Door::pair_client` control is trusted fixture setup, not production
bootstrap, G2/G3 evidence or a frontend capability endpoint. Generic I/O fault
adapters exercise operating-system boundary behavior only. Rust coverage requires
100% measured reachable lines and branches; coverage gaps fail the job. Browser
production refusal and the full [toy acceptance contract](../../tests/toy/README.md)
remain separate gates. The toy remains explicitly blocked until every actual
required operation exists and its conjunctive scenario executes.
