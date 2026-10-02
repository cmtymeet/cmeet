# cmeet web app

Svelte 5 single-page app (PWA, responsive) over the `cmsg` local API. It
holds no logic, no keys, no crypto: every screen calls the `CmsgClient`
port in `core/`. The development server uses an in-memory UI fixture.
Production builds exclude that fixture and show an unavailable screen until
the generated browser cmsg runtime is integrated. This frontend is not yet a
working community client.

## Run

All commands run in `apps/web`:

- `npm ci` — install dependencies
- `npm run dev` — local development server
- `npm run typecheck` — strict TypeScript and Svelte component checks
- `npm run test:unit -- --coverage` — mounted component and port tests with
  strict shared UI/core coverage, including sources outside the app directory
- `npm run build` — production build
- `npm run test:e2e` — Playwright UI fixture journeys in the development server
- `npm run test:production` — production installability, offline-shell,
  refusal and fixture-exclusion browser tests against the build
- `npm run preview` — serve the production build locally

## Screens

Connecting (network preload gate), arrival with voucher, lobby, profile
editor (schema-driven, live flashcard preview), forum discovery with
two-way filters, waves (answer and respectful close), contacts and blocks,
one-to-one chat, groups by size (circle, ingroup, public room with level
and what-changes-next), devices, admin schema editor (drag and drop with
keyboard move buttons), root community settings, and settings. Public records
and punishment are switched off for the MVP. Optional community display names always accompany
the handle; validation and handle policy remain behind cmsg.

## Notes

- The manifest supplies an app identity and sized icons. A browser-provided
  install action needs an explicit click; Home Screen instructions cover
  Safari and Android menus. No push permission is requested.
- No trackers or third-party asset requests. The service worker precaches
  only the exact public build closure after checking response privacy headers.
  It never caches API/member data or query requests. Offline reload shows the
  public shell; connection readiness still comes only from cmsg. A strict CSP
  meta tag ships in `index.html`.
- White-label theming is CSS tokens only (`ui/src/tokens.css` plus a
  theme file selected in `src/community.ts`).
- English strings live in `ui/src/i18n/en.ts` and `src/strings/`; shared
  components also accept labels as props.
- Production portal routing follows `admin.<community>.<base>` and
  `admin.root.<base>`. The backend role gate authorizes operations. Fixture
  hash routes for these portals exist only in development.
- `?dev-connect-delay=ms` slows the preload for observing the connecting
  screen. Development adapter only, never production behaviour.
