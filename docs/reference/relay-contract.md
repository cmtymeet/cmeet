# relay/ — live ciphertext forwarding

**Status: proposed, unbuilt; reviewed 8 September 2026.** See
[architecture](../docs/architecture.md), [data lifecycle](../docs/data-lifecycle.md)
and [security gates](../docs/security-review.md).

The relay forwards ciphertext to member-selected recipients while connected.
It has no application offline queue, message history or hosted profiles. It
still observes live socket relationships, IPs, traffic sizes and timing. No
claim that it can tell nobody anything afterwards is justified until all
application and provider records are inventoried.

## Interface and lifecycle

- Authenticate a session using reviewed scoped authorization, without exposing a
  stable membership credential to the relay. Issuance/access unlinkability is
  unimplemented; splitting services alone does not provide it.
- Use fresh random routing handles. No names, phone anchors, sensitive profile
  fields, content keys or stable room identifier in relay requests.
- Bind recipient selection and group membership in the clients' authenticated
  transcript. The relay forwards opaque frames and does not choose matches.
- Reject delivery when a recipient is offline. Bound frame size, outbound bytes
  and delivery deadlines; drop or close on backpressure. Network/socket buffers
  exist even when the application has no offline queue.
- Remove routes, pending offers and room participation on disconnect/timeout.
  Restart cannot resume or replay a session. No last-seen or per-member balance
  map survives on the relay.
- Proposed prototype bounds: 64 KiB frames, 256 KiB application outbound buffer
  per recipient, five-second delivery deadline, 30-second heartbeat and
  90-second dead-socket detection. Validate runtime/global memory bounds too.

Exact inventory and acceptance checks are in the lifecycle document. These
limits and checks are specified, not implemented or measured.

## Groups and cryptography

Closed groups remain 3–8. The creator stands surety; member flags close a room;
three closed rooms slash its creator under the existing rules. Security proofs
must enforce these without a retained relay social graph. Required sanctions
state belongs to the separately inventoried authority.

Deterministic client leader selection and per-recipient key wrapping remain the
intended small-group shape. Rekey on membership changes before further messages
and on a wall-clock interval. Leader selection alone does not authenticate the
participant set or stop relay equivocation. The previous Cwtch/Tapir 3DH proposal
is prior art, not an implemented key schedule or proof of deniability here.
Do not adopt MLS under the standing project decision.

Transferable relay signatures over participant IDs, body hashes and timestamps
remain unresolved under D9. The minimum transport proposal recommends omitting
them. Do not claim both transferable evidence and transcript deniability, and do
not introduce content-derived telemetry as a substitute for retaining messages.

## Hosting boundary

Cloudflare Worker/Durable Objects is a candidate, not a selected backend. Its
historical per-object metrics remain despite turning application logs off. D8
requires a provider comparison and explicit statement of residual metadata.
Avoid a permanent object name for a long-lived social room.

If that backend is selected: standard WebSockets only; no Hibernation API,
`serializeAttachment`, application storage, Tail Worker or Logpush. Explicitly
disable observability/logging/tracing in the pinned effective configuration.
The planned CI checks do not yet exist. Audit proxies, provider analytics,
crash/heap dumps, swap and backups separately; inspectable application code alone
does not prove their absence.

## Implementation boundary

Transport modules should cover authorization, ephemeral routes, frame limits,
fan-out and lifecycle. Authenticated E2EE/key agreement belongs on clients. The
membership model is not the relay's runtime state schema. Tests must cover slow
consumers, dropped connections, replays, reconnect/reset and crash/restart before
real users. No offline mailbox, attachment store, public room list, transcript
viewer or operator content-moderation tooling belongs here.
