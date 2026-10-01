# Prototype retirement

The last complete source snapshot of the retired prototype is
[`c653ed8a579592a5d4383d0f9a1ca380c387b20a`](https://github.com/cmtymeet/cmeet/tree/c653ed8a579592a5d4383d0f9a1ca380c387b20a).
Git history preserves its implementation and tests. The current product uses
one Rust cmeet program and the cmsg door. Removing the prototype does not make
the member runtime, browser integration or toy scenario ready.

## Consumer inventory

| Retired root | Consumers and reason for retirement |
|---|---|
| `native/backend` | `server/backend.mjs` launched its JSON-line executable; `server/start.mjs`, setup/storage/account configuration and old browser tests depended on its server-side discovery/accounting/key routes. Current cfrm deliberately removed these SQL/accounting/admission APIs. The frontend cannot own replacements. |
| `.ci/accounting-native` | `.ci/accounting-checks.sh`, browser proof fixtures and `.ci/reuse-accounting-native.mjs` used the old cfrm proof/account protocol. Their fixed legacy proof relation is not current G2/G5 authority. |
| Root `package.json`, lock, `src`, `index.html`, Vite config | The old Svelte app imported generated `file:vendor` cmsg/cvld/cfrm/TorJS packages. Source preparation depended on old repositories and mismatched browser/native revisions. Root npm resolution was broken. `apps/web`, `ui` and `core` are the maintained client tree. |
| `server`, old top-level `tests` | Tests exercised that old server or its browser composition, including direct cvld/cfrm authority. Those tests remain historical evidence; the new shell tests exercise only cmsg. No historical pass is attributed to the new runtime. |
| `.ci/prepare-sources.mjs`, reuse/check scripts, `sources.json` | Produced and reused the obsolete vendor graph and native helpers. Cargo now resolves the product's single root once in CI and retains the lock artifact used by every dependent job. |
| `Dockerfile`, old deployment staging/entrypoint, website/accounting/image workflows | Built the retired Node/native authority bundle. They cannot package the target cmsg product. No replacement deployable artifact is claimed. Historical archive validators remain under `tools/evidence/legacy`. |

## Preserved guarantees and evidence

- `apps/cli/src/runtime.rs` preserves bounded reads, deadlines, raw input and
  terminal failure without replay. Native HTTP uses the owner's client rather
  than a second local authorization protocol. CLI process tests use isolated
  children with bounded waits and termination on drop.
- `.ci/assert-asset-closure.mjs` remains active in the web build. All reviewed
  Svelte source, development journeys, production fixture-exclusion and cache
  refusal checks remain. They do not certify live cmsg integration.
- The historical image/archive validators retain source identity, SHA-256,
  package integrity, staged path/symlink confinement and native smoke evidence
  checks. They accept only their old format and are not part of current builds.
- The old child adapter's bounded stderr/queue, admission deadlines and no-retry
  behavior are available at `server/backend.mjs` in the linked snapshot. Future
  toy service orchestration must preserve them and kill/reap every owned child.
- [CLI foundation and legacy-root failure](https://github.com/cmtymeet/cmeet/actions/runs/36896724174),
  [preserved web evidence](https://github.com/cmtymeet/cmeet/actions/runs/36896724603)
  and [legacy source-closure refusal](https://github.com/cmtymeet/cmeet/actions/runs/36896724729)
  describe distinct inputs and checks. Earlier
  [native-root checks](https://github.com/cmtymeet/cmeet/actions/runs/36895023311)
  are historical prototype checks, not new API acceptance.

The `toy` job now fails explicitly until the real conjunctive scenario exists.
Every stage in [its contract](../tests/toy/README.md) remains required. An absent
verifier, reservation, anonymous room permit or replica cannot be replaced with
an accepting fixture. The dependency merger continues to require toy, web,
coverage and every other substantive exact-head check plus enforced protections.

The nonmoving `prototype-before-cmsg-cli` tag preserves commit
`c653ed8a579592a5d4383d0f9a1ca380c387b20a` before retirement. It is a
historical source reference, not a release or runtime acceptance.
