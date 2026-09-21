# Security review and release gates

Reviewed 2026-09-07. **The repo is an executable protocol model, not a deployable
anonymous membership system.** No member data, live service or production keys
were involved. Product choices are tracked in [decisions.md](decisions.md).

**Retention addendum, 2026-09-08:** the [relay architecture review](../studies/relay-architecture-2026-09-08.md)
also found exact last-seen timestamps and balances retained after disconnect;
`ConversationBook.snapshot()` omits both. Burn expiry deletes only on lookup.
These are resident model-state findings, not a deployed database audit. The
[data lifecycle](data-lifecycle.md) inventories source locations and required
migration checks. The public board is now an archived alternative; anonymous
quota enforcement and live-discovery usefulness remain unresolved.

## Confirmed defects repaired in the model

The first nine adversarial tests in `core/test/security.test.ts` all failed on the
original implementation. The full suite now passes: **68 tests, Node 24.19.0**,
executed in the existing cluster runner. This is regression evidence, not an
independent cryptographic audit or proof of the production privacy claims.

| Defect | Effect | Repair |
|---|---|---|
| Unsalted `SHA256(credential ID || anchor)` in the commitment bag | A database holder enumerates the two stored bags and links members to anchors, without knowing phone numbers or the OPRF key | Surety payload includes a 32-byte random self secret, unavailable in the database below threshold |
| Retraction did not check who vouched | Any anchored member could remove another member's surety link | Voucher-client-only ownership map; unrelated, repeated and revoked-voucher retractions fail |
| Retraction recycled the last issued share regardless of target | Different invitees received the same interpolation point, defeating threshold slashing | Retire the exact share; never reissue it or refund the lifetime invite |
| AES-GCM did not authenticate the share coordinate | Changing `x` corrupted a valid decrypted share | Versioned HKDF context and authenticated coordinate |
| Decoder accepted short tags and partially parsed hex | A truncated authentication tag or malformed encoding could be accepted | Require a 16-byte tag, 12-byte nonce, canonical hex and a 32-byte self secret |
| Invalid Shamir counts and coordinates | NaN, fractions and out-of-field inputs produced invalid arithmetic | Validate integer counts, field coordinates and nonempty byte arrays; independent fixed-polynomial reconstruction test |
| Invite spent before admission validation | A rejected admission consumed the member's invite | Check the composition limit before consuming the invite or detaching a share |
| A slashed voucher did not release its upstream share | Multi-level slashing stopped early | Reconstructed payload supplies the self secret; iteratively process cascades and remove consumed shares |
| Mutable or invalid model configuration and clocks | Caller mutation, invalid thresholds and nonfinite times bypassed assumptions | Copy/freeze validated policy, copy the model key, reject invalid classes and clocks |

The surety payload is now `credential[16] || anchor[32] || selfSecret[32]`.
Its commitment hashes all 80 bytes. The self capsule holds
`selfSecret[32] || anchor[32]` for an anchored member and only the self secret
otherwise. Stored surety shares use that random self secret, **never an anchor
from the server's enumerable anchor bag**, as input to HKDF and AES-GCM.

## Security boundaries that remain unimplemented

These are release blockers, not assurances supplied by the model's tests.

1. **Anonymous credentials and authorization.** `Network` holds every client's
   secrets and accepts a caller-supplied credential ID. It has no Merkle membership
   proof, blind issuance, revocation proof or authenticated flag evidence. Calling
   `flagMember` three times is a trusted simulation event. Never expose this API
   over HTTP. Production verification must reject forged credentials, repeated
   evidence and cross-community/subject/epoch replays before any state changes.
   Phone-only entry is intentionally allowed by protocol §7/§13; invite budgets
   do not constrain that path. Its anti-abuse cost must be evaluated separately.
2. **Capsule custody and availability.** Unreleased self shares currently live in
   the accused member's simulated client. An absent or malicious client can refuse
   to cooperate in a real deployment. The protocol must specify independent,
   authorized release and prove that one malicious reporter cannot unlock it.
3. **Snapshot privacy is narrower than observer privacy.** Registration calls see
   phone numbers and voucher IDs. The server stores handles, join times, invite
   owners and flagger IDs; share coordinates reveal issuance order. Nullifiers
   alone do not erase these links. Prove the final persistent schema and observed
   transcripts against the actual threat model, including repeated snapshots.
4. **Retraction cannot erase old copies.** Removing a sealed share from today's
   map does not make a retained earlier snapshot disappear. If the invitee's self
   secret is later released, an old copy can be decrypted. Do not promise
   cryptographic erasure or retroactive secrecy from the repaired model.
5. **Adversarial resource bounds.** Trying every k-subset of an unlabelled pool is
   combinatorial. Removing consumed shares helps cascades but does not bound an
   unmatched pool. Production needs bounded verification/scheduling and a proof
   that overload neither blocks the service nor silently drops sanctions.
6. **Chat security.** No authenticated key exchange, group membership transcript,
   replay protection, message-key schedule or E2EE implementation exists. A
   deterministic leader alone cannot stop relay equivocation. Membership changes
   need fresh keys before further messages, in addition to periodic rekeying.
   Signed message receipts conflict with the claimed deniability; see D9.
7. **Production cryptographic implementation.** The handwritten GF(256) code has
   table lookups and is not claimed to be constant-time. Passing examples cannot
   prove information-theoretic secrecy. Select reviewed implementations and test
   conformance vectors at the actual service/client boundary before release.

## Verification 1: VOPRF and custody — open

