# Browser page for `cmeet login`

`cmeet login` opens the community page in the member's normal browser. The
browser runs the passkey ceremony with the member's synced passkey and the
runtime hands the result to the one-time loopback callback of the local CLI.
Nothing passes through our servers (the `gh auth login` pattern).

## What this frontend owns

Presentation only, in `apps/web/src/views/CliLogin.svelte`. It confirms the
exact community origin and the local handoff, starts only on a user click, and
shows cancel, retry, failure and success states that the runtime reports. It
holds no key, no PRF output, no capability and no callback address.

## Integration seam to cpky and cmsg

The typed port is `core/src/cli-login.ts` (`CliLoginPort`):

| Call | Owner | Purpose |
|------|-------|---------|
| `inspect(launch, pageOrigin)` | runtime | Receives the raw launch fragment once, validates it, returns display data or a refusal. |
| `begin()` | runtime | After the click: ceremony via the vault pop-up route, then the local callback. Returns status only. |
| `cancel()` | runtime | Cancels a pending request. |

The launch URL is `https://<community>.<base>/#/cli-login/<opaque>`. The page
recognises only the prefix `#/cli-login/`, hands the whole fragment to
`inspect`, and removes it from the address bar at once. The runtime must:

- accept only the exact community origin of the page (no suffix matching);
- accept only a literal `http://127.0.0.1:<port>/finish` callback with no
  userinfo, query or fragment, and no redirects;
- consume the request exactly once (replay, expiry and concurrent begin are
  refused) and deliver the result directly to loopback;
- return `retryable` only where another attempt is genuinely possible.

`core/src/dev-cli-login.ts` is a development-only stand-in with those checks so
the page can be exercised; production builds exclude it and show an honest
"not available" page until the generated runtime is wired in
`apps/web/src/browser/cli-login.ts`. Real browser-to-loopback execution and the
installed iPhone route are not claimed here.
