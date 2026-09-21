# Protocol operations and trade-offs

Sections 8–16 of the [protocol](protocol.md). The [security review](security-review.md)
states the implementation limits; [decisions](decisions.md) records unresolved choices.
The 2026-09-08 [relay architecture](architecture.md) supersedes the board-first plan.

## 8. Composition

Ratio is enforced by **minting policy**, not by review. Credentials of the over-represented class are
minted only in proportion to redeemed credentials of the under-represented one. Set 60:40 and the tree
cannot grow past it — no moderator, no policy document, no judgement call, just an arithmetic
constraint on issuance.

This is the highest-leverage mechanism in the design. An 88-to-2 board burns out its scarce side and
produces most of the behaviour that generates complaints; no volume of moderation repairs a supply
imbalance.

> **Two residues.**
>
> *The attribute is asserted by the voucher and never verified.* When the scarce credential becomes
> valuable, some will claim it. Slashing gives that a price, but detection lives with members, not
> with code. Treat it as a socially-enforced ceiling that leaks a few percent, not a verified gate —
> and note that any attempt to make it a hard verified fact is both unbuildable and hostile to trans
> and non-binary members.
>
> *Invite trees are conservative.* The mechanism does not fix a ratio, it reproduces and amplifies the
> composition of the seed. Seeding thirty leads who happen to be mostly men yields the same skew with
> extra steps and fewer users. The seed is the single most consequential decision here, and it is
> social, not technical.

## 9. Contact

One own messenger, all-online. The [relay](../relay/README.md) forwards ciphertext
between member-selected connected clients, with bounded buffers and no application
offline queue/history. Live socket relationships and provider metadata remain
observable. The [architecture](architecture.md) specifies local profile exchange
and introductions; live-only discovery remains proposed under D11.

Closed groups remain 3–8 with creator surety, member-triggered closure and slashing.
Client-authenticated membership and rekeying are unbuilt. The prior transferable
signed-message-receipt proposal conflicts with transcript deniability (D9); the
minimum transport proposal recommends omitting it. Do not silently treat that
recommendation as a resolved policy choice.

## 10. The ad board

The public plaintext board is an **archived alternative**. The user's 2026-09-08
relay request supersedes the unconditional board-first sequence. Its old TTL and
member-flag mechanics remain in [board/](../board/README.md) for comparison.
They do not resolve the hard no-operator-moderation requirement (D10).

Live-only discovery exchanges member-held profiles with selected recipients.
Offline discoverability requires a retained copy somewhere, and is open under
D11. Do not presence-gate or otherwise modify the old board model and describe
that as implementing the new architecture.

## 11. What the server holds

The canonical target and model audit are in [data lifecycle](data-lifecycle.md).
The previous table was incomplete: actual model fields include names, invitation
owners, join times, flagger IDs, exact last-seen and balances. There is no
production schema yet. An empty conversation snapshot omits other resident maps.

The target relay holds session routing and bounded ciphertext buffers. Admission
and sanctions still require persistent commitments, revocations, spent tokens,
anchors, capsules and enforcement state. Ordinary passkey authentication may add
public credential records. These are pseudonymous data with correlation value;
threshold opening deliberately reveals associations. They are not inert or
valueless. SMS gateway/provider number access is distinct from evaluator blindness.

## 12. Threat model

### Intended protections, not production findings

- **Content confidentiality and history minimisation.** Authenticated client E2EE
  with no server content keys or message/profile store. Optional history remains
  member-held. No E2EE implementation exists here yet.
- **Reduced disclosure.** Avoid creating unnecessary records in normal operation;
  accurately describe and provide available data when lawfully required. This is
  not a guarantee against prospective orders or all operator action.
- **Spam and ban evasion.** Keep decided vouching, issuance and sanctions rules.
  Phone anchors add ban persistence; rented real mobile numbers defeat the earlier
  claim that replacement necessarily costs an ID-checked SIM. Anonymous quotas
  and anti-reset enforcement still need proof.
- **Reduced linkage.** Context-bound identifiers and fresh routes reduce explicit
  links only if issuance, use and stored schemas support them. They do not prove
  observer privacy against timing, IPs, small groups or colluding recipients.

### Registration oracle

Phone uniqueness reveals whether a supplied number is already anchored to someone
who can complete the possession check. A controlling person with device/SMS access
can exploit that. Neutral SMS and honest entry copy reduce some exposure but do
not remove the oracle. An offline in-app warning would itself require notification
state; the earlier promise of always alerting the holder is not established in
the live-only candidate. SMS-to-VOPRF-input binding remains unresolved.

### Remaining exposure

- The relay and providers can observe live routes, IPs and traffic timing/size.
  Provider records may persist independently of application settings.
- Recipients can save or disclose content. Device compromise and malicious client
  delivery can expose it. Open source and reproducibility do not prove that every
  served build matches the reviewed artifact.
- Small anonymity sets, repeated snapshots, share-release timing and old retained
  capsules can reveal relationships. Retraction cannot delete previous copies.
- The issuer/custody and capsule-release protocols are unimplemented. Splitting
  services or administrators is not a proof of cryptographic independence.
- The service does not claim to prevent off-platform harm or perform safeguarding.
  That product boundary does not determine applicable legal duties.

## 13. Accepted trade-offs

Decisions taken deliberately, recorded so they are not silently revisited.

- **Newcomers.** The unvouched phone path stays, accepting the registration oracle, so that someone
  who knows nobody can still get in. The alternative — vouch-only entry — removes the oracle entirely
  and was rejected as too closed.
- **No lurking.** No read-only tier. Commitment is required at the door; uncommitted accounts dilute
  the set and a public read surface already serves the browsing case.
- **No care.** Protective and safeguarding functions are out of scope and are not claimed. This is
  a distribution mechanism, not a safeguarding one.
- **No operator recovery.** Lost keys/history cannot be restored by the operator.
  Voucher re-mint can restore membership by spending an invite, as subsequently
  decided; it does not recover the lost device's data.
- **Scoped over global.** Blocks and reputation are per-context. Slightly weaker signal, substantially
  better unlinkability.

## 14. Operational boundary

No operator content-moderation work is the user's hard requirement. Do not turn
it into a volunteer/operator judgement queue. The final service role and legal
handling feasibility remain D10; neither automation nor public availability
establishes an exemption. Technical maintenance, key custody, outages and lawful
correspondence need an operating plan. Their workload has not been measured.
The prior 1–2-hour monthly estimate is not evidence or a current promise.

## 15. Effort

The prior development-day and infrastructure estimates assumed a board-first
product and understated unresolved cryptographic work. They are not a schedule
or budget for the relay proposal. Use the [implementation gates](next.md), obtain
concrete protocol/provider evidence, and cost that resulting design against D2.
No deployment or new spending is authorized by this document.

## 16. Open questions

1. **Useful discovery without stored profiles.** Validate member-hosted live
   introductions, concurrency and newcomer access. Phone-only admission stays;
   knowing nobody must not silently become an admission disqualification (D11).
2. **Provider and service role.** Compare retention boundaries (D8) and classify
   the final transport/admission/discovery functions against D10.
3. **Persistent enforcement.** Prove minimal-state membership, invitation budgets,
   reciprocity, revocation and capsule release without queryable relationships.
4. **Policy and verification.** Keep custody, budget, coverage, expiry, participation,
   identity and receipt choices in [decisions](decisions.md). Hardware, real-device
   PRF and provider observations remain in the [security review](security-review.md).

Historical predecessor-community observations in the earlier protocol draft (§1) remain dated research, not a
source of fresh availability or a launch guarantee.
