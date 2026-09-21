# Phone admission and optional factors: functional protocol review

8 September 2026. Research proposals, not an implemented or audited protocol.
Read with [operator costs](phone-gate-costs-2026-09-08.md) and
[micropayment providers](micropayment-providers-2026-09-08.md).

## Current discussion boundary

The user accepts the phone uniqueness oracle, SMS possession rather than proof
of identity, and additional-number attacks. Launch entry is phone-based without
payment or recommendation requirements. Phone, recommendation/vouch and the
**optional micropayment gate** must each be independently configurable later.
The payment gate starts disabled and is intended as possible economic friction
against malicious people and automated/AI abuse. Amount, trigger, recurrence and
gate-combination logic remain open. Earlier decisions are available for review.

Completed checks should be showable in profiles. A globally enabled gate and a
member's evidence are different facts: turning a gate on grants nobody a proof;
turning it off does not issue a badge or erase existing evidence. Disclosure
audience, expiry and wording remain product choices. Payment is neither proof of
humanity nor trustworthiness; phone possession is not legal identity or age.

## Keep four roles distinct

| Role | Minimum function | Knowledge boundary |
|---|---|---|
| Member client | Hold account secret and factor credentials; prove required claims | Holds personal inputs and controls profile disclosure |
| Phone gate + delivery provider | Verify SMS possession and canonical number binding | Necessarily handles number; must not receive member profiles or contacts |
| Optional billing/credential issuer | Confirm required payment; manage financial lifecycle | Holds billing records; should not receive membership identifier |
| Membership verifier/relay | Evaluate gate policy and prevent reuse; route communication | Receives required predicates, opaque uniqueness/replay state and live routing metadata |

These are trust roles, not automatically four vendors. Putting every role under
the same administrator does not establish the operator's inability to know.
Provider portals, account-owner powers, support exports, webhooks and logs belong
in the boundary, including when the application's own database is empty.

## Phone binding: two checks, not one

