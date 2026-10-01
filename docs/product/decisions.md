# Product decisions

Recorded decisions through **2026-10-01**. See the [status legend](README.md#status-legend)
and [open questions](open-questions.md). Dates identify the source decision or
its later clarification. Decided does not mean implemented. Superseded options
are identified where they could otherwise change the meaning of a requirement.

## Identity and passkeys

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Global uniqueness | Verify a person once; allow multiple communities without exposing membership in one to another. Member IDs are stable per-community pseudonyms; handles are per community. | Decided | 2026-09-30 |
| Wallet | The global credential lives at `wallet.cmeet.me`; visit on joining and infrequent credential renewal. Proofs and community pseudonyms are created on the device. Community passkeys remain scoped to their community domains. | Decided | 2026-09-30 |
| Ownership | The profile belongs to the passkey holder. Transfer, sharing and theft until revocation are accepted limits; mutable gates still apply. | Decided | 2026-09-29 |
| Logical device | A synced passkey ecosystem counts as the device even when hardware changes. Require user verification; passkey-platform unlock factors are that platform's responsibility. Communities can gate sensitive actions further. Majority approval, cold keys and general waiting delays are not the access model. | Decided | 2026-09-29 |
| Devices | Add devices from a live device, remove them in the lobby, and let members name them. Names and the mapping to passkeys belong only in the encrypted member vault. Removing a device rotates keys and starts a new epoch. | Decided | 2026-09-26; 2026-09-29 |
| Activity records | No login dates, server-side last-used dates, request logs or raw gate data. The authentication counter detects clones; it is not a time record. | Decided | 2026-09-30 |
| Device-sync safety | Device-local last-used information is optional; revocation must work despite sync failure. Complete client authorizations, renewal timing and failure UX remain unresolved. | Proposed / Open | 2026-09-29 |
| External providers | Third-party identity providers supply admission proofs, not social login. Passkeys authenticate. Mailbox control is a global check; its older authentication-factor wording still needs clarification. | Decided / Open | 2026-09-29–30 |
| Handles | 8–32 characters, normalized and checked for confusable, reserved and inappropriate names using established libraries. Handle changes appear unavailable by default; admin-enabled changes and optional display names still need definition. | Decided / Open | 2026-09-29–30 |

## Lobby and gates

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Entry | One sign-in/register button; establish the handle at registration. Every login visits the lobby before the forum; admission must succeed first. | Decided | 2026-09-29 |
| Resumability | Show missing active gates only; finish them in any order. Profile creation uses the same gate flow. Steps are headless data for web, CLI, MCP and third-party clients. | Decided | 2026-09-29 |
| Pending registration | Registered-but-not-admitted exists. Unfinished registrations expire and registration is rate-limited against squatting. Expiry permanently prevents return, so warn before it happens. | Decided | 2026-09-29–30 |
| Gate policy | Actions are allowed or refused with missing requirements. Gates can be combined. Providers/gates are on or off: confidence levels and trust-anchor scoring were withdrawn. | Decided | 2026-09-25; 2026-09-29 |
| Gate scopes | Global: phone, government ID, human verification, Privacy Pass, mailbox, third-party proof and platform fee. Community: voucher, community fee, deposit, proximity, profile check, balances and community legal block. Effort is per action, never money or a stored admission fact. | Decided | 2026-09-30 |
| Minimal recording | Store no raw gate evidence or profile values. Any raw evidence a provider must retain stays with that provider. Gate handling can transiently see its input; admission consumes proofs. | Decided | 2026-09-25; 2026-09-29 |
| Admission and changes | Person and profile are checked together on every forum entry and profile change. A valid profile does not excuse invalid membership. The forum uses signed policy material rather than asking admission about a member at runtime. | Decided | 2026-09-29–30 |
| Credential renewal | Validity is bounded by gate expiry and a standing-dependent cap, also respecting the membership lease. Legal blocks, failed gates and removed keys revoke access early; tightened admission sends members through the lobby again. | Decided | 2026-09-29–30 |
| Starting lifetimes | The recorded starting values are 14-day probation and credential caps of 1 day for new members / 30 days for established members. They are configurable implementation defaults; their status as approved product defaults is not explicit. | Open | 2026-09-29–30 |

## Profiles and schema

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Initial content | No pictures initially. Every field has a validator. Gates verify at admission and do not certify or retain profile attribute values. | Decided | 2026-09-29 |
| Values | Real typed values, including exact numbers such as age 34; ranges belong to rules. Coarse bands/categories were withdrawn. | Decided | 2026-09-29 |
| Public/private boundary | Community schemas cover both parts. Sender validates both, forum validates public data, receiver validates the private part after decryption. The forum cannot inspect private plaintext; client checks are member protection, not reports to the operator. | Decided | 2026-09-29 |
| Storage and release | Public attributes and rules live in forum memory while online; the encrypted private profile lives there too. Keys come only from the owner peer to peer, never via platform servers or other key holders. Readers may cache approved keys and received profiles in their vaults. The DHT profile-storage alternative was dropped. | Decided | 2026-09-28–29 |
| Field changes | Each field specifies permitted change frequency. Restricted fields use hiding pins and a change budget; an authorized change spends a balance token and replaces the pin. Admission never stores the value or salt. Per-field pins reveal which field changed and when. | Decided | 2026-09-29 |
| Editor | Drag-and-drop questions, understandable answer styles, always-visible preview, public front/private back flashcard direction. The schema remains typed underneath. | Decided | 2026-09-29 |
| Editor details | Choice, number, yes/no, location, short/long text; required/filterable/change-preset controls; common-field templates; form/card and stranger/contact views; publication impact preview. Text fields could forbid contact details. | Proposed | 2026-09-29 |
| Schema changes | Hide/remove public fields immediately; loosening requires nothing; private-only changes are checked on clients. Initially enforce the current schema strictly until grandfathering exists. Later, the operator may choose grandfathering for small changes; that boundary remains unresolved. Community admins do not set technical grace periods. | Decided / Open (later grandfathering) | 2026-09-29; 2026-10-01 |
| Assisted editing | A chatbot could turn the admin's community goal into a schema and templates through the same admin API/MCP. | Open (parked) | 2026-09-29 |

## Forum and matching

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Presence | Online means present; no presence switch. Disconnect removes the member's entry, rules and ciphertext. Forum storage is ephemeral; no persistent member activity history. Only authenticated members reach it. | Decided | 2026-09-28–30 |
| Discovery | Search the community's typed fields with two-way rules. Matching evaluates a pair; matchmaking finds candidates and keeps results current. Stable member IDs key entries, accepting the risk of linkage in a live snapshot or compelled logging. | Decided | 2026-09-28–29 |
| Match feed | Page results and deliver incremental arrival/departure updates; do not download a full match list. Ranking is designed later. | Decided / Open | 2026-09-29–30 |
| Member view | Adapt active-member views to the device; expose filters, reciprocity, inbox, online state and lobby settings. Support compact messenger use beside other work. | Decided | 2026-09-29 |
| Contact presence | Members need to see existing contacts come online, without storing that contact presence in the forum. Peer-to-peer implementation remains Proposed. Favourites/notifications are optional. | Decided / Proposed | 2026-09-29 |
| Profile requests | Automatic rule-based release only; no manual approval. The requester gives their own key first, enabling look-back. Public-card views do not count. No blind server-mediated key swap. | Decided | 2026-09-29 |
| Notices and reasons | Notify the owner of every accept/reject. Owner sees full reasons; requester sees only the failing field, never the owner’s rule or values. Accepted requests retain the look-back key; honest clients discard it on rejection. | Decided | 2026-09-29; 2026-10-01 |
| Match tokens | Omitted from the MVP, with their format reserved. Current reciprocal checks still govern profile access. A later signed-token mechanism and its lifetime remain open. | Decided (MVP) / Open (later mechanism) | 2026-10-01 |
| Reciprocity display | Read the meter from the member's own vault balance without a server call. | Proposed | 2026-09-29 |

## First contact

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Live introductions | Both participants are online. Reserve one sender introduction and one recipient incoming slot. A full recipient must answer or decline to free capacity. | Decided | 2026-09-29 |
| Answer | Return both reservations immediately; established conversations are unmetered. | Decided | 2026-09-29 |
| Decline / close | Return the recipient's slot immediately and the sender's introduction after the waiting period. | Decided | 2026-09-29 |
| Silence | Return the sender's introduction after the waiting period; keep the recipient's slot occupied. | Decided | 2026-09-29 |
| Punish | Burn both reservations and automatically block the sender. | Decided | 2026-09-29 |
| Public record | Show relative shares of accepted/declined/punished sent introductions, if verifiable; never counts. Show nothing before a minimum quorum. The quorum value is still unset. | Decided / Open | 2026-09-29 |
| Integrity | Recipient-signed receipts and zero-knowledge proofs could enforce outcomes and record completeness. Changes in the displayed record can reveal an outcome occurred, without saying with whom. | Proposed | 2026-09-29 |
| Offline scope | Offline messages to existing contacts and vault restore rest on the DHT population in both network backends. This supersedes the online-only MVP restriction. First contacts remain live; disconnect ends live sessions and discovery. Queued or replicated ciphertext is not a delivery receipt; availability depends on surviving replicas. | Decided | 2026-10-01 |

## Blocking and punishment

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Default B | Store blocks on the member's devices and send them as never-match rules while online. The blocked member no longer sees the blocker in the forum. Stop contact and key release. Forum forgets the rule on disconnect. This supersedes device-only default A. | Decided | 2026-09-29 |
| Always available | Block and punish work at any time in any conversation, not only during first contact. Punish costs both people and always blocks. | Decided | 2026-09-29 |
| Conversation exits | Respectfully close or punish; make the punishment wording stark. | Decided | 2026-09-29 |
| Established chats | Adopt the balance stack’s established-chat punishment and debt mechanics: cost one introduction per party and consume debt before refill. Proof-backed service integration and privacy-preserving settlement still gate availability. | Decided / Open (implementation) | 2026-10-01 |
| Governance | Numerical outcomes only: no reports, message-reading moderators or operator access to message content. | Decided | 2026-09-29 |
| Legal and platform restrictions | Separate community blocks, temporary platform suspension after warning, and permanent platform restrictions for legal orders or self-ban. Legal scope and applicable obligations require review before launch. | Decided (direction) / Open (review) | 2026-09-30 |
| Voluntary closure | A permanent self-ban: show a prominent red warning that the member cannot return and require fresh passkey confirmation. This replaces the earlier separate termination proposal. Erasure/retention obligations require legal review. | Decided / Open | 2026-09-29–30 |

## Groups

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| MVP scope | Groups are in scope, with a configurable cap of 100. Formats, APIs and stored data cover later features; fewer enabled features must not require disruptive migrations. Full testing and the room load test are build requirements. | Decided | 2026-10-01 |
| Dynamic levels | One group concept changes with size: Circle 3–12, Ingroup 13–42, Public room 43–100. Circles and Ingroups are hidden; Public rooms are listed in the forum. | Decided | 2026-10-01 |
| Privacy transitions | More visibility requires a consent fork at 12/13 and 42/43; only consenting members move. An opening room has 21 days to reach 43, otherwise becomes hidden and profile-visibility consent lapses. Automatic transitions only increase privacy: Public to Ingroup at 36 or fewer, Ingroup to Circle at 10 or fewer. | Decided | 2026-10-01 |
| Behaviour by size | Nine policy bands, every 5–10 members, vary notifications, posting pace, vouching and newcomer history smoothly. Privacy changes only at the two consent thresholds. Every group shows its level and what changes next; promotion is an invitation. | Decided | 2026-10-01 |
| Consent and profiles | Public-room joining explicitly consents to mutual private-profile visibility, stated on the join screen and signed. Look-back and blocking still apply. Personal rules continue outside this consented context. | Decided | 2026-09-29; 2026-10-01 |
| Forks and safety | No group admins, roles or expulsion. Members may leave or propose add/exclusion/split/merge/open forks; each mover consents. Nonmovers keep their old group. Show lineage as one conversation while retaining local history. After 72 hours, the larger public fork takes the listing; ties favour the older lineage. | Decided | 2026-10-01 |
| Newcomer history | Circles give no prior history. Ingroups offer recent history by band: 14 days (up to 200 messages), 7 days or 3 days. Public bands offer 24 hours/100 messages, 12 hours/50, or 6 hours/50. Members hand over the bounded history; the server holds no readable history. | Decided | 2026-10-01 |
| Standing rooms | Community admins create public seed rooms; they are exempt from automatic withdrawal when small. Public rooms are living groups with ordered joins and changes, not a new fork for every join. | Decided | 2026-10-01 |
| Public-room service | Blind ordering and encrypted relay use opaque room IDs and room passes. The accepted disclosure is active-connection count and traffic volume per public room; no identities, membership lists, cross-room member graph or message content. Exact permit and restart-recovery proofs remain integration work. | Decided / Open (implementation) | 2026-10-01 |
| Joining and Waves | Joining, forking, merging and splitting never cost a Wave. Direct first contact from a group costs a Wave as usual. Public rooms above 59 members allow at most six joins per hour; members enforce posting pace on sending and receiving. | Decided | 2026-10-01 |
| Welcome and introductions | A welcome earns 0.25 Wave; a successful introduction earns 1 Wave. Signed receipts, a 1.5-Wave weekly cap and available capacity headroom bound the credit. The introduced pair still use normal first contact. This feature is in the MVP. | Decided | 2026-10-01 |
| Suggestions | Devices suggest splitting crowded groups or merging small overlapping groups. Suggestions are banners; moves still require consent. The server receives no conversation graph. | Decided | 2026-10-01 |
| Seat economy | Formats and settings only at launch, disabled with `seats.enabled=false`. Reserve an attention budget with refill 1/day, capacity 10 and initial 5; passive seats weigh more in tiny or crowded groups, and one real message per week makes a seat free. No purchase, transfer or conversion to Waves. Activity is recorded only on the member’s device. | Decided | 2026-10-01 |
| Later activation and cap | Run a four-week dry run before enabling seat spending. Keep cap 100 initially; raise public rooms to 150 only after the load test passes with twice the margin. Removing the social hard cap also requires the seat economy, with a technical ceiling of 500 pending its load test. | Decided | 2026-10-01 |
| Forum connection | Groups and rooms share Board’s single forum connection. Groups owns membership, Threads owns encrypted conversations/history, and the member door coordinates them. | Decided | 2026-09-30; 2026-10-01 |
| Future channels | Slack-style topic channels remain later work. Conversation types already distinguish direct, immutable-fork group and living room, with unknown types safely ignored. | Decided (formats) / Open (channels) | 2026-10-01 |

## Networks, offline messages and preload

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Two full backends | Veilid is the primary network in the making. Launch with Tor and retain it as a fully established backup; it becomes secondary when Veilid is stable. Both are full backends behind the same network-independent Mesh interface. | Decided | 2026-10-01 |
| Follow Veilid | The Tor backend follows Veilid’s DHT decisions and byte formats: records, keys, schemas, subkeys and VLD0, checked against upstream test vectors. Switching backend is configuration and native rehydration, without a second record format. | Decided | 2026-10-01 |
| DHT population | Every device acts as a node while the app is in use, with DHT capability on by default. The operator stores no DHT records. Members need no always-on node or infrastructure to manage. | Decided | 2026-10-01 |
| Retention | Follow Veilid’s bounded storage and least-recently-used eviction, with no record expiry. Owners rehydrate on open; offline writes queue and watches follow changes. This does not guarantee that a record survives churn or that a queued message reached its recipient. | Decided | 2026-10-01 |
| Restore | A surviving synced passkey derives the vault location and key through its PRF secret. Fetch encrypted vault records from the DHT population; there is no operator recovery beyond the passkey. Missing replicas are an availability failure, not a new identity. | Decided | 2026-10-01 |
| Preload | Establish the network connection before members can use the app. The frontend waits for readiness, including Tor bootstrap and onion publication, and shows connection progress or failure. Members need no knowledge of Tor or peer-to-peer networking. | Decided | 2026-10-01 |
| Service traffic | Member-to-service traffic uses HTTPS directly by default; an optional Tor switch may come later. Anonymous networking carries member-to-member traffic. No server onion service is part of this design. | Decided | 2026-10-01 |
| Qualification | Veilid byte conformance, Tor-population churn, backend/browser interoperability and privacy review need evidence. The Veilid retention experiment is approved but deprioritized; it does not reopen the two-backend or DHT-storage decisions. | Open (validation) | 2026-10-01 |

## Domains and TLS

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Nested scheme | Canonical community `<community>.cmeet.me`; member API/MCP `api.<community>.cmeet.me`; admin API/MCP `api.admin.<community>.cmeet.me`; platform API/MCP `api.root.cmeet.me`. Keep `api.[role.]<scope>.cmeet.me`; flat names were rejected. | Decided | 2026-09-29 |
| Domain naming | The earlier scheme treats `cmeet.me` as a placeholder with the final platform domain Open; the later wallet decision explicitly names `wallet.cmeet.me`. Reconcile before provisioning. | Open | 2026-09-29–30 |
| Reserved slugs | Reserve `root`, `admin`, `api`, `www`, `mail`, `mcp` and other infrastructure names to prevent hostname collisions. The complete list needs to cover the wallet too. | Decided (reservation) / Open (list) | 2026-09-29–30 |
| Initial TLS route | Use free certificates for stacked hosts through Workers custom domains; do not buy Advanced Certificate Manager. Each hostname gets its own route/certificate. Avoid duplicate DNS records and accidental destructive hostname replacement. | Decided (direction) | 2026-09-29 |
| Provisioning and scale | Automate the canonical/member/admin hosts at community creation. The planning limit recorded on 2026-09-29 was 100 Workers custom domains per zone, roughly 33 communities before shared hosts reduce capacity. Recheck provider limits and choose the scaling route. | Proposed / Open | 2026-09-29 |
| Paid certificates | Use Let's Encrypt if certificates would otherwise cost money. A hybrid beyond the initial free-host allowance is only Proposed; reconcile it with serverless operation and abuse protection. | Decided / Proposed | 2026-09-29 |
| Customer domains | Certificate termination for a customer's domain remains Open. Evaluate free-certificate platforms and their limits before choosing a route; no paid service is approved. | Open | 2026-09-29 |

## White label

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Ownership | Communities own the landing page, editorial content, branding and custom domain. Default page is sign in/register only. | Decided | 2026-09-29 |
| Brand surfaces | Community-branded mail senders, links and errors are Proposed. Visibility of platform requests in browser developer tools was described as acceptable but not explicitly settled. Global wallet visits are Decided. | Proposed / Decided (wallet) | 2026-09-29–30 |
| Themes | Offer limited admin theming options. Third parties may create their own frontends through the API; bespoke themes are not a promised platform service. | Decided | 2026-09-29 |
| Future apps | Intended model: each community publishes its white-label app through its own developer account; the platform provides a build pipeline. Review applicable store requirements before launch. | Decided (direction) / Open (review) | 2026-09-29 |

## Frontend and clients

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Equal API access | API first, MCP everywhere, no privileged web path or favoured client. Agents pair as revocable devices and are not marked. Member MCP runs locally with member keys. | Decided | 2026-09-29 |
| Web first | Svelte 5 responsive SPA/PWA, headless components under the product UX, Rust core behind platform adapters. Build for phone and desktop; performance, battery use and extensibility matter. React was rejected. | Decided | 2026-09-29 |
| Native route | Earlier: measure Flutter against Svelte with a native shell when white-label apps are requested. Later: repository layout names Tauri desktop/mobile sharing the web UI. Whether the comparison is fully superseded remains ambiguous. Native push timing exposure also needs consideration. | Decided (layout) / Open (comparison) | 2026-09-29–30 |
| Product repository | One BSL `cmeet` repository: `apps/web`, `apps/tauri`, `apps/cli`, `ui/`, thin shared `core/`, and `tests/toy`. Libraries live in their own repositories. No separate product CLI repository. | Decided | 2026-09-30 |
| CLI | One Rust program: `cmeet`, `cmeet tui`, `cmeet mcp`; both product and toy-model tool. Every frontend calls only `cmsg`. Admin/root commands derive from the admission action registry and are forwarded by `cmsg` through Foyer to `cvld`; they do not go through the forum. Service binaries keep serve/operator tasks. | Decided | 2026-09-30; 2026-10-01 |
| CLI passkeys | Candidate: pair the CLI as another device, with a software passkey in the OS keyring or a hardware key, approved by an existing device. Storage and user-verification flow are unresolved. | Proposed / Open | 2026-09-30 |
| Admin/root | Root selects communities and overrides admins; admins work per community; both use passkeys and API/MCP. Calls follow frontend → cmsg → Foyer → cvld. Roles-as-gates, separate identities, step-up confirmation, visible action logs and badges remain Proposed. | Decided / Proposed | 2026-09-29; 2026-10-01 |
| Sparse policy | Inherit platform → community → member where allowed; unset inherits and explicit empty stops. Apply bounds/force switches. Technical/security values follow the platform live; templates are pinned and adopted by admins. Changes are versioned and prospective with notice. Personal answers are never pre-filled. | Decided | 2026-09-29 |
| Personal settings | Keep member overrides only in the vault, outside operator access/control; publish permitted member choices alongside resolved community settings. | Proposed | 2026-09-29 |
| Third-party contract | The cmsg local API is the official third-party interface, defined once with generated HTTP, MCP and TypeScript surfaces. Third-party apps embed cmsg unchanged and use those endpoints. Local client capabilities and origin checks protect access. Detailed compatibility/versioning policy remains open. | Decided / Open (compatibility) | 2026-10-01 |
| Licensing A | Facades are FSL on both server and member sides; leaves are LGPL; cmeet is BSL. Commercial clients that substitute cmeet require a licence during FSL’s two-year competing-use restriction. Member-side LGPL is no longer an open alternative. Contributor-agreement policy and the product’s BSL grant/date details remain open. | Decided / Open (remaining terms) | 2026-10-01 |
| Other later features | Voice is not enabled now; do not rule it out. The warrant-canary client indicator is low priority; its per-signer confirmation procedure remains Proposed. | Decided (scope) / Proposed | 2026-09-25; 2026-09-29 |

## Runtime and storage

| Topic | Decision | Status | Date |
|---|---|---|---|
| Services | Rust APIs for admission and forum servers and the member runtime deploy independently, together initially. Frontends use only the member API. Servers exchange only public signed HTTPS material, with no shared database, network or secrets. | Decided | 2026-10-01 |
| Forum storage | Managed Valkey, heartbeat-renewed presence and polling before push. Persistence preferably off; provider SSD caching is tolerated. The Valkey adapter warns instead of refusing when persistence is enabled. All forum state still has bounded expiry. | Decided | 2026-10-01 |
| Updates | Servers publish a minimum version; the member runtime refuses to run below it. | Decided | 2026-10-01 |
| Foyer scope | Build the member-side Foyer now, including admission and forwarding of admin/root actions. This is a build requirement, not a readiness claim. | Decided | 2026-10-01 |

## Costs and abuse limits

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Containment | Operate serverless. Throttle or stop a community causing excessive issues without harming other communities. Quota exhaustion, including downstream services, is a product risk. | Decided | 2026-09-29 |
| Caps and edge checks | Hard caps with service cutoff instead of automatic billing; reject unauthenticated abuse cheaply and limit requests before expensive work. Put per-community quotas in platform policy. Later decisions call these constraints; their detailed policy remains unresolved. | Proposed / Open | 2026-09-29–30 |
| Client checks | Run pure checks on the client first for usability; repeat them on the server. | Decided | 2026-09-29 |
| Money boundaries | Platform fees fund the platform; community fees fund the community. No revenue sharing that would link them. Deposits are per community; hold/release/forfeit rules are distinct from payment movement. | Decided | 2026-09-25; 2026-09-30 |
| Launch review | Review legal classification, sensitive-community membership data, privacy notices, the basis for ephemeral blocks, required processing records, retention/erasure, branding and app-store requirements before launch. | Open (required before launch) | 2026-09-29–30 |

## No return

| Topic | Decision or unresolved detail | Status | Date |
|---|---|---|---|
| Permanent lockout | Expired registration or loss of every passkey prevents joining that community again. Burned uniqueness fingerprints are never released, including identifiers that may later be reassigned to someone else. | Decided | 2026-09-30 |
| Prevention | Warn clearly before registration expiry; urge a synced passkey or multiple registered devices. | Decided | 2026-09-30 |
| Surviving passkey | Restore location and key come from the passkey PRF; encrypted vault records live in the DHT population in both backends. No recovery beyond the passkey. Record availability under churn still needs measurement. | Decided / Open (validation) | 2026-10-01 |
| Global holder loss | Loss of the global wallet holder secret also causes permanent global lockout in the recorded design. Public warnings must distinguish this from losing one community credential. | Decided (recorded constraint) / Open (UX) | 2026-09-30 |
| Handles versus identity | The source records a coarse lease renewed with credentials, two-year expiry/release language, and reuse of released handles after two years. Handle reuse never revives the old member ID or frees burned uniqueness fingerprints. Exact start points for the periods are ambiguous. | Decided (principles) / Open (timing) | 2026-09-29–30 |
| Self-ban | Voluntary closure is permanent, freshly passkey-confirmed and prominently warned. Enforcement is only as strong as uniqueness gates; voucher-only communities cannot reliably recognize a returning person. | Decided (closure) / Open (limit communication) | 2026-09-29–30 |
