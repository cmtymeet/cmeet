# anchor/ — OPRF phone-anchor service

**Status: specified, unbuilt. Unblocked by verification 1 in [`next.md`](../docs/next.md):
whether the OPRF closes on hardware that can actually be rented.**

The phone number is a **ban-persistence anchor**, never an identifier. This
service and its SMS/issuer dependencies hold sensitive trust. They are separate
from the transient content relay, but a common operator can correlate observations.
The [data lifecycle](../docs/data-lifecycle.md) includes persistent security state
and the gateway/provider's access, not just the evaluator's blinded input.

## What it is

- **RFC 9497 VOPRF evaluation, nothing else.** Verifiability stops the evaluator tagging
  registrations with per-client keys, which would silently unmask the invite tree
  (`.agent/AGENT.md`). Client sends `H(phone)^r`, service returns `H(phone)^rk`, client
  unblinds to `P`. The evaluator can see only blinded input; the SMS gateway and
  delivery provider necessarily handle the number. Verified-number-to-input
  binding remains unimplemented. Do not extend evaluator blindness to every server.
- **Every evaluation gated by live SMS possession proof.** The OPRF kills the *offline*
  dictionary attack only; enumeration cannot be prevented (Hagen et al., NDSS 2021 — 100
  accounts enumerated the entire US mobile space against Signal in 25 days). Bind each
  evaluation to a fresh client-supplied SMS proof, keep the key in an HSM, provide no
  batch path — whatever oracle the operator can run, a court can order run in batch, and
  "this account does not exist" is itself a disclosure (`prior-art.md` §4.3).
- **Key custody split across two administrators on two providers**, as Callisto did — a
  single operator with a key is a compellable operator. Tutanota was ordered to *build* a
  monitoring function it did not have (`prior-art.md` §4.3).
- **CH/DE/AT mobile ranges only**, VoIP and virtual ranges rejected. SMS-capable German
  +49 numbers on real mobile ranges sell from €0.29 — so stop describing the phone as the
  sybil floor: the invite tree is the floor, the phone is a cost multiplier and a
  ban-persistence anchor. CH/AT virtual-number availability is still unverified; if those
  ranges are materially harder, a CH/AT-first launch is better defended (`.agent/AGENT.md`,
  `prior-art.md` §4.5).
- **Burn registry with expiry.** Burns expire (~24 months starting point, still open
  against the 35.5%-late-reports finding) because carriers recycle numbers after 6–12
  months; without expiry the list silently accumulates strangers. Make the burn retroactive
  against a stored commitment rather than a live registration (`prior-art.md` §4.5,
  `next.md`).
  The model deletes an expired burn only on lookup. Production needs active
  deletion of untouched entries and explicit backup expiry. The used-anchor set
  also needs a membership deletion/reuse lifecycle; a burn TTL does not bound it.
- **Neutral SMS.** No service name in sender ID or body — the first leak happens on a lock
  screen. In-app (never SMS) notification to the existing holder on re-registration
  attempts, honest copy at entry (`protocol.md` §12).
  In the live-only proposal an offline member cannot receive that in-app alert
  without retained notification state. That older mitigation must be qualified;
  neutral copy does not remove gateway/provider metadata or the membership oracle.

## The hardware question (verification 1)

AWS KMS `DeriveSharedSecret` exposes ECDH, not the required VOPRF evaluation and
DLEQ proof interface. A production backend must support the full RFC 9497
transcript under the protected scalar. Raw point multiplication alone is not a
complete verification. An attested candidate need not use SGX; Nitro Enclaves is
one documented option, not yet evaluated here.

The SMS gate also needs a proof binding the verified number to the blinded input;
a generic SMS success token cannot establish that. Hardware, independent custody
and that binding remain unverified. Until they close, no anchor code ships and no
timeline promises anchor-backed entry dates. Evidence and acceptance criteria:
[security-review.md](../docs/security-review.md).

## Interfaces to core/

- `anchor.ts` holds derivation, range filter and burn registry as pure logic; this folder
  is the service around it: SMS gate, HSM/enclave calls, VOPRF transcript, burn writes.
- Burn-on-slash: `P` travels inside the sealed capsule and surfaces only when slashing
  opens it (`protocol.md` §6, `capsule.ts`).
- Never store a digest of a phone number. The number space enumerates in about a second
  on one GPU; the OPRF behind a non-exportable key, gated by SMS proof-of-possession, is
  the only acceptable construction (`.agent/AGENT.md`, `protocol.md` §6).

## Open, carried not decided

- Lossy-commitment hedge (Threema: first 4 bytes of a check hash + rate limits) against
  OPRF key leakage — cheap, undecided (`prior-art.md` §2.12).
- Burn-expiry duration and retroactive-commitment shape (`next.md`).
- Registration-oracle posture beyond neutral SMS + holder notification + honest copy: the
  oracle is inherent to phone uniqueness and standard across the industry (`protocol.md`
  §12).

## Planned tree

```text
anchor/
  README.md          this file
  src/
    evaluate.ts      VOPRF transcript, SMS-proof gate, no-batch enforcement
    sms.ts           neutral copy, range filter, holder notification
    custody.ts       two-admin split, provider separation, rotation story
    backend/         one adapter per outcome of verification 1
                     (hsm-raw-point/ vs enclave/); the loser is deleted
  test/              gate enforcement (no proof, no evaluation),
                     range filter tables, burn-expiry property tests
```

## Non-goals

Identification, age verification (minors hold contracts — cite AVS/KJM posture honestly,
`prior-art.md` §4.5), any store of numbers or digests, any batch or admin-lookup path.
