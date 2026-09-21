# app/ — member PWA client

**Status: specified, unbuilt; relay proposal reviewed 8 September 2026.**

Private profiles, messages, history, blocks and reports-in-progress live on member
devices, under keys the operator should never receive. Recipients can keep copies.
This is an intended boundary, not a proven implementation; SMS/admission visibility
is separate. See [architecture](../docs/architecture.md) and
[data lifecycle](../docs/data-lifecycle.md).

## What it is

- **Install-first PWA.** Keep the web/PWA delivery decision and verify local storage
  behaviour on real devices. The relay proposal does not rely on Web Push or retain
  push subscriptions; all-online sessions require overlapping active clients.
- **Member-held profiles and live introductions.** Keep preferences, profile text,
  display labels and contact capabilities on-device. Share selected fields only
  with authenticated, member-selected recipients. No upload or offline profile
  catalogue in this candidate; D11 remains open about that product trade-off.
- **Passkey login, no passwords, no reset path.** Two passkey credentials enrolled as a
  **blocking signup step**, a decryptable canary verified before any re-encrypt, an
  exported recovery blob, and login that never depends on PRF — degrade to session-only
  history when PRF is unavailable. `prf.enabled` is a create-time signal; on `get()`
  inspect `prf.results.first` ([security review](../docs/security-review.md)).
- **History under Bitwarden's envelope.** PRF output → HKDF → wraps an RSA private key →
  which unwraps the account symmetric key. Never bind the history store to a raw PRF
  output: no second passkey, no rotation (`.agent/AGENT.md`). Per-device, encrypted, lost
  with the device, exportable. An encrypted export restores only if the destination
  preserves the PRF material.
  Successful passkey sync/login does not prove this; verify an actual decrypt on
  each supported route ([security review](../docs/security-review.md)).
- **Ephemeral by default, member-controlled.** Per-conversation "save history" defaulting
  to off, toggleable, with an explicit delete action — Cwtch shipped proof that real users
  accept this (`prior-art.md` §2, `.agent/AGENT.md`).
- **No long strings anywhere in the UI.** No Session-style 66-character identities, no
  visible keys. Proposed display names are member/contact-local labels, not a server
  reservation or lookup key. People meet through live introductions and closed rooms.
  Phone-only admission stays; a newcomer's introduction route still needs validation.
- **Client-controlled blocks and reports.** TrustNet hide modes precede disclosure:
  Personal stays local; Network/Propagated involve chosen peers. The old proposal
  for server simhash clustering needs a new leakage/retention assessment. Do not
  send content fingerprints or plaintext allegations to the operator by default.
  Threshold sanctions remain required; their proofs/custody are unimplemented.
- **Join without an empty room.** The inviting member's client pushes a bounded slice of
  its own local history over the live session — bounded hard, opt-in per group
  (`prior-art.md` §2.8).
- **Recovery by voucher re-mint.** A lost account is revoked by its voucher and re-minted,
  spending an invite, without an operator reset. This restores membership, not
  lost profile/history keys (`next.md`).

## Hard constraints

- Block PRF-backed accounts on iOS 18.0–18.3 (cross-device authentication returned
  different PRF outputs there — silent destruction of already-encrypted data).
- Never make login depend on PRF; never bind storage to a raw PRF output; two credentials
  at signup, not as a settings-page suggestion (all: `prior-art.md` §4.4).
- iOS 18.4+ only for PRF paths until the device matrix (`next.md` verification 2) says
  otherwise, on real hardware — every 2026 support claim traces to one vendor blog that
  contradicts Bugzilla.

## Interfaces to core/

- `protocol.ts` for credential proofs, invites, vouching, revocation checks.
- `conversations.ts` + `equilibrium.ts` for presence display, live roster, reciprocity
  semantics and tolerance-dial surfacing. The model's persistent last-seen and
  balance maps are not the production relay schema. Local-only counters cannot
  securely enforce quotas against a modified/reset client.
- `capsule.ts` / `shamir.ts` for sealed report shares (Callisto-style escrow at k=2,
  `next.md` "decided, not yet built").
- Planned: history envelope, reviewed authenticated session protocol and local
  profile/contact storage. A 3DH formula alone is not a complete E2EE protocol.

## Planned tree

```text
app/
  README.md          this file
  src/
    signup/          two-credential enrollment, canary, recovery blob export
    history/         RSA-indirection envelope, per-device store, export/import
    chat/            all-online session UI, live roster, rekey handling
    rooms/           owned 3-8 rooms, join-slice opt-in, close flow
    profile/         member-held profile, local contacts, live field sharing
    report/          hide modes; sanctions/escrow subject to custody review
    recovery/        voucher re-mint flow
  test/              envelope round-trips, canary-before-reencrypt,
                     PRF-absent degradation paths
```

## Non-goals

Native apps (web + install-first PWA only, per the founding constraint), password or email
flows of any kind, server-held drafts or backups, global search, public directory.
