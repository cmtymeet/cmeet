# Browser separation: frontend seam

Decided layout (never the inverted embedding):

| Part | Origin | Holds |
|------|--------|-------|
| Member UI (Svelte PWA, installed) | `<community>.<base>`, top-level | presentation only; talks to cmsg only through a typed client |
| Vault frame | `vault.<community>.<base>`, embedded | the cmsg runtime, keys and custody |
| Sign-in pop-up | `vault.<community>.<base>`, top-level, short-lived | the passkey ceremony, for every browser |

The UI never touches keys, the PRF output, the credential or any ceremony
payload. It receives only a ceremony status (`CeremonyStatus` event in
`core/src/cmsg.ts`): continue-needed, popup-open, done, cancelled, blocked,
timeout, failed.

## Ceremony route

1. The UI asks for an operation that needs the passkey (join, sign in, role sign-in).
2. The vault frame shows a visible **Continue** control. The pop-up must open from a
   real click inside the vault-origin frame; a click in the UI would not activate
   the cross-origin frame.
3. The pop-up (top level at the vault origin) runs the ordinary ceremony, hands the
   result to the vault frame over a same-origin channel and closes. The pop-up
   carries a per-request nonce; a stale or foreign result is ignored.
4. The vault frame completes the operation. The UI sees statuses only.

Blocked pop-ups, a window closed early and timeouts stay visible with a retry.
If the installed-iPhone pop-up route fails, the reserved one-origin fallback is an
owner decision; it is never activated silently.

## What this repository implements

- `apps/web/src/browser/origins.ts`: exact origin parsing, no suffix checks;
  the vault origin is `vault.` plus the exact member host.
- `apps/web/src/browser/vault-entry.ts`: the vault host (first label exactly
  `vault`) mounts only the vault frame or the pop-up page, never the member app.
  In production both are an honest "not available yet" page.
- `apps/web/src/views/VaultStatus.svelte`: the member page's status line.
- `apps/web/build/csp.ts`: the member page may frame exactly one origin,
  `CMEET_VAULT_ORIGIN` (an exact https origin) at build time; none by default.
  Production needs the matching `frame-ancestors` response header on the vault
  origin (deployment-owned; a meta tag cannot set it).
- Development only (`import.meta.env.DEV`, `?dev-vault=1`, hosts such as
  `anna.localhost` and `vault.anna.localhost`): `src/browser/harness/` wires the
  development adapter into the vault frame behind one transferred MessageChannel
  (exact member origin and parent window, strictly increasing request ids, bounded
  arguments and timeouts, no rebind). Production builds exclude it (tested).
- `docs/manual/iphone-check.html` and `docs/iphone-checklist.md` for the manual
  installed-iPhone check.

## Runtime handoff (not implemented here)

The generated bridge owns the production transport: `createVaultClient`
(UI) and `startVaultHost` (vault frame) with `VaultBridgeConfiguration`
(`member_origin`, `vault_origin`, `vault_url`, `timeout_millis`). It creates the
frame, checks origin and source, and transfers one channel. This repository must
not build a competing production bridge. To wire it, replace the production
branches in `createClient` (`session.svelte.ts`) and `mountVault`
(`browser/vault-entry.ts`); the ceremony itself stays runtime-owned (cpky). The
frame must stay visible and permit pop-ups so the Continue click can open the
window. Real passkey behaviour, installed-iPhone behaviour and the same-site
channel between the frame and the pop-up (storage partitioning) are untested
here and are covered only by the manual checklist.
