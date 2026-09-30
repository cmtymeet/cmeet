# User stories

Product requirements recorded on 2026-09-29, with decisions through 2026-09-30.
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
| Whether member-side facades should change from FSL to LGPL to support free and commercial third-party clients. | Open | 2026-09-30 |

**Decided · 2026-09-30.** Product shells share this BSL repository: Svelte 5 PWA
in `apps/web`, a Tauri desktop/mobile shell using the same UI in `apps/tauri`,
and one Rust program in `apps/cli` with `cmeet`, `cmeet tui` and `cmeet mcp`.
Shared UI and white-label themes belong in `ui/`; `core/` is a thin client layer
only where two apps need it. `tests/toy` drives many CLI members. The CLI is both
a product and a test tool. Libraries remain in separate repositories and contain
no frontend code. Member commands use member libraries; admin/root commands use
the service action definitions. Service binaries retain serving and operator
tasks. How the member CLI holds a passkey remains Open.

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
are not all settled by the story. Admin calls go directly to the admission API
(Decided, 2026-09-29).

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
The availability of distributed vault records still needs verification.

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
on devices. For tightening, the operator chooses strict enforcement or
grandfathering for small changes; what counts as small remains Open.

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
Tom's key for look-back. On rejection, her client discarding Tom's key is
Proposed. Anna sees the full failed-rule reason. Tom learns only the field
responsible, such as age, never Anna's rule or its values. Stable fields' change
limits and pins reduce gaming.

**Proposed · 2026-09-29.** Each match could include a short-lived signed match
token, required by every client's key request. Anna's device would verify it and
recheck the pair before releasing the key. This would limit ordinary rejections
to races such as changed rules, profile or schema. The token design remains Open.

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

**Proposed · 2026-09-29.** Signed outcome receipts and zero-knowledge balances
could make outcomes and punishment tamper-resistant without disclosing the
counterpart. Counter changes can still reveal that some interaction ended.
For established conversations, each participant could lose one introduction
from their current balance, with punishment included in the public record.
Punishment at zero balance could charge the next refill. Keep one introduction
unit rather than a separate disapproval balance. These mechanics remain Open;
proof-dependent punishment, record and change-token operations were still
disabled in the 2026-09-30 source snapshot pending real proof validation.

**Decided · 2026-09-29/30.** The initial experience is online-only; going offline
ends live chats as well as discovery. Later Veilid delivery may allow writing
to existing contacts while they are away, with messages held in the sender's
vault until delivery. First contacts remain live. Offline work is a limited
extension, not a major product investment.

## 7. Groups

**Decided · 2026-09-29.** Groups are an add-on. Use a simple version that works
well in ordinary cases, or launch without them. Private groups have no admins
or leader/follower hierarchy. Anyone can form a smaller subgroup. A group starts
by inviting someone from a chat or by creating one from scratch. Members should
keep their history, barely notice ordinary forks, and see old groups cleaned
up automatically.

**Proposed · 2026-09-29.** Groups have fixed membership; adding or removing
someone creates a fork, and leaving is always possible. Invite only existing
contacts with their consent, so groups do not bypass introductions. Existing
members retain local history; newcomers receive no old history. The client
could show related forks as one conversation, automatically follow additive
forks, and make subgroups explicit opt-in choices. Nobody silently removes
someone else: blocking hides that person for the blocker, while a subgroup
without them is a choice for other members. End old forks after everyone moves
or leaves; archive/delete inactive groups under platform settings. Block and
punish remain available and the initial experience is online-only.

**Decided · 2026-09-29.** There are two product group kinds: private groups for
existing contacts, and semipublic groups where newcomers can meet and exchange
profiles. In semipublic groups, joining explicitly consents to mutual private
profile visibility. The join screen must say so. This replaces checking personal
profile rules for each semipublic-room request. Members wanting strict rules
can decline to join; rules still apply elsewhere. Look-back and blocking still
apply inside groups.

```text
+------------------------------------------------------------+
| Join a semipublic group                                    |
| Members of this group see each other's private profiles.   |
| Joining means consenting to that visibility.               |
+------------------------------------------------------------+
```

**Proposed · 2026-09-29; Open/parked through 2026-09-30.** Standing rooms could
be created by community admins, use signed consent and automatic admission by
an online member, exchange profile keys in encrypted group messages, apply
posting limits, and have a tentative cap of about 100 members. Direct first
contact from a group would still spend an introduction. Private-group profile
requests could use co-membership in place of a match token while retaining
personal rules. Room ordering and encrypted-profile access remain unresolved;
a blind forum order point is acceptable only if it learns no membership or
content. A proposed traffic-volume-only view still needs reconciliation with
that condition.

The wider Slack-style open-topic channel model is Open and parked. Proposed
preparation includes conversation types, ignoring unknown types, and extensible
membership policy on MLS. History for newcomers without server storage remains
Open. **Decided · 2026-09-30:** groups use the same member-side forum connection
as discovery; that connection choice does not settle the room protocol.
