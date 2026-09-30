# Open questions

Product questions still **Proposed** or **Open** in the source snapshot through
2026-09-30. Proposed solutions are not approved defaults. Parked means Open for
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
| I6 | Verify passkey-based vault restoration and availability when distributed records are not refreshed or other devices are offline. This is not permission to add recovery beyond the passkey. | Open | 2026-09-29 |
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
| F1 | Finalize short-lived signed match tokens, required on key requests, with a current rule recheck on the owner's device. Expiry and race behaviour remain unsettled. Automatic release, look-back and limited rejection reasons are already Decided. | Proposed | 2026-09-29–30 |
| F2 | On rejection, have the honest client discard the requester's supplied key so rejection is not a free private-profile view. Validate this with the give-first exchange; no server-mediated blind swap or manual approval is planned. | Proposed | 2026-09-29 |
| F3 | Choose match ranking. Paging and incremental updates are settled; online activity was only an example ranking idea. | Open (later) | 2026-09-29–30 |
| F4 | Deliver contact-online presence peer to peer, using per-conversation status records or direct device messages. It must not create a contact graph in the forum. Favourites and favourite-online notifications are optional later additions. | Proposed | 2026-09-29 |
| F5 | Show reciprocity from the member's own balance in the vault without a server call. | Proposed | 2026-09-29 |
| F6 | Set the public-record quorum as a platform value. Show only relative accepted/declined/punished shares once it is reached, never absolute counts. | Open | 2026-09-29 |
| F7 | Finish tamper-resistant outcome receipts, mandatory complete record proofs and punishment accounting without exposing counterpart relationships. Proof-dependent extensions were disabled in the 2026-09-30 snapshot. Preserve the distinction between decided behaviour and an unvalidated mechanism. | Proposed / Open | 2026-09-29–30 |
| F8 | Define punishment after an introduction has settled: proposed loss of one introduction from each participant, inclusion in the record, and collection from the next refill at zero balance. Block and punish must always remain available. No separate disapproval unit is proposed. | Proposed / Open | 2026-09-29 |
| F9 | Verify limited offline delivery to existing contacts and the associated queued-message UX. The initial product is online-only and first contacts remain live; broad offline investment is out of scope. | Open (later) | 2026-09-29–30 |

## Groups

| ID | Question or proposal | Status | Date |
|---|---|---|---|
| G1 | Validate fixed-membership forks, contact-only invitations with consent, seamless additive forks, explicit opt-in subgroups, retained local history, no history for newcomers, leaving and automatic cleanup. Define archive/delete settings. Start without groups if no simple satisfactory implementation emerges. | Proposed | 2026-09-29 |
| G2 | Private-group profile requests could use co-membership instead of match tokens while preserving personal rules and look-back. Semipublic groups have a different, Decided exception: explicit consent at joining replaces per-request rules. | Proposed | 2026-09-29 |
| G3 | Standing semipublic rooms: admin creation, signed consent, automatic admission by any online member, encrypted profile-key exchange, posting limits and a tentative cap around 100. Direct first contact from groups would still cost an introduction. These mechanics are parked. | Proposed / Open (parked) | 2026-09-29 |
| G4 | Decide room ordering and who may fetch encrypted private profiles. A blind forum order point using opaque room IDs and anonymous permits, later replaced by a distributed record, is only a proposal. Reconcile visible traffic volume with the requirement that the operator learn no membership/content. | Proposed / Open | 2026-09-29–30 |
| G5 | Slack-style open-topic channels are parked. Proposed preparation: typed conversations, safely ignored unknown types and extensible membership policies on MLS. Newcomer history without server storage remains unsolved. | Open (parked) | 2026-09-29 |

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
| L8 | Decide whether member-side facades move from FSL to LGPL for third-party clients, while server facades stay FSL and leaves LGPL; define the shared contributor agreement rule. Do not infer a licence change from the product's intent to welcome clients. | Open (later) | 2026-09-30 |
| L9 | Reconcile hard caps/edge limits/per-community platform quotas, labelled Proposed in the PRD and constraints in the later handoff. Cutoff for abusive communities is Decided; thresholds, exact setting authority and automatic-billing prevention still need explicit policy. | Proposed / Open | 2026-09-29–30 |
| L10 | Complete pre-launch legal review: service classification, sensitive-community membership, privacy notice, ephemeral block processing, processing records, permanent lockout and erasure/retention. Define lawful community/platform restriction scope and warning procedures without treating design notes as legal advice. | Open (required before launch) | 2026-09-29–30 |
| L11 | Complete naming/trademark clearance and review app-store requirements for community-published white-label apps. No compliance or store-approval claim follows from these product decisions. | Open (required before launch) | 2026-09-29 |
| L12 | Low-priority warrant-canary indicator: scheduled publication/non-renewal is the direction; per-signer confirmation is Proposed. Independent client/build verification was deprioritized, and voice remains later work. | Proposed / Open (later) | 2026-09-25–29 |
| L13 | Finish and validate member-side integration before presenting the product as complete. The source snapshot leaves the foyer/member architecture unfinished, production verification providers and extra-device setup unconfigured, and proof-dependent balance features disabled. Library reviews are not acceptance tests for the complete product. | Open (implementation dependency) | 2026-09-30 |
| L14 | Keep personal setting overrides only in the member's vault, outside operator access/control, with permitted choices supplied by community policy. Complete this proposed boundary alongside the per-setting override rules. | Proposed | 2026-09-29 |

Questions resolved by later decisions are not reopened here: global uniqueness,
per-community handles, CLI placement in cmeet, automatic key release, block
default B, real profile numbers and permanent no return are Decided.
