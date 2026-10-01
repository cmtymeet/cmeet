# Product glossary

Vocabulary as of **2026-10-01**. Library entries describe responsibility, not
shipping status. Detailed architecture belongs in the library repositories.

## Product terms

| Term | Meaning |
|---|---|
| Community | One independently branded place with its own membership, handles, admission policy and profile schema. |
| Member ID / community pseudonym | Stable identity within one community, derived without exposing the person's identities in other communities. |
| Handle | A community-local name, 8–32 characters, separate from the permanent member identity. |
| Passkey | The authentication and vault-unlock basis; possessing it defines control of the profile. |
| Device | An authorized member client; a synced passkey ecosystem can span several physical devices. |
| Agent device | A revocable device used by an agent, with no special agent marker or exemption from gates. |
| Wallet | The member-held credential/proof functionality, including the global credential at `wallet.cmeet.me`. |
| Vault | The member's encrypted community state: keys, devices, history, contacts, blocks and cached profiles. |
| Gate | A check that supplies proof needed for an action; only active requirements appear in the lobby. |
| Action | Something a member or operator wants to do, allowed or refused by the relevant policy. |
| Policy / rulebook | Settings and gate combinations controlling actions, with permitted sparse overrides. |
| Sparse setting | A value that inherits when absent; explicit empty values stop inheritance. |
| Lobby / foyer | The entry and settings space for registration, gates, profile completion and device management before the forum. |
| Passport | The global anonymous credential shown through proofs and a community-specific pseudonym, not as a reusable global identifier. |
| Community credential | Signed evidence of admission, bounded by validity and revocable when eligibility changes. |
| Policy epoch | A policy generation that can invalidate older credentials and require another lobby visit. |
| Forum | The ephemeral meeting place for online presence, profile listings and matchmaking. |
| Board | The member-side view and connection to the forum. |
| Matching | Evaluating whether two members satisfy each other's rules. |
| Matchmaking | Finding matching candidates efficiently and delivering current, paged results and changes. |
| Match token | A reserved format for a possible later signed match statement; omitted from the MVP. Current reciprocal checks still govern access. |
| Public profile / card | Typed searchable fields visible through the forum's permitted discovery results. |
| Private profile | Encrypted profile content whose key is released peer to peer under rules or semipublic-group consent. |
| Look-back | A private-profile requester supplies their own key first so an accepting owner can view them in return. |
| Schema | The community's typed definition of public/private profile fields, validation and change restrictions. |
| Pin / seal | A hiding commitment that limits field changes without storing the profile value in admission services. |
| Grandfathering | Allowing an older profile after some schema tightening instead of immediately excluding it from matching. |
| Wave / introduction / first contact | A live first contact reserving one sender introduction and one recipient incoming slot; direct first contact from a group follows the same rule. |
| Reciprocity | The balance rules for introductions, responses, waiting and punishment. |
| Public record | Quorum-gated relative accepted/declined/punished outcomes, never absolute counts. |
| Block B | A device-retained block sent as an online forum rule, hiding the blocker from the blocked member. |
| Punish | A costly response affecting both parties and automatically blocking the other member. |
| Private group | A hidden Circle or Ingroup with consent-based membership changes and no admin/expulsion hierarchy. |
| Circle | Hidden group of 3–12, invited through own contacts; newcomers receive no previous history. |
| Ingroup | Hidden group of 13–42 with vouching and recent newcomer history set by size band. |
| Opening room | Consented public fork with 21 days to reach 43; otherwise it becomes hidden and visibility consent lapses. |
| Seat | Membership in a group. The future attention budget is formats only at launch, with no seat spending. |
| Fork | A related group with changed membership, while existing members retain their local history. |
| Public room / semipublic group | Listed living group, normally 43–100 members, with ordered changes and explicit mutual private-profile visibility consent. Public seed rooms may start smaller. |
| Admin | A community operator controlling that community's permitted settings. |
| Godmode / root | The platform interface that selects communities and can override their admins. |
| White label | Community-controlled branding, landing content and domains over the shared product. |
| No return | Permanent refusal after registration expiry or loss of all passkeys; handle reuse does not restore identity. |
| Self-ban | Voluntary permanent closure, confirmed with a fresh passkey and a clear no-return warning. |
| Preload | Establishing the network connection before member use, including Tor bootstrap and onion publication. |
| DHT population | Participating device nodes storing sealed records for offline messages and vault restore; capacity and churn limit availability. The operator stores no records. |
| MCP | Model Context Protocol, exposing product actions to agents; member actions run on the member's machine. |

## Which library does what

