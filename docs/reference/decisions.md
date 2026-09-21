# Decisions for the operator

Open decisions only. No recommendation here changes a default or authorizes
spending. Security evidence and implementation gates: [security-review.md](security-review.md).

## Needed before committing to production architecture

| ID | Decision | Concrete choice and consequence |
|---|---|---|
| D1 | Independent custody | Identify a second independent custodian able to operate the other half of the planned key service. If none is available, the two-administrator promise cannot be launched as written. The exact cryptographic protocol remains engineering work. |
| D2 | Operating budget | Set a monthly ceiling for protected compute, SMS, chat and operational overhead, plus any separate verification budget. A costed backend proposal must fit it before paid provisioning. |
| D8 | Acceptable relay metadata | Accept no application message storage **with disclosed provider activity metadata**, or require the stronger absence of room-activity records and revisit the hosting design. Recommendation: use the narrower honest claim if Cloudflare remains the relay. |
| D9 | Message evidence versus deniability | Retain transferable signed message receipts for disputes, or require deniable chat without those receipts. The current documents promise both. Recommendation: do not claim transcript deniability while issuing a relay signature binding participants to a message digest. |
| D10 | Service scope compatible with no operator moderation | The user requires no content-moderation work by the operator and intends all data to be public or unavailable. Public-board hosting has not been shown compatible with that requirement. Resolve the service role and notice-handling feasibility before treating the board as cleared; do not silently introduce operator moderation. [Assessment](../studies/privacy-disclosure-boundary-2026-09-08.md). |
| D11 | Discovery without hosted profiles | Proposed: member-held profiles shared in live introductions, sacrificing offline profile browsing. Alternative: offline discovery requires a copy on a member device or another explicitly chosen host, with its own access/retention boundary. User preference pending; no silent conversion to vouch-only admission. [Relay study](../studies/relay-architecture-2026-09-08.md). |

## Needed before launch

| ID | Decision | Concrete choice and consequence |
|---|---|---|
| D3 | Phone coverage | Keep planned CH/DE/AT admission or narrow the launch. Do not claim a narrower region is safer until actual number-availability checks support it. Prefix filtering alone cannot reject rented numbers. |
| D4 | Burn duration | Confirm 24 months or specify a different expiry. Longer burns cover delayed reporting but penalize recycled-number holders for longer. |
| D5 | Invite expiry | Keep unused invites until spent, or specify an expiry period. Expiry changes whether an old scarce-side invite remains valid after composition changes. The twelve-invite hoard cap stays. |
| D6 | Participation policy | Choose how much unequal contact volume/reach is acceptable. Engineering must show the effect of candidate settings before asking for a numerical dial value; the requested 50:50 composition stays fixed. |
| D7 | Operator and release identity | Choose the operating entity/contact arrangement and the author/account for the eventual fresh public repository. These are separate from member pseudonyms and must be settled before launch/publication. |

## Already decided

Keep voucher slashing at three revoked invitees without an independence exception;
the own-messenger, all-online design; closed small groups; two passkeys at signup;
the indirect history-key envelope; no operator password reset;
and this repository's private, solo, disposable lifecycle.

No content-moderation work by the operator is a hard product requirement. Public
code and minimal operator access are intended to make the disclosure boundary
inspectable. The 2026-09-08 request to revisit architecture toward a relay supersedes
the unconditional board-first sequence. The board is an archived alternative;
live-only discovery remains proposed under D11. Neither direction closes D10.

D8 now requires a hosting comparison: Cloudflare is a candidate, not a settled
relay backend. The minimum transport proposal recommends omitting transferable
receipts, but D9 remains open. Engineering must preserve decided enforcement
semantics while proving the minimal security-state schema.

Library selection, adversarial tests, schema validation, proof/input binding,
attestation implementation, public-key pinning and key-safe storage writes belong
to engineering. Real-device PRF results and the live Cloudflare retention probe
are evidence to gather, not policy choices for the operator to guess.
