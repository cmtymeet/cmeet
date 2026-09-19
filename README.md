# cmeet

Whitelabel community frontend over the `cmtymeet` FSL cores (`cvld`,
`cfrm`, `cmsg`) and LGPL primitives (`cvch`, plus future phone/payment
helpers). One deployment per community, selected by config
(`communityId`, host allowlist, brand/copy, policy tunables).

All UI lives here: routing, discovery, profiles, first-contact, DMs,
device/passkey screens, theming, per-community config, and domain
migration. Trust logic (eligibility, admission, transport, accounting)
stays in the cores; this app composes them.

Starter tenancy is `x.cmeet.me`, graduating to a custom domain per
community with a stable `communityId`.

## Status

Scaffold pending. No source committed yet.

## License

No `LICENSE` file is committed yet. BUSL-1.1 is proposed; the final
license text (including Change Date and Additional Use Grant) is an
owner decision. Do not assume a license grant until one is published
in this repository.
