# cmeet

Community frontends over the `cmsg` member API: a Svelte 5 PWA and one Rust
command-line program. Member, admin and root operations all use cmsg. Foyer
forwards admin/root operations to cvld; frontends implement no admission,
accounting, matching, key custody or messaging rules.
Product requirements: [user stories, decisions, open questions and glossary](docs/product/README.md).

The product layout is `apps/web`, `apps/cli`, shared `ui`/`core`, and `tests/toy`.
Native shells can later live in `apps/tauri`. Library implementations remain in
their own repositories.

Deployment configuration supplies `baseDomain`; community, admin/root, API and
MCP hostnames derive from it. Communities can graduate to a custom domain with a
stable `communityId`. See [domain configuration](docs/domains.md).

## Status

The [web frontend](apps/web) has development UI journeys and production checks
that require an actual browser cmsg runtime. Production excludes the development
fixture and refuses to start without that runtime. The handwritten TypeScript
port is temporary; generated registry integration is pending.

The [Rust CLI](apps/cli/README.md) currently exports the actual cmsg registry's
CLI, MCP and OpenAPI descriptions through `cmeet api`. Runtime commands, TUI and
MCP serving still require the real authorized runtime. Shell tests and schema
inspection are not a working community network.

The [toy acceptance contract](tests/toy/README.md) is **blocked**. Real voucher
admission, proof-backed accounting, Tor conversations, groups, offline delivery
and same-passkey device-loss restore must all pass before product acceptance.

The obsolete top-level JavaScript server, native backend and generated vendor
package graph have been retired. [The retirement record](docs/retired-prototype.md)
identifies their consumers, reusable mechanisms and historical evidence. The
only Rust product program is `apps/cli`; the web package remains isolated under
`apps/web`. CLI checks may pass while the required `toy` acceptance gate stays
red. No current runtime image or deployment is certified by this migration.

## License

The cmeet source in this repository is licensed under [BUSL-1.1](LICENSE.md).
There is no Additional Use Grant: production use requires a commercial license
until the applicable Change Date. Each specific version changes to Apache-2.0
four years after its first public distribution under BUSL. Dependencies retain
their own licenses.
