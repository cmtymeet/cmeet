# Product acceptance: blocked

The required scenario runs the same cmeet program and cmsg actions as every
frontend. It has not run. CLI I/O tests, development UI journeys and library
fixtures are separate evidence and cannot make this scenario pass.

The CI `toy` gate deliberately fails until real orchestration can execute every
row. It runs no substitute scenario. An unavailable row is **BLOCKED**, a failed assertion is **FAIL**, and only the
conjunction of every required row can be **PASS**. The current status of every
row below is BLOCKED.

| Stage | Required execution and assertions |
|---|---|
| Service and device startup | Separate cvld global/community processes, local libSQL databases and signing keys. Run cfrm once with cvtl Memory and once with a disposable Valkey. Give each cmeet device its own encrypted store. Configure only synthetic communities and test credentials. Wait for actual Mesh bootstrap and onion publication. |
| Join and lobby | Device cpky performs real test-only software WebAuthn with PRF; real BBS blind issuance and per-community presentation. A cvch sponsor signs a voucher bound to the actual pseudonym. Registration gives no forum access; the lobby shows active missing gates and no-return/second-device warnings. Wrong redeemer and replay fail. |
| Profile and admission | Current-schema typed public/private values, rules, v2 pins, actual signed community credential and live authorized device key. G1 trust-to-guard and G3 device authority must pass. No constructed admitted value, permissive verifier or raw-key authority. |
| Enter and search | Board's single Link uses device-bound attendance. cfrm consumes real signed trust publications and verifies a mandatory current accounting record locally (G2). Reciprocal paged search, deltas, schema withdrawal and blocks work. |
| Private profile | Give-first owner-to-peer key exchange over real Mesh/Tor, current rule recheck, ciphertext through Board and local authenticated decryption. Requester rejection reveals only the failing field. No server receives profile keys or private plaintext. |
| Wave, release, Answer | Real cblc/cwlt accounts and proofs through cmsg/Foyer/door actions. Both reservations accepted before durable release. Answer refunds both once and enables unmetered conversation. Failed storage or uncertain acceptance never reveals first content. |
| Direct conversation | Real OpenMLS ciphertext over Tor. ACK only after committed history; drop ACK, disconnect/reconnect and retry identical output with no duplicate message or balance effect. |
| Isolation and faults | Second community for the same holder has distinct pseudonyms, device/purpose keys and reachability. Exercise expiry, revocation, epoch/schema edits, foreign origin, storage failure, malformed framing and isolated quotas. Capture traffic to verify no cfrm-to-cvld member lookup. |
| Offline existing contacts | Recipient away, committed ciphertext queued and stored on device-node Tor DHT; stored and recipient-acknowledged states stay distinct. Restart preserves outbox and history. No offline first contact or operator mailbox. |
| Active member device loss | Populate the real Tor device-node DHT; stop the original device and destroy its local store. Restore on a fresh device using the same passkey. Assert the same identity, memberships, contacts and exact accepted history. No copying the old store, privileged seeding or synthetic successful lookup. Missing replicas cannot count as an empty successful restore. |
| Groups and rooms | Third member joins, then real consent forks cross 12/13 and 42/43, opening timeout, shrink hysteresis, public seeds, ordered joins, scoped history, exit forks/listing handover and welcome credit caps. Nonconsenting members remain private; joining costs no Wave; seats remain disabled. |
| Surfaces and custody | The same registry drives CLI/TUI/MCP/HTTP/TypeScript and member/admin/root authorization. Admin/root use cmsg → cfyr → cvld. Release builds exclude test authenticators and the development global gate; actual browser/native vectors run. Production passkey UX is not certified by a test authenticator. |
| Forum lifetime | Memory and Valkey have identical externally visible results; TTL, departure and restart erase entries, ciphertext, indexes and subscriptions. Inspect retained fields; no member activity logs or DHT records on servers. |

LT-ROOMS is an additional mandatory build gate, scheduled on the owned CI
executor rather than public hosted runners: ramp 42/100/150/250/500 members,
p99 message latency below 1 second with no drops; 20 then 100 joins per minute
converging within 3 seconds and at most 3 retries; 60 movers from 150 over real
Tor within 60 seconds; actual low-end browser commit processing at 500 under
50 ms and 60 MB/group; 10,000 connections with renewals p99 under 200 ms and
service/Valkey CPU below 50%; restart recovery within 30 seconds. This gate does
not authorize raising the production group cap.

Small real private-Tor/browser tests belong in public CI with synthetic inputs
and no provider secrets. Public-Tor interoperability evidence, Veilid byte
conformance and Tor-population churn are retained separately. Synthetic network
exhaustion tests do not replace real transport or browser evidence. Build outputs
are files or OCI archives; no registry publication is required.

The cmsg registry and static generated descriptions are available; its live
domain actions and authorized consumer bootstrap are not. Integration also awaits
Foyer/cvld G2/G3, forum public-record admission, Inbox/Groups composition,
message-based Mesh and DHT-backed Vault restore. Exact revision/run evidence
must accompany each executed stage. Until these ports are supplied, this table
is an acceptance contract, not a harness or a successful test result.
