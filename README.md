# cmeet

Whitelabel community frontend over the `cmtymeet` FSL cores (`cvld`,
`cfrm`, `cmsg`) and LGPL primitives (`cvch`, plus future phone/payment
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

No `LICENSE` file is committed yet. BUSL-1.1 is proposed; the final
license text (including Change Date and Additional Use Grant) is an
owner decision. Do not assume a license grant until one is published
in this repository.