**Established from specifications:** RFC 9497 VOPRF requires a group-element
evaluation and a DLEQ proof under a client-known public key. Pin that key across
clients; accepting a different key from each evaluator response defeats the
anti-tagging goal. RFC 9497 itself does not specify the required two-provider
threshold custody protocol.
[RFC 9497 §§2–3](https://www.rfc-editor.org/rfc/rfc9497.html#section-3.3.2)

AWS KMS `DeriveSharedSecret` exposes ECDH, not a VOPRF evaluation/proof API.
Its documentation does not establish the operations needed to generate the DLEQ
response under a non-exportable VOPRF scalar. This is enough to reject it as a
drop-in backend; it does **not** prove that every HSM is unsuitable, or that
x-coordinate output alone makes every possible construction impossible.
[AWS KMS API](https://docs.aws.amazon.com/kms/latest/APIReference/API_DeriveSharedSecret.html)

An enclave does not imply SGX. Nitro Enclaves offers isolated compute, attestation,
no persistent storage and no external networking; a parent must relay requests.
It is a candidate for evaluating software VOPRF inside attested compute, not a
verified deployment or a substitute for independent custody. No instance was
rented and no new spending was initiated.
[AWS Nitro Enclaves](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html)

**Additional blocking flaw in the specification:** approving SMS possession of
number A does not prove that a blinded input encodes A. An attacker can pass SMS
for their own number while requesting an evaluation for B. Binding a bearer token
only to that supplied blinded element prevents substitution after issuance but
does not prove the underlying number. A phone-specific proof relation, or a
reviewed trusted/attested binding step with its visibility disclosed, is required.
This is an inference from the defined VOPRF input-hiding property and our proposed
SMS gate; no such binding protocol exists in this repo.

Close this gate only with: an exact backend and custody protocol; RFC test-vector
results; enforced public-key pinning; fresh single-use SMS authorization bound to
the evaluated input, purpose, audience and expiry; no arbitrary/batch lookup;
concurrent replay tests; attestation/key-release policy; and a costed deployment.

## Verification 2: passkey PRF and storage — device results absent

`prf.enabled` belongs to credential creation, not authentication. On `get()`,
inspect the presence and shape of `prf.results.first`; absence means encryption
is unavailable for that operation, not that authentication failed. Do not send
PRF output to the authentication server as part of a serialized credential.
[WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension)

FIDO's Credential Exchange Format includes optional HMAC credential material for
PRF, with rules to preserve its output across providers. That does not prove a
particular provider exports/imports it. Passkey sync or successful login alone
does not prove that encrypted history will decrypt after migration.
[FIDO CXF](https://fidoalliance.org/specs/cx/cxf-v1.0-rd-20250313.html#sctn-fido2-hmac-credentials)

WebKit describes home-screen apps as exempt from ITP's seven-day script-storage
cap; this is not a promise against eviction, user deletion or device loss.
[WebKit storage policy](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)

Required real-device matrix, with exact OS/browser/provider versions:

| Case | Required evidence | Result |
|---|---|---|
| Windows Hello, create then repeated get | Same salt and credential yield the same output where supported | Not run |
| Firefox on Android | Supported/absent PRF paths both preserve login | Not run |
| Chrome and Safari on supported iOS | Platform and cross-device routes agree; unsafe versions remain blocked | Not run |
| Same-provider sync and cross-provider exchange | Actual exported history decrypts on destination | Not run |
| Second enrolled credential | Both distinct credentials unlock the same random account key | Not run |
| iOS home-screen storage | Close/reopen, inactivity, storage pressure and explicit deletion | Not run |

Use only disposable credentials and synthetic local canaries. Record pass/fail
and versions, never PRF outputs or private keys. Preserve the existing envelope,
two-credential enrollment and session-only fallback decisions. A mismatch must
leave original ciphertext untouched; commit key changes only after decrypting the
canary and successfully reopening a staged replacement. No real-device results
can be inferred from headless or model tests.

## Verification 3: Cloudflare metadata — platform evidence, live test pending

Cloudflare documents historical metrics, a per-object ID/name filter and four
GraphQL datasets: invocations, periodic samples, storage and subrequests.
WebSocket invocation metrics appear after closure. These metrics are distinct
from opt-in Worker logs. An empty live query would not prove absence of internal
provider retention, either.
[Durable Object metrics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/)

Disable observability and its logs/invocation logs/traces explicitly in the pinned
Wrangler version; inspect the effective deployed settings. JSONC is our chosen
format, not a security property: the provider also documents TOML. Keep the
standard-WebSocket-only decision, no application storage calls, no Tail Worker,
no Logpush and no application logging on the relay path.
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)

The bounded live experiment is still required: baseline the four datasets; open
two synthetic sockets in one randomly named object; send fixed dummy traffic;
close both; query again after ingestion; repeat after eviction and later time
windows. Record request/activity dimensions and observed retention separately
from message storage. Capture configuration, timestamps and sample counts without
member identifiers. No verification Worker was deployed during this review.

Cloudflare currently bills an active standard-WebSocket object at 128 MB, with
400,000 GB-s/month included on Workers Paid, then $12.50/million GB-s rounded up
by billable unit. Its examples use 0.128 GB: one object for 30 days is 331,776
GB-s, about 83% of that allowance. Account usage and requests are additional
inputs; “two rooms exceed the allowance” is not a complete invoice estimate.
[Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

Until the live inventory is complete, the defensible target is **no application
message storage**, with provider activity metadata expressly disclosed. Stronger
wording needs evidence and the D8 product decision.
