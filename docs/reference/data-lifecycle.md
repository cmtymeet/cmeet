# Data lifecycle for the relay proposal

8 September 2026. **Proposed retention contract, not a running service.**
[Architecture](architecture.md) · [Study and sources](../studies/relay-architecture-2026-09-08.md).
Unknown lifetimes below are release blockers, not permission to retain forever.

## Target inventory

Operator includes every service under common control. Separate databases do not
make observations unlinkable. Pseudonymous and encrypted records remain data.

| Data | Who can read or observe it? | Operator persistence | Proposed lifetime / condition |
|---|---|---|---|
| Profile, preferences, name, contacts | Member; selected recipients after sharing | None | Local until deleted; recipients independently control their copies |
| Message/media plaintext and content keys | Participating clients | None | Session by default; optional member-held encrypted history |
| Forwarded ciphertext | Relay and providers observe bytes/size | None at application layer | Connected delivery only; bounded buffers below |
| Routes, socket co-presence, IPs, timing | Live relay; provider sees its layer | No application activity history | Active connection plus dead-socket detection; provider audit required |
| Pending contact/room offers | Selected clients; relay sees routing | None | Short expiry or disconnect |
| Static site and release artifacts | Public | Yes | Operator-authored material; no member profiles |
| Passkey public key/credential records if ordinary server authentication is used | Authentication service | Yes unless verified alternative avoids it | Account lifetime, deletion/revocation to specify; no login/IP history or shared relay identifier |
| SMS number, challenge, delivery status | Gateway/provider; operator gateway sees its input | No operator number history proposed; provider retention unknown | Proposed five-minute challenge; delete operator input on success/failure/expiry; inventory provider/error/billing copies |
| VOPRF and issuer keys | Protected custody boundary | Yes | Key-version lifetime and rotation protocol; custody and input binding unverified |
| Used phone anchors | Admission service | Yes | Active membership plus defined reuse/recycling rule; model lacks a general removal lifecycle |
| Burned anchors and burn time | Sanctions service | Yes | Candidate: 24 × 30 days from latest burn (D4), followed by active deletion |
| Membership/revocation commitments, capsules, released shares | Membership/sanctions service | Yes | Account, sanction and witness horizons to specify; threshold opening can disclose associations |
| Spent invite/admission/quota nullifiers | Authorizer | Yes where replay crosses sessions | Until related tokens and allowed clock skew expire; reject old epochs before deletion |
| Composition and invite budgets | Issuer | Minimum enforcement state | Aggregate where possible; per-credential state needs reviewed unlinkability and expiry |
| Reciprocity balances / earned credits | Unresolved authority/client proof boundary | No unexplained relay history permitted | Persistent enforcement required; anonymous anti-reset and anti-collusion design unresolved |
| Personal blocks, reports to trusted peers | Members and selected peers | None at relay | Member controlled; sanction proofs separately scoped and inventoried |
| Simhash, message digests, signed receipts, allegation escrow | Depends on report design | No new production store approved | Existing proposals need leakage/custody review; content-derived values can correlate messages |
| Diagnostics | Operator/provider depending layer | No payload/IP/route logging proposed; provider records unknown | Coarse service health without member/room dimensions; provider retention separately documented |
| Legal correspondence and transparency material | Authorized handler; redacted publication where lawful | As required for actual handling | Justified retention; no automatic publication of identifying details |

This does not certify that anonymous issuance, sanctions and authentication can
yet meet all rows simultaneously. Security-state backups are extra copies with
their own expiry. Do not back up relay process memory. Key deletion cannot erase
recipient copies or old snapshots that later-released secrets can unlock.

## Transport limits to prototype

Starting parameters for synthetic measurement, not measured capacity guarantees:

- Encrypted frame maximum 64 KiB; larger media streams in chunks. Bound parsing
  before allocation and set connection, room and global memory budgets.
