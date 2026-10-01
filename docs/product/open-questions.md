# Open questions

Product questions still **Proposed** or **Open** in the source snapshot through
2026-10-01. Proposed solutions are not approved defaults. Parked means Open for
later work, not rejected. Library internals remain in their own repositories.
See the [stories](user-stories.md) and [decisions](decisions.md) for settled
behaviour surrounding each question.

## Identity, lobby and no return

| ID | Question or proposal | Status | Date |
|---|---|---|---|
| I1 | How does the CLI hold and use a passkey? Candidate: a software passkey in the OS keyring or a hardware key, paired as another member device with approval from a live device. Define user verification and removal as well as storage. | Proposed / Open | 2026-09-30 |
| I2 | Define admin-enabled handle changes, availability checks, lease/reuse presentation and optional display names. Per-community handles, separation from member IDs and 8–32-character length are settled. Earlier candidate: optional display-name schema field, default off, with rate-limited server availability checks. | Proposed / Open | 2026-09-29–30 |
| I3 | Reconcile unfinished-registration expiry, a coarse membership lease, release after two years and reuse two years after release. The source does not unambiguously define every starting point or whether these are successive periods. No return and permanent fingerprint burns remain binding. | Open | 2026-09-29–30 |
| I4 | Are 14-day probation and 1/30-day credential caps approved product defaults or only configurable implementation starting values? The principle of shorter new-member credentials and gate/lease expiry bounds is settled. | Open | 2026-09-29–30 |
| I5 | Complete device-removal behaviour during failed sync. Server passkey revocation and key rotation must not rely on the synced device list alone; proposed short-lived device authorizations stop at renewal. Specify propagation, notices and remaining access without promising instant remote erasure. Device-local last-used information is also Proposed. | Proposed / Open | 2026-09-29 |
| I6 | Measure passkey-PRF vault restore from the DHT population under churn, unavailable peers and unrefreshed records; verify portable passkey support. The location/key derivation and both-backend storage model are decided. Missing replicas do not authorize recovery beyond the passkey. | Open (validation) | 2026-10-01 |
| I7 | Clarify mailbox-control checks versus the earlier authentication-only wording. Third-party provider proofs do not permit social login; passkey authentication is settled. | Open | 2026-09-29–30 |
| I8 | Specify warnings for irreversible registration expiry, loss of all community passkeys, global wallet holder-secret loss, and self-ban. Explain recycled identifiers and the enforcement limits of voucher-only communities. Legal review must reconcile erasure and retention with permanent uniqueness burns. | Open | 2026-09-29–30 |

## Profiles and the editor

| ID | Question or proposal | Status | Date |
|---|---|---|---|
| P1 | Define the editor's proposed answer types and controls: choice, number, yes/no, location, short/long text; public/private, required, filterable and change presets. Use questions and understandable answer styles. Final templates, form/card views and stranger/contact views are not specified. | Proposed | 2026-09-29 |
| P2 | Add a publication-impact preview explaining which current profiles need changes or can be grandfathered. Define what counts as a small tightening and how the operator chooses strict versus grandfathered treatment. Community admins do not choose technical grace periods. | Proposed / Open | 2026-09-29 |
| P3 | Should a text field reject contact details such as links, mailbox addresses, phone numbers and other-platform handles to protect first-contact and key-release boundaries? Define the option and its limitations. | Proposed | 2026-09-29 |
| P4 | The editor story calls the private part the accepted-contact view, while the later forum story releases it automatically to eligible matches before conversation acceptance. Resolve those audience labels; do not silently add an accepted-conversation prerequisite. | Open | 2026-09-29 |
| P5 | Chatbot-assisted schema and template creation through the admin API/MCP, based on the community's goal. Parked until the basic editor and backend are ready. | Open (parked) | 2026-09-29 |
| P6 | Complete proof-backed field-change integration before enabling restricted edits. The source snapshot still refuses unproven change tokens; a successful edit is not yet a product readiness claim. | Open (implementation dependency) | 2026-09-30 |

