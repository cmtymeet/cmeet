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

## Scope

cmeet owns the product shells: one Rust CLI with JSON, TUI and MCP surfaces,
the Svelte 5 PWA, shared presentation components and the real toy acceptance
scenario. Future native shells reuse the same interface. Commands and schemas
come from the cmsg action registry; every shell calls only cmsg. Member, admin
and root credentials keep their separate scopes, with privileged operations
forwarded through Foyer to cvld.

The product renders owner results, events, readiness and failures. It contains
no domain rules, key custody, independent action registry or direct cvld/cfrm
client. Production builds cannot select development fixtures or software
authenticators. Libraries and their implementations live in their own
repositories.

Acceptance requires the same real member, admin, root, group, offline-delivery
and device-loss restore scenarios through the generated surfaces. Member use
waits for actual Mesh bootstrap and onion publication. The CLI also drives
`tests/toy`; adapter tests and unavailable operations cannot satisfy the
conjunctive network scenario. Production CLI passkey custody remains an open
integration boundary.

## Status

The [web frontend](apps/web) has development UI journeys and production checks
that require an actual browser cmsg runtime. Production excludes the development
fixture and refuses to start without that runtime. The handwritten TypeScript
port is temporary; generated registry integration is pending.

The [Rust CLI](apps/cli/README.md) currently exports the actual cmsg registry's
CLI, MCP and OpenAPI descriptions through `cmeet api`, invokes raw owner actions
through `cmeet invoke`, serves them through `cmeet mcp`, and presents them through
`cmeet tui`. Connected modes require an already paired owner runtime and a
protected capability handoff; production bootstrap and member operations remain
unavailable. Real Door/process adapter tests do not establish a working community
network.

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
