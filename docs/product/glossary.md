# Product glossary

Vocabulary as of **2026-09-30**. Library entries describe responsibility, not
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
| Match token | A Proposed short-lived signed statement that a pair currently matches, for use in key requests. |
| Public profile / card | Typed searchable fields visible through the forum's permitted discovery results. |
| Private profile | Encrypted profile content whose key is released peer to peer under rules or semipublic-group consent. |
| Look-back | A private-profile requester supplies their own key first so an accepting owner can view them in return. |
| Schema | The community's typed definition of public/private profile fields, validation and change restrictions. |
| Pin / seal | A hiding commitment that limits field changes without storing the profile value in admission services. |
| Grandfathering | Allowing an older profile after some schema tightening instead of immediately excluding it from matching. |
| Introduction / first contact | A live initial message reserving one sender introduction and one recipient incoming slot. |
| Reciprocity | The balance rules for introductions, responses, waiting and punishment. |
| Public record | Quorum-gated relative accepted/declined/punished outcomes, never absolute counts. |
| Block B | A device-retained block sent as an online forum rule, hiding the blocker from the blocked member. |
| Punish | A costly response affecting both parties and automatically blocking the other member. |
| Private group | A group of contacts without a leader hierarchy; detailed fork mechanics remain Proposed. |
| Fork | A related group with changed membership, while existing members retain their local history. |
| Semipublic group / room | A meeting space where joining explicitly consents to mutual private-profile visibility. |
| Admin | A community operator controlling that community's permitted settings. |
| Godmode / root | The platform interface that selects communities and can override their admins. |
| White label | Community-controlled branding, landing content and domains over the shared product. |
| No return | Permanent refusal after registration expiry or loss of all passkeys; handle reuse does not restore identity. |
| Self-ban | Voluntary permanent closure, confirmed with a fresh passkey and a clear no-return warning. |
| MCP | Model Context Protocol, exposing product actions to agents; member actions run on the member's machine. |

## Which library does what

| Library | Responsibility |
|---|---|
| `cvld` | Admission service: authentication, gates, membership and policy across global and community scopes. |
| `cglb` | Global verification, uniqueness and platform suspension, separate from community data. |
| `cmnt` | Community admission, composing membership, gatekeeping and policy. |
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
| `cfrm` | Forum service: ephemeral presence, profile listings and matchmaking; room design remains Open. |
| `cmsg` | Member-side entry point composing the member's private state and communication features. |
| `cfyr` | Foyer: member-side admission, login, lobby and device-management flows; design/integration remains unfinished. |
| `cbrd` | Board: the sole member-side forum connection, including approved group-related forum operations. |
| `cnbx` | Inbox: contacts, introductions, blocks and conversation outcomes. |
| `cmls` | End-to-end encrypted messaging using MLS. |
| `cgrp` | Group behaviour, using the board for forum-related work. |
| `cvlt` (vault) | Encrypted member state and device access on the member side. |
| `cwlt` | Holder wallet: keep credentials and balance openings, and generate proofs. |
| `cwst` | Encrypted device storage with browser and native backends. |
| `ckmg` | Member key management and purpose-specific keys. |
| `cdht` | Signed replicated member records, including device-state synchronization. |
| `cmsh` | Anonymous peer-to-peer transport abstraction. |
| `cvln` | Veilid transport backend, the intended primary route subject to browser validation. |
| `ctrn` | Tor transport backend and browser bridge support. |
| `cfbk` | Configured fallback ordering without silently dropping below required protection. |
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
| `cthl` | Request throttling and bounded quotas. |
| `crlt` | Persistent relational storage used by admission and accounting. |
| `cvtl` (volatile) | Expiring forum storage; distinct from the member vault `cvlt`. |
| `cprz` | Payload compression and privacy-preserving padding. |
| `cnry` | Independent warrant-canary publication/checking, a low-priority feature. |
| `ccht` | Proposed reusable conversations for future chatbot-assisted schema editing. |

`cmeet` is the BSL product containing the web, app and CLI shells, not a library.
Library responsibilities above do not settle their unfinished internal designs
or the [member-side licensing question](open-questions.md#domains-white-label-clients-and-launch).