| Library | Responsibility |
|---|---|
| `cvld` | Admission service: authentication, gates, membership and policy across global and community scopes. |
| `cglb` | Global verification, uniqueness and platform suspension, separate from community data. |
| `cmty` | Community admission, composing membership, gatekeeping and policy. |
| `cmbr` | Membership lifecycle, handles, passkeys, lobby state and pins. |
| `cgts` | Gatekeeping: run community checks and consume verified global proofs. |
| `cplc` | Policy and admission decisions over verified settings and evidence, with signed credentials and publications. |
| `crbk` | Rulebook: inherited settings, overrides, bounds and gate policy. |
| `crgs` | Register: handles, roles and coarse membership leases. |
| `cnrl` | Enrolment lifecycle, resumable registration and terminal no-return states. |
| `cpky` | Server-side passkey registration and authentication verification. |
| `cpns` | Pins that constrain profile-field changes without retaining field values. |
| `cshm` | Community profile schema definition, versioning and change classification. |
| `cgrd` | Guard checks on member/profile bundles and rules, reused on services and devices. |
| `csgn` | Signing and verification of scoped credentials and policy snapshots. |
| `cpsd` | Anonymous credential issuance and proofs with unlinkable community pseudonyms. |
| `csrn` | Assurance: verifies and follows signed community material from cvld. |
| `cchr` | Charter: verified community material and revisions under Assurance. |
| `cgth` | Gather: Attend, Lookup and [Forum rooms]. |
| `ctnd` | Attend: live entry, heartbeat, update and departure. |
| `clkp` | Lookup: typed indexes, candidate selection and paged match feed. |
| `cpfl` | Profile: own profile and rules as one signed publication under Board. |
| `cfrm` | Ephemeral forum door for attendance, matching and blind public-room ordering/relay. Room disclosure is connection count and traffic volume only. |
| `cmsg` | Member door and official local API for all frontends, including CLI and third-party clients; forwards admin/root actions through Foyer. |
| `cfyr` | Foyer: counterpart of cvld for admission, login, lobby, devices and admin/root forwarding; in the current build scope. |
| `cbrd` | Board: the sole member-side forum connection, including approved group-related forum operations. |
| `cnbx` | Inbox: Waves, Contacts, Threads and Delivery for direct, group and room conversations. |
| `cthr` | Threads: OpenMLS conversations, ordered epochs, lineage and accepted history; replaces the old messaging-facade split. |
| `cdlv` | Delivery: live sessions, DHT-backed offline delivery, recipient receipts and retries. |
| `ctcs` | Contacts: relationships, blocks and their synced private journal. |
| `cwvs` | Waves: first contact, release, answer, close and punishment outcomes. |
| `cgrp` | Groups under Board: life cycle, size-based levels, consent/forks/lineage, safety and local suggestions; no admin roles. |
| [Forum rooms] | Working name for Gather’s LGPL blind ordering, encrypted relay and room-pass library. Package name remains open. |
| [Member rooms] | Working name for Board’s LGPL consent, joining, profile-key exchange and newcomer-history library. Package name remains open. |
| `cvlt` (vault) | Encrypted member state and device access on the member side. |
| `cwlt` | Holder wallet: keep credentials and balance openings, and generate proofs. |
| `cwst` | Encrypted device storage with browser and native backends. |
| `ckmg` | Member key management and purpose-specific keys. |
| `cdht` | Veilid byte-conformant encrypted records for device sync, passkey-derived restore and offline messages through either network backend. |
| `cmsh` | Anonymous peer-to-peer transport abstraction. |
| `cvln` | Veilid backend, the primary network in the making, subject to backend/browser/privacy qualification. |
| `ctrn` | Tor launch backend, retained as the fully established backup after Veilid becomes primary. |
| `cfbk` | Fallback execution under cvld → cmty → cplc, reused by Mesh; never silently reduces required protection. |
| `cblc` | Zero-knowledge balance policies for introductions, changes and other quotas. |
| `cssr` | Balance issuer accepting verified updates. |
| `cvfy` | Balance proof verifier. |
| `czkp` | Shared zero-knowledge proof support. |
| `cvch` | Voucher admission check. |
| `cphn` | Phone verification check. |
| `cpmt` | Fiat payment check. |
| `crpt` | Crypto payment and blockchain checks. |
| `cgvt` | Government-document checks through identity wallets or verification providers. |
| `cpps` | Privacy Pass check. |
| `chmn` | Human/biometric verification check without retained raw evidence. |
| `cmbx` | Mailbox-control check; authentication-factor wording remains Open. |
| `ctpp` | Third-party provider proof for admission, not social login. |
| `cscw` | Deposit hold, release and forfeiture rules. |
| `cfrt` | Per-action effort checks, such as proof of work, distinct from payment. |
| `cpxm` | Proximity-check placeholder; concrete product mechanism is not selected. |
| `clbs` | Legal block switch and permanent self-ban enforcement. |
| `cthl` | Throttle under cvld → cmty → cplc, reused by other facades through its policy home. |
| `crlt` | Persistent relational storage directly under the cvld door. |
| `cvtl` (volatile) | FSL forum-storage facade over LGPL cvlk Valkey and cmmr Memory, with expiry required on every write; distinct from cvlt Vault. |
| `cvlk` | LGPL Valkey adapter; warns instead of refusing when persistence is enabled. |
| `cmmr` | LGPL Memory adapter implementing the same volatile-storage contract. |
| `cprz` | Payload compression and privacy-preserving padding. |
| `cnry` | Independent warrant-canary publication/checking, a low-priority feature. |
| `ccht` | Proposed reusable conversations for future chatbot-assisted schema editing. |

`cmeet` is the BSL product containing the web, app and CLI shells, not a library.
The community facade is `cmty`; `cmnt` is reserved for a future “mount”.
Library responsibilities describe the current v2 baseline, not shipped status.
[Licensing A](decisions.md#frontend-and-clients) keeps facades FSL on both sides,
leaves LGPL and the product BSL. Open package names and integration work remain
in the [open questions](open-questions.md).