[RFC 9497](https://www.rfc-editor.org/rfc/rfc9497.html) supplies VOPRF evaluation
and verification. It does not supply an SMS possession proof, number uniqueness,
membership issuance or proof that a malicious client's submitted final anchor
matches the verified input. Therefore both must hold:

1. The input evaluated is the exact canonical number whose SMS challenge passed.
2. The anchor used for membership/burn checks is the genuine finalized output of
   that evaluation under the pinned key and protocol domain.

Signing an arbitrary client-supplied anchor after receiving `SMS approved` fails
the second condition. Binding only a blinded input fails to authenticate an
arbitrary final output. Signing only `verified=true` fails both. Canonical E.164
normalization, country/range validation, fresh session binding and expiration
must be enforced by trusted verification, not honest-client UI behaviour.

### Feasible candidate: protected gate derives the anchor

An independently operated or remotely attested gate verifies the provider result,
uses that exact number as the VOPRF client input, checks the evaluator's proof,
finalizes the anchor, and attests to the result. This removes the malicious
member's choice of anchor. It deliberately gives the protected gate knowledge
of the number-to-anchor relationship; the delivery provider already has the
number. The platform sees only an authentic opaque anchor/proof.

The gate must authenticate the actual provider response itself, not accept a
browser's claim that an OTP succeeded. Raw numbers and OTPs must terminate inside
the protected boundary, with no plaintext host proxy. Enclave outbound TLS/API
handling, secret provisioning and code measurements require implementation and
review. [AWS attestation](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html)
can identify a measured enclave to a relying party, and
[KMS policies](https://docs.aws.amazon.com/enclaves/latest/user/kms.html)
can restrict decryption to measurements. This is building material, not a
ready-made phone-gate product or proof against an administrator who can replace
trusted code/key policies. Operator access to the SMS provider account remains
a separate problem even if the enclave itself never leaks.

### Stronger candidate: prove the binding without exposing it

An issuer could certify a verified hidden phone attribute; a client could prove
that its uniqueness anchor and factor credential correspond to that attribute.
This needs a reviewed anonymous-credential/proof construction covering the
issuer signature, canonical input, VOPRF computation/finalization and holder
binding. None of the shortlisted OTP APIs was verified to sell that interface.
Do not substitute a public signed JWT containing a phone number or assume
composing individually sound primitives supplies the missing security proof.

For an initial feasibility prototype, compare the protected-gate trust compromise
against this stronger custom protocol. Neither is adopted here. Independent
custody and a full RFC-compatible protected evaluator are still open: a claim of
two custodians needs a concrete protocol and access policy, not two ordinary
copies of the key. RFC 9497 itself does not standardize the proposed threshold
deployment.

## Registration state machine and invariants

Candidate states are `pending → phone-approved → factors-satisfied → admitted`,
with expiration/rejection available before admission. Different enabled-policy
combinations may change which steps are needed; the state machine must not
hard-code payment or vouching into every launch registration.

- A challenge proves one number/session only, has bounded guesses/resends and
  expires. Provider duplicate callbacks and browser retries are idempotent.
- Concurrent admissions using the same anchor must resolve atomically to one
  active membership. A check-then-insert race would defeat the phone gate.
- A one-use payment or invitation proof cannot create several memberships,
  including through concurrent requests. Durable redemption is needed before
  success is acknowledged; process RAM alone permits replay after a restart.
- A crash after credential issuance must not leave either an extra valid
  credential or a legitimate member permanently consuming a slot without a
  recoverable result. Retry/issuance receipt design is required.
- Re-registration by a recycled-number holder cannot read the previous member's
  messages, contacts or profile. Releasing uniqueness state, invalidating old
  credentials and phone-based account recovery are separate decisions.
- The opaque anchor is still stable security data. Deleting it immediately after
  issuance reopens duplicate admission unless another authority preserves the
  uniqueness invariant. Bans, account deletion and number changes need a precise
  retained-state lifecycle.
- Rotating the VOPRF key changes anchors. Retaining old keys indefinitely, dual
  checks, migration and mandatory reverification have different privacy/cost
  consequences. Key loss must not silently reset bans or permit duplicate users.

The current [security review](../docs/security-review.md) correctly treats the
core as a trusted model, not proof of these properties. This study makes no code
or test-completion claim.

## Factor claims and gate policy

Represent policy separately from evidence. Candidate claim meanings:
`phone possession checked during epoch E`, `valid recommendation satisfying rule
R`, and `one required payment authorization redeemed for context C`. A generic
“verified” badge would overstate all three. Whether the public claim means
historical completion or current eligibility must be chosen explicitly.

The verifier should learn only the claims needed by the current policy, not the
phone, payer details or voucher identity. Holder-bound anonymous credentials
could let the member prove several factors concern the same hidden account
secret, with unlinkable presentations. That linkage is required to prevent
mixing Alice's phone proof, Bob's vouch and Carol's payment proof. Holder binding
reduces casual transfer but cannot stop someone sharing their entire secret or
controlling several accounts/numbers; no hardware-identity requirement is assumed.

Still open: whether enabled gates mean conjunction, alternatives such as
`phone AND (vouch OR payment)`, or different policies for different actions.
Gate changes need a policy version, clear effective time and an explicit rule
for in-flight registrations and existing members. Enabling payment later must
not silently bill anyone or mint missing proofs. Disabling a gate must not let
old tokens be replayed when it is re-enabled. Proof lifetime and nullifier
retention must cover every policy under which a token remains redeemable.

## Payment authorization without a payment-to-member record

[Privacy Pass](https://www.rfc-editor.org/rfc/rfc9576.html) supplies an architecture
for separating eligibility assessment, token issuance and redemption. Its
unlinkability depends on deployment, anonymity sets and metadata, not just blind
signatures. Signal provides an unusually close deployed precedent: its
[donor FAQ](https://support.signal.org/hc/en-us/articles/360031949872-Donor-FAQs)
describes anonymous credentials proving a payment occurred without linking the
Signal account to that specific payment. This establishes feasibility of the
pattern, not automatic suitability of Signal's payment providers for this site.

Candidate optional-gate flow:

1. Client obtains a blinded authorization request for a narrowly defined gate
   context, validity epoch and permitted use count. Policy attributes must be
   cryptographically enforced; the payer cannot choose a free/longer-lived class.
2. External billing/issuer verifies the actual payment and issues the allowed
   credential once, with safe issuance retries. It knows the payment and its
   issuance allowance, but not the subsequently presented token/member identity.
3. Client presents an unblinded proof to the membership verifier. The verifier
   checks authenticity, context, validity and an unused nullifier, then consumes
   exactly the permitted authorization. No transaction ID, amount, card, email,
   phone or invoice needs to accompany the platform presentation unless the
   policy itself requires that information.
4. For an optional profile claim, the client proves the appropriate credential
   predicate to the chosen audience. It need not expose the token/serial spent
   at admission or a public purchase timestamp. Fresh proofs avoid making one
   receipt identifier a cross-context tracker.

Publicly verifiable signatures permit peer verification; some anonymous/MAC
credential designs instead require a verifier holding secrets. Select according
to the actual audience, not by treating every anonymous-token scheme as a public
badge format. Unique keys, exact timestamps, unusual amounts and tiny issuance
cohorts can tag people. Shared epochs/classes and batching help but delay use;
network/timing linkage remains a separate threat.

No reviewed payment provider advertises this full blind issuance API. A custom
issuer is required unless one is found. An ordinary hosted checkout that posts
`paid=true` with an account ID reduces card handling, but retains linkable
payment state and may leave the operator full processor-portal access.

## Financial lifecycle and malicious automation

If enabled, decide whether payment buys one admission, a batch of bounded actions,
or continuing eligibility. USD 1 buying unlimited monthly activity can be spread
over a million spam attempts: the gate alone then imposes USD 0.000001 per
attempt. One-use authorization and activity quotas are different controls. Shared
or stolen instruments, refunds and chargebacks further separate an attacker's
real cost from the displayed price. Payment demonstrates neither humanity nor
benign purpose, including for AI-controlled accounts.

Cancellation can simply stop future issuance. Refund/chargeback after redemption
creates a choice: tolerate the issued authorization until bounded expiry, or
support revocation. Linking a specific refund directly to a member undermines
unlinkability. Anonymous revocation/accumulators are possible research paths,
not a solved off-the-shelf feature here. Refunds before blind redemption also
need a rule preventing both keeping the usable token and recovering its price.
Recurring payment requires external continuing account state; the platform can
check fresh eligibility rather than own a subscription record. Provider outage
must not silently switch an enabled required factor to optional.

## Product compromises to discuss

1. Is a separately operated/attested phone gate allowed to know the number and
   opaque anchor, if the platform cannot obtain the number or mapping?
2. Should profile claims show historical checks or current, expiring proofs,
   and to which audience? This determines reverification and public leakage.
3. If payment is enabled, which admission/action policy should it satisfy, and
   what happens to existing members? No global combination is selected.
4. Is bounded continued validity after a refund acceptable, or is immediate
   revocation worth extra state, complexity and potentially reduced privacy?

These are discussion prompts for the parent conversation, not questions sent to
the user by this research task. Public source, reproducible builds and pinned
attestation can make claims inspectable; they do not prove the absence of every
provider record, operator portal or out-of-band disclosure.
