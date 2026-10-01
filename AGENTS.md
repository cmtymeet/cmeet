# Engineering boundaries

The product consists of thin clients of the `cmsg` member API. Member, admin and
root commands all use that API; admin and root operations reach `cvld` through
Foyer. Frontends do not call `cvld` or `cfrm` directly or implement domain rules.

The target layout is `apps/web` (Svelte 5 PWA), `apps/tauri`, `apps/cli`, `ui`,
`core`, and `tests/toy`. The Rust CLI is one `cmeet` program. Existing top-level
application code is an earlier implementation, not evidence that the target
architecture has been integrated. Preserve other contributors' ongoing work.

- Keyhole (`ckyh`) verifies passkeys on the server. Passkeys (`cpky`) performs
  device ceremonies and strips PRF output from every server-bound response.
- Members own their secrets and content. Devices serve DHT records while in use;
  servers store no DHT records or member activity logs.
- A device-loss restore with the same passkey must recover identity, memberships,
  contacts and history from surviving replicas. Missing replicas must remain
  visible as a failure; never manufacture an empty successful restore.
- Use maintained dependencies. First-party Git dependencies follow `main`;
  lockfiles record one resolved revision per first-party crate. Dependency
  updates merge only after substantive checks pass on their current revision.
- Build and test in CI. Require full measured coverage and real crypto, storage,
  transport and browser round trips. Development UI adapters cannot satisfy
  product acceptance or be selected by a deployed build.
- The toy model must drive the same member API as the product. Disabled checks,
  synthetic admission verdicts and substituted Tor transports are failures.
- Never publish packages or images to registries from this task. Deployment
  credentials stay out of the repository, public CI, artifacts and logs.
- Write code and documentation in English; use plain commit messages without
  AI attribution. Use an isolated working tree and stage explicit paths.
