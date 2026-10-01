# User stories

Product requirements recorded on 2026-09-29, with decisions through 2026-10-01.
See the [status legend](README.md#status-legend), [decision register](decisions.md)
and [open questions](open-questions.md). Decided describes requirements, not
implementation readiness. Later corrections replace earlier alternatives.

The source requirements refer to terminal mockups but do not include their
drawings. The ASCII summaries here show the recorded screen content; they do
not prescribe a layout or introduce new settings.

## 1. API first, always with MCP

**Decided · 2026-09-29.** A member can participate through a chatbot or CLI,
subject to the same gates as everyone else. The web interface is one API/MCP
consumer and has no privileged route.

| Requirement | Status | Date |
|---|---|---|
| All member functions are available through the API and MCP. | Decided | 2026-09-29 |
| Member libraries run natively and in WebAssembly; encrypted storage also has a native file backend. | Decided | 2026-09-29 |
| The member MCP server runs on the member's machine; it does not send the member's keys to a remote MCP service. | Decided | 2026-09-29 |
| An agent is paired from a live device as another revocable device with its own device key; it is not given the member's passkey. | Decided | 2026-09-29 |
| Agent devices receive no special marker or different treatment. | Decided | 2026-09-29 |
| Member, admin and platform/root surfaces all provide MCP. | Decided | 2026-09-29 |

## 2. Arbitrarily many clients

**Decided · 2026-09-29.** The web app and CLI are reference clients. Third parties
can make other clients, including admin and root interfaces. The backend must
protect the community independently of which client someone uses. Device-side
checks protect honest members; they cannot establish that every client behaves
honestly.

| Requirement | Status | Date |
|---|---|---|
| No preference among clients or users; community protections are enforced by admission and forum services. | Decided | 2026-09-29 |
| Guard, authentication and rate limits treat every endpoint's input as hostile. | Proposed | 2026-09-29 |
| Documented, versioned, stable API definitions support third-party clients. | Proposed | 2026-09-29 |
| Service API definitions are the client/server protocol, defined once and used to generate TypeScript clients, CLI commands and MCP tools. There is no separate protocol library. | Decided | 2026-09-29 |
| Licensing A: server and member facades are FSL; leaves LGPL; cmeet BSL. Third-party clients embed unchanged cmsg and use its local API. Commercial substitutes for cmeet require a licence during FSL’s two-year competing-use restriction. | Decided | 2026-10-01 |

**Decided · 2026-09-30.** Product shells share this BSL repository: Svelte 5 PWA
in `apps/web`, a Tauri desktop/mobile shell using the same UI in `apps/tauri`,
and one Rust program in `apps/cli` with `cmeet`, `cmeet tui` and `cmeet mcp`.
Shared UI and white-label themes belong in `ui/`; `core/` is a thin client layer
only where two apps need it. `tests/toy` drives many CLI members. The CLI is both
a product and a test tool. Libraries remain in separate repositories and contain
no frontend code. **Decided · 2026-10-01:** every frontend, including CLI and
third-party apps, calls only `cmsg`. Its local API is the official interface,
with HTTP, MCP and TypeScript generated from one definition. Admin/root commands
use the admission action definitions through `cmsg → Foyer → cvld`. Service
binaries retain serving and operator tasks. CLI passkey custody remains Open.

## 3. Godmode and admin

**Decided · 2026-09-29.** Godmode is the platform/root interface. It has a
community selector and can override community admins. An admin interface works
within one community. Both authenticate with passkeys and use API/MCP.

Settings follow a sparse policy: the platform supplies values, communities may
override allowed values, and members may override some of those. An unset value
inherits; an explicit empty value stops inheritance. Technical and security
settings follow platform changes live. Template content, including schema and
gate choices, is pinned when a community is created and adopted by its admin.
The platform can force a setting and define override bounds. Member defaults
offer structure and suggestions, never pre-filled personal answers.

**Proposed · 2026-09-29.** Represent roles as gates/actions; restrict godmode to
settings and admins rather than member impersonation; require fresh passkey
confirmation for dangerous actions; separate operator identities; show affected
admins an action log; reserve operator names and use role badges. These details
are not all settled by the story. **Decided · 2026-10-01:** admin/root clients
call the local member API, which forwards through Foyer to admission. The forum
receives resulting signed settings and never carries those edits.

**Proposed · 2026-09-29.** Keep personal setting overrides only in the member's
vault, outside operator access/control, and publish the permitted range of
member choices with resolved community settings. This boundary still needs a
complete product contract.

## 4. Arriving at a community

**Decided · 2026-09-29.** A person follows a link to `example.com`. The community
owns its landing page and editorial choices. It can present its own brand and
custom domain without making cmeet part of the ordinary community experience.
The default landing page contains only a combined sign-in/register action.
Community-branded mail senders, errors and links remain Proposed.

**Decided · 2026-09-30.** Global verification uses `wallet.cmeet.me`, visited
when joining a community and at infrequent global credential renewals. Checks
are reusable across communities; the device creates a separate pseudonym and
proof for each community. Communities do not learn which other communities the
member joins. This platform wallet is a visible boundary to the earlier
white-label arrival story, not a promise that every authentication page is on
the customer's domain.

### Connecting before use

**Decided · 2026-10-01.** The app preloads the network connection before members
can use it. Show connection progress and failure clearly; proceed only when the
connection stands. With Tor this includes bootstrap and onion publication. The
member should not need to understand or operate networking infrastructure.

### Registration and the lobby

**Decided · 2026-09-29, refined 2026-09-30.** An existing passkey signs the
person in; a new member creates one and establishes a handle at registration.
Handles are per community, 8–32 characters (2026-09-30), and appear unchangeable
by default. Admin-enabled handle changes still need detail.

Every login enters the lobby before the forum. It shows only active gates and
what the community's policy still requires. Members complete gates in any order
and can resume later. Profile creation is part of the same guided process,
determined by the community schema and available checks. Gate libraries provide
step descriptions as data, so a web client, CLI or agent can render the flow.
Nobody enters the forum until admission succeeds.

```text
+------------------------------------------------------------+
| Community landing page                                     |
|                    [ Sign in / register ]                   |
+------------------------------------------------------------+
                             |
                             v
+------------------------------------------------------------+
| Lobby                                                      |
| Handle: <registered handle>                                 |
|                                                            |
| Active requirements                                        |
|   <required gate>                 <complete / action needed> |
|   Profile                        <complete / action needed> |
|   Complete the remaining requirements in any order.         |
|                                                            |
| Devices: <member's names>          [ Add ] [ Remove ]        |
| Protect access: use a synced passkey or another device.     |
|                                                            |
| <Warning before registration expires: you cannot return.>  |
|                   [ Enter forum when admitted ]            |
+------------------------------------------------------------+
```

Registered-but-not-admitted is a real state. Unfinished registrations expire;
registration is rate-limited to prevent handle squatting. **Decided ·
2026-09-30:** a person whose registration expires cannot join that community
again. Handle release does not grant that person another attempt. The lobby
must warn before expiry. Expiry, release and reuse timing still require precise
public wording; see [no return](decisions.md#no-return).

### Devices and passkeys

**Decided · 2026-09-29.** Device management belongs in the lobby: view, name,
add from a live device, and remove devices. Personal device names and their
passkey links live in the member's encrypted vault and sync among the member's
devices. The passkey service does not store those names. A synced passkey may
span several physical devices: its ecosystem is the logical device, so a new
phone carrying the same passkey does not create a new identity.

The profile belongs to the passkey holder. Giving away, selling or sharing a
passkey, and theft until revocation, are accepted limits of that principle.
Mutable gates still apply to the current holder. User verification is required
for passkey use; extra factors used to unlock it belong to the passkey platform.
Communities can require more gates for sensitive actions. Majority approval,
cold keys and waiting delays were rejected as the general access model.

**Decided · 2026-09-29; clarified 2026-09-30.** There is no recovery beyond the
passkey. Restoring the encrypted vault from distributed records using a surviving
passkey is allowed. Losing all passkeys is permanent loss, with no return to the
community. Members should keep a synced passkey or several registered devices.
**Decided · 2026-10-01:** the passkey PRF derives the vault location and key;
restore fetches sealed records from the DHT population in either network backend.
The operator stores no vault backup. Record availability under churn still needs
measurement; an unavailable record must not silently create a new identity.

**Decided · 2026-09-30.** Admission services retain no login dates, last-used
dates, request logs or raw gate data. Device-local last-used information is
Proposed. Device removal must not depend solely on cosmetic vault sync: key
rotation/new epochs are Decided (2026-09-26), while the complete cross-device
revocation and sync-failure experience remains Open (2026-09-29).

### Profiles and the admin schema editor

**Decided · 2026-09-29.** There are no profile pictures initially. Every profile
field has a validator. Admins build schemas in a drag-and-drop editor with an
always-visible live preview. The editor speaks in questions and answer styles
that admins understand, backed by typed fields. The preview direction is a
flashcard: public front and private back.

```text
+----------------------------+-------------------------------+
| Profile questions          | Live preview                  |
| <drag questions to order>  | Front: public profile         |
| <choose an answer style>   | Back: private profile         |
|                            |                               |
|                            | <member form / profile card>  |
+----------------------------+-------------------------------+
```

**Proposed · 2026-09-29.** Answer types include choice, number, yes/no, location,
short text and long text, with pictures later. Controls include public/private,
required, filterable and change presets. Form/card and stranger/contact preview
views, common-field templates, and a pre-publication explanation of schema-change
effects need detailed design. A text-field option could reject contact details
that bypass private-profile access and first contact. Chatbot-assisted schema
and template creation through the same admin API/MCP is Open, parked for later.

**Decided · 2026-09-29.** The schema covers public and private fields. The
sender checks both, the forum checks the public fields, and the receiver checks
private fields after decryption. Gate results do not certify or retain profile
values. Real numeric values are used, such as age 34; only rules use ranges.
Restricted fields have change limits enforced by hiding pins, without storing
their values in admission services. Public-field hiding/removal takes effect
immediately; loosening needs no member action; private-only changes are checked
on devices. **Decided · 2026-10-01:** enforce the current schema strictly until
grandfathering exists. The later small-change boundary remains Open.

The product uses nested canonical and API domains behind custom domains. TLS
scaling, customer-domain certificates and abuse containment are recorded in the
[decision register](decisions.md#domains-and-tls). **Decided · 2026-09-29:** web
first, Svelte 5 responsive SPA/PWA, a headless component library under the
product's UX, and platform adapters so native shells can follow. The
2026-09-30 repository decision names Tauri; the earlier wider app comparison is
tracked as an ambiguity, not silently resolved.

## 5. Anna in the forum

**Decided · 2026-09-29, with presence clarified 2026-09-28.** Anna sees active
members in a view suited to her device, filters them, and has easy access to her
reciprocity meter, inbox, online state and settings. Settings lead back to the
lobby for her profile, rules and devices. The UI should work on a second screen
or in a laptop corner. Protecting her identity is a product requirement, not a
claim that the client cannot be compromised.

```text
+------------------------------------------------------------+
| Forum     Reciprocity     Inbox     Online     Settings     |
| Filters: <community's filterable questions>                 |
|                                                            |
| <online two-way matches; display adapted to the device>     |
| <public card>                       [ Want to know more ]  |
|                                                            |
| <key request accepted: look back at the requester>          |
| <key request rejected: inspect the reason>                  |
+------------------------------------------------------------+
```

Online means discoverable; there is no separate presence switch. Disconnecting
removes Anna's forum entry, rules and encrypted private profile. The forum keeps
no persistent trace of them. Discovery filters typed, community-defined fields
in both directions: both members must satisfy each other's rules. Entries use
stable community member IDs, not a new identity each session. A live snapshot
can therefore link activity within a community; ephemeral storage is not a
promise against live observation.

**Decided · 2026-09-30.** The match interface is paged and incremental: members
arrive and leave without downloading a full match list. Ranking remains Open.
The private profile is cached as ciphertext in forum memory while its owner is
online. Only authorized readers receive it. The profile key comes directly
from its owner, peer to peer, never through the platform's servers or another
key holder. Approved keys and received profiles can remain in the reader's vault.

### Looking at a private profile

**Decided · 2026-09-29.** Public-card views do not cause notices or look-back.
Requesting the private-profile key does. Key release is automatic under the
owner's rules, with no manual approval. Tom supplies his own profile key first;
Anna can look back if the request is accepted. There is no blind exchange through
the forum. Perfect simultaneous exchange is not promised: the requester gives
first, and the honest client completes an allowed exchange.

Anna is notified about every acceptance and rejection. On acceptance she keeps
Tom's key for look-back. On rejection, her client discards Tom's key
(Decided, 2026-10-01). Anna sees the full failed-rule reason. Tom learns only the field
responsible, such as age, never Anna's rule or its values. Stable fields' change
limits and pins reduce gaming.

**Decided · 2026-10-01.** Match tokens are omitted from the MVP, with their
format reserved. Current reciprocal checks still govern profile access and
key release. A later signed-token mechanism and its lifetime remain Open.

Seeing existing contacts come online is important, but the contact graph and
contact-presence information must not live in the forum. Peer-to-peer presence
is Proposed. Favourites and favourite-online notifications are optional, not
core. Reading the reciprocity meter from the member's own vault balance without
a server call is Proposed.

**Decided · 2026-09-29.** Blocking defaults to full forum hiding: Anna's block
is part of her rules while online, so Tom no longer sees her there. It also
stops contact and key release. The forum forgets the block on disconnect; Anna's
devices retain it. This replaces the earlier device-only default. Legal review
of ephemeral block processing is required before launch.

## 6. First contact

**Decided · 2026-09-29.** Introductions are live: both members must be online.
Sending one reserves a sender introduction and a recipient incoming slot. A
popular recipient can become full until they answer or decline. Established
conversations are unmetered.

| Outcome | Sender introduction | Recipient incoming slot |
|---|---|---|
| Answer | Returned immediately | Returned immediately |
| Decline / respectfully close | Returned after the waiting period | Returned immediately |
| Silence | Returned after the waiting period | Remains occupied |
| Punish | Burned | Burned; sender also blocked automatically |

```text
+------------------------------------------------------------+
| First contact from Tom                                     |
| <message>                                                  |
| [ Answer ]     [ Respectfully close ]     [ Punish ]        |
| Punish costs both participants and blocks the sender.       |
+------------------------------------------------------------+
```

Punishment is costly to both people and benefits the forum rather than rewarding
the punisher. Governance remains numerical: no reports, no message-reading
moderators. Block and punish must be available in any conversation at any time,
not just for the first message. Conversation exits are respectfully close and
punish, with stark wording for punishment.

**Decided · 2026-09-29.** The profile card should show the relative shares of
accepted, declined and punished sent first contacts, if verifiable. It never
shows absolute counts and appears only after a minimum quorum. The quorum value
is an Open platform setting. This replaces the earlier absolute-count display.

**Decided · 2026-10-01.** Use the balance stack’s punishment and debt mechanics.
In established conversations the cost is one introduction per party, with debt
consumed before refill at zero balance. Signed receipts and zero-knowledge
proofs must preserve counterpart privacy. Counter changes can reveal that an
interaction ended. Proof-backed service integration and private settlement
remain acceptance requirements, not claims of product readiness.

**Decided · 2026-10-01.** Offline messages and vault restore rest on the DHT
population. Existing contacts can exchange encrypted messages without being
online together, subject to records remaining available. The app distinguishes
queued, stored and received messages; storing a record is not a recipient’s
acknowledgement. First contacts remain live. Going offline removes forum
presence and ends the live session, while encrypted history and pending messages
remain. This supersedes the earlier online-only MVP restriction.

There are two full network backends. Veilid is the primary network in the making;
Tor carries launch and remains a fully established backup. Devices participate
while the app is in use, with DHT capability on by default; members manage no
always-on infrastructure. The operator stores no DHT records. Records follow
Veilid’s formats and retention behaviour, with no expiry guarantee or promise
of permanent availability. The app reconnects and rehydrates records on open.

## 7. Groups that change with their size

**Decided · 2026-10-01.** Groups are part of the MVP, capped at 100 members by
community policy. One group concept has three levels:

| Level | Size | Experience |
|---|---|---|
| Circle | 3–12 | Hidden group of friends, invitations through own contacts with consent, changes through forks. Newcomers receive no earlier history. |
| Ingroup | 13–42 | Hidden class or team. Joining needs the band’s vouches; newcomers see only its recent-history window. |
| Public room | 43–100 | Listed meeting place, with living membership and ordered changes. Joining explicitly consents to seeing each other’s private profiles. |

Notifications, posting pace, vouching and newcomer history adjust through nine
size bands. Every group shows its level and the next change. Crossing 12/13 or
42/43 toward greater visibility is always a consent fork: only members who agree
move. No one is exposed automatically. An opening public room has 21 days to
reach 43; otherwise it becomes a hidden Ingroup and visibility consent lapses.
Shrinking automatically increases privacy, with hysteresis: Public to Ingroup
at 36 or fewer, Ingroup to Circle at 10 or fewer. Admin-created seed rooms are
public from the start and remain listed when small.

```text
+------------------------------------------------------------+
| Join a public room                                         |
| Members see each other's private profiles.                 |
| Joining means consenting to that visibility.               |
| <level, current size, what changes next>                    |
+------------------------------------------------------------+
```

Look-back and personal blocking remain available. Groups have no admins or
expulsion operation. A member may leave, mute, block, or propose an exit fork;
nonmovers keep their original group. Each mover chooses. Related forks appear
as one conversation with a quiet transition line and retained local history.
After 72 hours the larger public fork takes the listing; ties favour the older
lineage. Direct first contact from a group costs a Wave as usual; joining,
forking, merging and splitting never cost a Wave.

Newcomer history is handed over by members within policy limits: Ingroup bands
use 14 days (up to 200 messages), 7 days or 3 days; Public bands use 24 hours/100
messages, 12 hours/50 or 6 hours/50. Public rooms above 59 members allow at most
six joins per hour. Clients enforce posting pace on both send and receive.
Profile keys travel inside encrypted group messages; the server has no keys,
GroupInfo, MLS tree or readable message history. Its accepted room disclosure
is active-connection count and traffic volume per public room, without identities,
membership lists or links from members to rooms. Permit and restart-recovery
proofs remain implementation work.

Devices suggest splitting crowded groups or merging small overlapping groups.
These are invitations, not forced moves. Welcoming a newcomer can earn 0.25 Wave;
a successful introduction can earn 1 Wave, limited to 1.5 Waves per week and the
member’s available capacity headroom. Signed receipts prevent duplicate grants.
The introduced pair still use ordinary first contact.

The seat economy is **formats only at launch** (`seats.enabled=false`). The
local activity ledger is enabled, but the app does not charge seats or require
a seat balance to join. A future attention budget cannot be bought, transferred
or exchanged for Waves. Its weight rises for passive seats in tiny or crowded
groups, and one real message per week makes a seat free. A seat meter appears
only when the economy is enabled, after the planned dry run and proof checks.

Groups and rooms share Board’s single forum connection. Group membership and
encrypted conversation/history have separate owners behind the same member API.
The room load test is part of the build. Cap increases and seat activation need
their recorded validation gates; Slack-style topic channels remain later work.
