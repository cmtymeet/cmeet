# core

Thin shared client layer. Used by `apps/web` today and `apps/tauri` later.

- `src/cmsg.ts` — a provisional TypeScript UI port for the `cmsg` local API. One
  interface (`CmsgClient`) with typed requests, responses and events. The
  frontend calls only this port; it holds no keys or crypto. It must be
  reconciled with the generated cmsg registry before production integration.
- `src/dev-adapter.ts` — **development adapter only**. An in-memory
  `CmsgClient` with seeded members, gates, waves, groups and devices for UI
  development and component tests. Never shipped as production behaviour. The
  generated client and its types replace this provisional seam. UI fixture
  tests do not establish backend correctness or network readiness.
