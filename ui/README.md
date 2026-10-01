# ui

Shared Svelte 5 components and white-label themes. Used by `apps/web` today
and `apps/tauri` later. No trackers, no third-party requests.

- `src/components/` — plain, calm, accessible building blocks (WCAG 2.2 AA
  target): buttons, fields, notices, dialogs, cards, group and wave views.
  Dialogs are labelled, modal, and close on Escape with focus moved inside.
- `src/tokens.css` — white-label theme as CSS custom properties. A community
  overrides tokens in its own file; components never change.
- `src/themes/` — example themes (`forest`, `harbour`).
- `src/i18n/en.ts` — English strings first. Translators copy this file; keys
  stay stable. User-visible text reaches components as props.

Headless behaviour (tabs, dialog, segmented controls) uses native elements
with ARIA roles so the kit stays dependency-free and CSP-friendly.