## Forum, contact and punishment

| ID | Question or proposal | Status | Date |
|---|---|---|---|
| F1 | Match tokens are omitted from the MVP, with their format reserved. Specify the later signed-token mechanism, lifetime and race handling. Current pair checks, automatic key release and look-back remain required. | Open (later) | 2026-10-01 |
| F3 | Choose match ranking. Paging and incremental updates are settled; online activity was only an example ranking idea. | Open (later) | 2026-09-29–30 |
| F4 | Deliver contact-online presence peer to peer, using per-conversation status records or direct device messages. It must not create a contact graph in the forum. Favourites and favourite-online notifications are optional later additions. | Proposed | 2026-09-29 |
| F5 | Show reciprocity from the member's own balance in the vault without a server call. | Proposed | 2026-09-29 |
| F6 | Set the public-record quorum as a platform value. Show only relative accepted/declined/punished shares once it is reached, never absolute counts. | Open | 2026-09-29 |
| F7 | Complete proof-backed outcome/public-record integration and privacy-preserving settlement without exposing counterpart relationships. Real leaf proofs do not establish a working product path; keep unavailable operations explicit. | Open (implementation dependency) | 2026-10-01 |
| F8 | Validate the adopted established-chat punishment and debt-first refill mechanics through the real service and member stack. The one-introduction cost per party is decided; accounting/private settlement integration remains open. | Open (implementation dependency) | 2026-10-01 |
| F9 | Measure DHT-backed offline delivery to existing contacts in both backends and finish queued/stored/received failure UX. Offline delivery is in scope; first contacts remain live. Verify Veilid byte conformance, Tor-population churn and honest handling of missing records. | Open (validation) | 2026-10-01 |

## Groups

| ID | Question or proposal | Status | Date |
|---|---|---|---|
| G1 | Validate dynamic levels, consent forks, opening timeout, shrink hysteresis, lineage and scoped newcomer history with the room load test. Groups are in the MVP; cap 100 and seat economy disabled are settled. | Open (implementation dependency) | 2026-10-01 |
| G2 | Private-group profile requests could use co-membership instead of match tokens while preserving personal rules and look-back. Semipublic groups have a different, Decided exception: explicit consent at joining replaces per-request rules. | Proposed | 2026-09-29 |
| G3 | Complete anonymous room-pass authorization, replay protection, listing handover evidence and authenticated counter recovery after a forum restart. Admission rotation, signed visibility consent, bounded history and ordered living rooms are decided. | Open (implementation dependency) | 2026-10-01 |
| G4 | Prove that room ordering and relay learn only active-connection count and traffic volume per public room, with no identities, membership list, member-to-room graph or content. That disclosure is accepted; its enforcement is a validation requirement. | Open (validation) | 2026-10-01 |
| G5 | Slack-style topic channels remain later work. Direct, fork-group and living-room conversation types and bounded newcomer history are already in scope. | Open (later) | 2026-10-01 |
| G6 | Prototype the peer-attestation proof before enabling the seat economy. Measure real welcome effects and activity, run the four-week cost dry run, and review public-room consent text before launch. The local activity ledger and capped welcome/introduction credits are in scope now. | Open (validation) | 2026-10-01 |
| G7 | Resolve remaining parameter inconsistencies: the exclusion-fork cost has two setting keys; the two-member behaviour-band overshoot prose does not match its 20/18 example; split-fork classification below 43 needs clarification against ordinary shrink hysteresis at 36. Do not invent replacement values. | Open | 2026-10-01 |

## Domains, white label, clients and launch

