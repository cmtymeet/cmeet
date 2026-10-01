# cmeet web app

Svelte 5 single-page app (PWA, responsive) over the `cmsg` local API. It
holds no logic, no keys, no crypto: every screen calls the `CmsgClient`
port in `core/`, today backed by the in-memory development adapter.

## Run

All commands run in `apps/web`:

- `npm ci` — install dependencies
- `npm run dev` — local development server
- `npm run typecheck` — strict TypeScript check
- `npm run test:unit` — Vitest unit and component tests
- `npm run build` — production build
- `npm run test:e2e` — Playwright journey tests against the built app
- `npm run preview` — serve the production build locally

## Screens

Connecting (network preload gate), arrival with voucher, lobby, profile
editor (schema-driven, live flashcard preview), forum discovery with
two-way filters, waves (answer, close, punish), contacts and blocks,
one-to-one chat, groups by size (circle, ingroup, public room with level
and what-changes-next), devices, admin schema editor (drag and drop with
keyboard move buttons), root community selector, settings.

## Notes

- No trackers, no third-party requests; a same-origin service worker
  caches the app shell. A strict CSP meta tag ships in `index.html`.
- White-label theming is CSS tokens only (`ui/src/tokens.css` plus a
  theme file selected in `src/community.ts`).
- English strings live in `ui/src/i18n/en.ts`; views take labels as props.
- `?dev-connect-delay=ms` slows the preload for observing the connecting
  screen. Development adapter only, never production behaviour.