- Application outbound buffer maximum 256 KiB per recipient; five-second frame
  delivery deadline. Drop/close on overflow or deadline. Bound runtime/socket
  buffers too; a successful write does not prove delivery.
- Heartbeat every 30 seconds; remove a dead socket within 90 seconds of its last
  response. This detects a broken live connection, not an offline mailbox.
  Explicitly delete its routes, room membership and pending offers.
- Offers/unused rendezvous authorizations expire after five minutes or disconnect,
  whichever comes first. Reconnect creates a fresh authenticated session; old
  ciphertext and session capabilities cannot resume it.
- No disk spool, durable attachment, payload trace, heap/crash dump, swap image
  or application backup of relay state. Document uninspectable provider layers.

RAM deletion means removing application references, not guaranteed physical
overwriting or protection against a live observer.

## What the current model actually holds

Inspected at commit `0813836`. These are in-process fields/maps, **not evidence
of a deployed database**. Do not automatically port them to a production schema.

| Source location | Resident state | Migration requirement |
|---|---|---|
| [`ServerMember`, protocol.ts:88](../core/src/protocol.ts) | Credential, class, join time, current handle, invite counters, last grant, shares, revoked flag | Separate necessary security state from identity/activity metadata |
| [`ServerState`, protocol.ts:114](../core/src/protocol.ts) | Handle-to-credential map with 365-day old-name reservations; anchors, shares, ads, invites | Use local contact labels; no ad store in candidate; bound security collections |
| [`Invite`, protocol.ts:149](../core/src/protocol.ts) | Owner credential, class, issue time and spent flag | Reviewed issuance without queryable invitation ownership; keep anti-replay and budgets |
| [`Ad`, protocol.ts:157](../core/src/protocol.ts) | Plaintext body, availability, timestamps, nullifier and flagger set | Archived board model; do not port into live discovery |
| [`Network.clients`, protocol.ts:196](../core/src/protocol.ts) | All simulated client secrets, anchors and vouch maps; model also has OPRF key | Test harness only; never deploy this object |
| [`ConversationBook`, conversations.ts:172](../core/src/conversations.ts) | Stable IDs, exact last-seen times, live counterparties and balances | Session routing only in relay; drop last-seen; solve quotas separately |
| [`disconnect`, conversations.ts:199](../core/src/conversations.ts) | Removes conversations but retains/updates last-seen; balances remain | Inspect every collection after disconnect |
| [`snapshot`, conversations.ts:378](../core/src/conversations.ts) | Returns only live conversations, omitting last-seen and balances | An empty result does not demonstrate absence of conversation metadata |
| [`BurnRegistry`, anchor.ts:93](../core/src/anchor.ts) | Deletes expired burn only when that anchor is queried | Active expiry sweep and backup deletion; test untouched expired records |

## Acceptance evidence

1. Inventory actual fields stored **and observed** in authentication, transport,
   sanctions, errors, SDKs, proxies, caches, consoles and backups. A convenience
   snapshot API is insufficient.
2. With synthetic identifiers, inspect all state after disconnect, timeout, slow
   consumers, crash and restart. No old frame/offer can be fetched and no former
   member remains in a presence API.
3. Exercise client reset, restored backups, concurrent double spending, clock
   skew and old-epoch replay. Privacy changes must preserve enforcement rules.
4. Advance time without querying expired records; verify actual store deletion
   and eventual expiry from allowed backups. Reject expired tokens before
   pruning replay protection.
5. Establish authenticated E2EE, anonymous authorization, input-bound VOPRF,
   independent capsule release and group rekeying. Resolve receipt/report
   leakage and deniability (D9).
6. Compare effective deployment settings, synthetic traffic observations and
   provider documentation. Audit delivered client artifacts separately. Empty
   analytics queries cannot prove absence of internal provider records.

These checks are specified, **not executed** in this documentation review. The
68 existing model tests do not exercise transport or provider retention.