| ID | Question or proposal | Status | Date |
|---|---|---|---|
| L1 | Confirm the platform base domain: the domain scheme calls `cmeet.me` a placeholder, but the later decision explicitly names `wallet.cmeet.me`. Complete reserved slugs for every infrastructure hostname. | Open | 2026-09-29–30 |
| L2 | Automate three nested hostnames per community and recheck the recorded provider limit before relying on the roughly 33-community planning figure. Select a scale path that keeps nested names, free certificates, serverless operation and abuse containment compatible. Let's Encrypt over paid certificates is settled; the hybrid route is Proposed. | Proposed / Open | 2026-09-29 |
| L3 | Choose free-certificate termination for customer domains after checking platform limits and cost. Cloudflare for SaaS or another platform was not selected; no paid service is approved. | Open | 2026-09-29 |
| L4 | Complete branding for mail senders, error pages and links. Confirm how platform-domain requests appear to members and in browser developer tools. The global wallet visit is a later Decided exception to an entirely community-branded journey. | Proposed / Open | 2026-09-29–30 |
| L5 | Reconcile the earlier measured Flutter-versus-native-shell comparison with the later Tauri repository layout. If still needed, compare the same screens for phone startup, bundle size, UI smoothness and effort per brand. Native notification timing exposure needs consideration. | Proposed / Open | 2026-09-29–30 |
| L6 | Specify endpoint guard/authentication/rate limits and the third-party API versioning/stability contract. Generated API/CLI/MCP surfaces do not alone settle compatibility policy. | Proposed | 2026-09-29 |
| L7 | Settle admin/root details: roles as gates, scope limited to settings/admins, separate operator identities, fresh passkey confirmation for dangerous actions, affected-admin action logs, reserved names and badges. | Proposed | 2026-09-29 |
| L8 | Define the shared contributor-agreement rule and cmeet BSL Change Date/Additional Use Grant details. Licensing A is settled: server and member facades FSL, leaves LGPL, product BSL; unchanged cmsg exposes the third-party local API. | Open (remaining terms) | 2026-10-01 |
| L9 | Reconcile hard caps/edge limits/per-community platform quotas, previously labelled Proposed and later recorded as constraints. Cutoff for abusive communities is Decided; thresholds, exact setting authority and automatic-billing prevention still need explicit policy. | Proposed / Open | 2026-09-29–30 |
| L10 | Complete pre-launch legal review: service classification, sensitive-community membership, privacy notice, ephemeral block processing, processing records, permanent lockout and erasure/retention. Define lawful community/platform restriction scope and warning procedures without treating design notes as legal advice. | Open (required before launch) | 2026-09-29–30 |
| L11 | Complete naming/trademark clearance and review app-store requirements for community-published white-label apps. No compliance or store-approval claim follows from these product decisions. | Open (required before launch) | 2026-09-29 |
| L12 | Low-priority warrant-canary indicator: scheduled publication/non-renewal is the direction; per-signer confirmation is Proposed. Independent client/build verification was deprioritized, and voice remains later work. | Proposed / Open (later) | 2026-09-25–29 |
| L13 | Complete member-stack integration, room/privacy/load checks and DHT conformance/churn evidence. Foyer is built now; additional passkey registration has service-level evidence, but device signing-key authority, production providers and proof-dependent product adapters still need integration. This is not a readiness certification. | Open (implementation dependency) | 2026-10-01 |
| L14 | Keep personal setting overrides only in the member's vault, outside operator access/control, with permitted choices supplied by community policy. Complete this proposed boundary alongside the per-setting override rules. | Proposed | 2026-09-29 |

## Network validation

| ID | Question or proposal | Status | Date |
|---|---|---|---|
| N1 | Qualify Veilid browser HTTPS support, routes and privacy before it becomes primary. Keep Tor as a full backup. The approved Veilid retention experiment is deprioritized; no operator mailbox or record expiry is introduced by that delay. | Open (validation) | 2026-10-01 |
| N2 | Verify preload through real Tor bootstrap/onion publication and show useful progress/failure states. Members can use the app only after the connection stands. | Open (implementation dependency) | 2026-10-01 |

Questions resolved by later decisions are not reopened here: licensing A,
frontend-only access through cmsg, Foyer admin/root forwarding, dynamic groups,
accepted public-room metadata, preload, two full backends, DHT offline/restore,
global uniqueness, per-community handles, CLI placement, automatic key release,
rejected-key discard, block default B, real profile numbers and no return.
