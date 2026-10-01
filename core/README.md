# core

Thin shared client layer. Used by `apps/web` today and `apps/tauri` later.

- `src/cmsg.ts` — the TypeScript port of the `cmsg` local API. One
  interface (`CmsgClient`) with typed requests, responses and events. The
  frontend talks ONLY to cmsg through this port; it holds no logic, no keys,
  no crypto.
- `src/dev-adapter.ts` — **development adapter only**. An in-memory
  `CmsgClient` with seeded members, gates, waves, groups and devices for UI
  development and component tests. Never shipped as production behaviour. The
  real generated client replaces it without changing components.
