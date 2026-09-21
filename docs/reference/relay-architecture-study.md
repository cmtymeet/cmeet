# Relay architecture and minimal retained data

8 September 2026. Source inspection and primary-source research. No service was
deployed, provider account changed, member contacted or implementation modified.

## Finding

**A live E2EE relay can avoid storing member content. The previous public ad board
prevents the whole product from having that shape.** Removing the board, hosted
profiles and offline presence gives the largest reduction. It also removes
asynchronous profile browsing. Live-only discovery is a proposal awaiting the
user's preference, not a silently adopted product requirement.

The remaining service has transient communication state and persistent membership
security state. Encryption and the name "relay" cannot remove the second. The
updated [architecture](../docs/architecture.md) and [lifecycle inventory](../docs/data-lifecycle.md)
make the boundary reviewable. No operator content-moderation labour remains a
hard requirement; this review does not establish legal clearance for zero labour.

## Alternatives

| Shape | Member content with operator | Offline discovery | Consequence |
|---|---|---|---|
| Previous public board + live chat | Public plaintext ads, flags and metadata | Yes | Publishes member content; cannot describe whole product as relay-only |
| Encrypted profile/mailbox hosting | Ciphertext plus routing/index metadata | If recipients can find/decrypt it | Still storage; all-member decryption is not operator-unavailable content |
| **Live relay + member-held profiles** | Transient ciphertext in bounded buffers | No, unless another recipient shares a copy | Best fit for requested retention; introductions and overlapping online time become central |
| Member-selected host / always-on device | None of that profile store on this operator if boundaries hold | Potentially | Adds availability, recovery and host responsibilities; federation/DHT is not a complete solution |
| Software with independently operated relays | No operator relay traffic if genuinely separate | Depends on those operators | Changes the operating role and product; not selected here |

Recommendation: design the third row as the minimum service and validate its
newcomer experience. Do not add IPFS, federation or an encrypted database merely
to rename persistent hosting.

## Source findings and proposed changes

The model retains join times, current and 365-day reserved old handles, invitation
owners and issue times, ads and flagger sets. `ConversationBook` keeps exact
last-seen times and per-member balances after disconnect; its `snapshot()` omits
both maps. Burn expiry only deletes an expired anchor if it is later queried.
These are model facts, not a deployed database finding. Exact locations and
migration requirements are in the [source audit](../docs/data-lifecycle.md#what-the-current-model-actually-holds).

Proposed changes:

- Host operator-authored pages and client assets. Keep profiles, sensitive
  preferences and display names on members' devices; share with selected live
  recipients. No member directory or server matchmaking index.
- Remove offline presence, attachment storage, push subscriptions and durable
  room rosters from the candidate. The relay still observes current connections,
  traffic size and timing and needs bounded transport buffers.
- Keep invite budgets, composition, revocations, phone anchors and replay
  protection as specified security state. Anonymous quotas and earned-credit
  enforcement need real proofs; client-resettable counters are not a solution.
- Keep local blocks and trusted-peer reports on clients. Simhash clustering,
  transferable receipts and threshold allegation escrow require a leakage/custody
  design; automation alone does not make content-derived data disappear.

Phone-only admission stays. It does not give an isolated newcomer somebody to
meet. Member-hosted introductions and scheduled opening hours are candidates;
volunteers and concurrent attendance cannot be assumed.

## Provider boundary

Cloudflare documents historical Durable Object metrics filterable by object
ID/name, separately from logs. A stable object per social room would create a
stable activity dimension despite no application message storage. That backend
needs the D8 decision and live inventory. [Cloudflare metrics documentation](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/)

A controllable process can expose settings for logs, dumps, swap and backups
that a managed runtime may hide. Compare these boundaries; a VPS, home server or
different provider does not itself prove absence of retained metadata. Fresh
session handles reduce identifier reuse but not IP/timing correlation.

## Technical relay and legal classification

DSA Article 4's mere-conduit exemption has conditions about not initiating
transmission, selecting the receiver or selecting/modifying information. Automatic
intermediate storage is included only for transmission and no longer than
reasonably necessary. Article 4(3) preserves orders requiring infringement to
end or be prevented. Recital 14 distinguishes recipient-selected finite private
messaging from an online platform; that is not exclusion from every DSA duty.
Article 8 bars a general monitoring obligation. [DSA text](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1696339439479&uri=CELEX%3A32022R2065)

Inference: member-selected live forwarding is closer to that transport description
than a searchable hosted board. It does not establish that every function and
target-market obligation permits zero operator content-moderation work. D10 must
be assessed against the final service flow.

Switzerland's surveillance authority expressly includes derived communications
services (AAKD) within BÜPF scope. An Internet relay can therefore retain
cooperation obligations; the authority distinguishes these from broader duties
applicable to some providers. Minimal retention does not establish that nobody
can require operator action. [Swiss authority's duties overview](https://www.li.admin.ch/de/pflichten)

This is not a finding that the operator must defeat client-only E2EE. Nor does
this study treat the 2025 Swiss ordinance proposals as enacted: the Federal
Council announced further assessment and another consultation in February 2026.
[Federal Council update](https://www.li.admin.ch/de/newnsb/EXv-JkPBAZuL)

## Remaining work

| Item | Next evidence or decision |
|---|---|
| Live discovery (D11) | User preference pending; validate offline-browsing trade-off and newcomer access |
| Provider metadata (D8) | Compare controls, provider records and synthetic observations before choosing hosting |
| Receipt deniability (D9) | Recommend omitting transferable relay receipts from minimum transport; existing choice remains open |
| No operator moderation (D10) | Required, not proven; classify final functions and establish handling feasibility |
| Admission and quotas | Anonymous authorization, anti-reset/double-spend protection and resistance to fabricated credit |
| SMS and custody | Separate gateway number access from blinded evaluation; prove input binding and independent custody |
| Retention | Define horizons and active deletion for every persistent collection and backup |
| Client/transport | Authenticated E2EE, group rekeying, local profile exchange, real-device PRF and lifecycle checks |

Public source and reproducible artifacts help inspect intended behaviour. They
do not prove every served build matches or a remote server never logs. Publish
the verified retention boundary and its limits.
