# Import provenance

Sanitized reference import into `cmeet` from the retired predecessor study
repository `smbit-ch` (final commit `9b3f86173a8a6d389b9b16eeb610380045a54de5`,
2026-09-21). Adult-brand studies (domain/naming screens, raw registry JSON,
micropayment adult-merchant passages), owner-identity operator notes
(`.agent/AGENT.md`), scene-specific prior-art analysis, and the archived
ad-board alternative were deliberately NOT imported — discarded with the old
repository per owner direction. Wording was genericized (`smbit` → `cmeet`);
no behavior or claims were changed — these remain design proposals, not
deployed-system descriptions.

## Where the rest maps

- Executable membership model (`core/` protocol, capsules, sharing,
  equilibrium, presence accounting + tests): belongs in the FSL cores
  (`cfrm`/`cvld`), NOT in this frontend. Not copied here; promote via
  reviewed core PRs if needed.
- Surety/admission protocol design (`docs/protocol.md`): maps to `cfrm`
  policy work. Carries predecessor-community specifics; sanitize before reuse.
- Prior-art mechanism notes (escrow k=2, simhash clustering, 3DH shape,
  envelope patterns): reusable ideas, but the write-ups are scene-specific
  and were discarded. Re-derive from public sources when needed.
- Phone anchor service spec (`phone-anchor.md` here): client/signup view only.
  Server-side VOPRF custody work belongs in `cvld`/LGPL adapters.

## Status of these documents

Reviewed September 2026 against an unbuilt prototype. They record intended
boundaries (profiles on devices, live E2EE sessions, minimal persistent
security state) and open decisions — not shipped behavior.
