# cmeet product documents

This is the canonical public home for cmeet's user stories, product decisions
and unresolved product questions. The snapshot covers decisions from
**2026-09-25 through 2026-09-30**; the seven stories were recorded on
**2026-09-29** and refined on **2026-09-30**.

| Document | Contents |
|---|---|
| [User stories](user-stories.md) | Stories 1–7: API/MCP, clients, admin/root, arrival and lobby, forum, first contact and groups. |
| [Decisions](decisions.md) | Dated requirements grouped by product area, including superseding corrections. |
| [Open questions](open-questions.md) | Remaining proposals, ambiguities, parked ideas and launch dependencies. |
| [Glossary](glossary.md) | Product vocabulary and one-line library responsibilities. |

## Status legend

| Label | Meaning |
|---|---|
| **Decided** | An accepted product requirement or direction; not a claim that implementation is complete. |
| **Proposed** | A candidate design or detail that has not been accepted as a product decision. |
| **Open** | A question, ambiguity or dependency without a settled answer; parked items remain Open for later. |

A row with more than one label distinguishes the settled principle from the
unresolved detail. Dates are decision/recording dates, not release dates. Later
explicit corrections take precedence; unresolved contradictions are listed in
the open questions rather than silently resolved.

## Scope and readiness

These documents describe what members and community/platform admins should
experience. They do not replace library contracts or certify production
readiness. The 2026-09-30 source snapshot still leaves member-side integration,
CLI passkey handling, semipublic rooms and proof-dependent punishment,
public-record and restricted-field-change features unfinished. Those features
must not be presented as available merely because their behaviour is Decided.

Architecture and cryptographic design live in the library repositories,
especially [cvld](https://github.com/corbet-libs/cvld),
[cfrm](https://github.com/corbet-libs/cfrm) and
[cmsg](https://github.com/corbet-libs/cmsg), with supporting libraries in
[corbet-libs](https://github.com/corbet-libs) and
[corbet-foss](https://github.com/corbet-foss). This repository contains the BSL
product shells; its [licence](../../LICENSE.md) remains authoritative. The
member-side library licence question is still Open.

Implementation logs, private operational material, conversation quotations and
library review internals are outside this public product scope. Provider limits
are dated planning inputs, not current guarantees. Legal and store-policy points
are requirements for review before launch, not compliance conclusions.
