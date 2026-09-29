# cmeet

Whitelabel community frontend over the `corbet-libs` FSL cores (`cvld`,
`cfrm`, `cmsg`) and `corbet-foss` LGPL primitives (`cvch`, plus future phone/payment
helpers). One deployment per community, selected by config
(`communityId`, host allowlist, brand/copy, policy tunables).

All UI lives here: routing, discovery, profiles, first-contact, DMs,
device/passkey screens, theming, per-community config, and domain
migration. Trust logic (eligibility, admission, transport, accounting)
stays in the cores; this app composes them.

Deployment configuration supplies `baseDomain`; community, admin/root, API and
MCP hostnames derive from it. Communities can graduate to a custom domain with a
stable `communityId`. See [domain configuration](docs/domains.md).

## Status

The initial website includes voucher admission, passkey authentication, profiles,
discovery, direct conversations, optional scoped API keys, and an MCP endpoint.
These components are under integration validation; a successful build is not
evidence of a complete live peer-to-peer conversation.

The server composes the libraries through `server/start.mjs`. Its private
configuration explicitly selects durable storage. Turso connections are shared
across admission, API keys, enrollment, accounting, and discovery control;
Valkey holds ephemeral discovery data. Member keys and message content remain
on member devices. See [storage configuration](docs/storage.md).

## License

The cmeet source in this repository is licensed under [BUSL-1.1](LICENSE.md).
There is no Additional Use Grant: production use requires a commercial license
until the applicable Change Date. Each specific version changes to Apache-2.0
four years after its first public distribution under BUSL. Dependencies retain
their own licenses.
