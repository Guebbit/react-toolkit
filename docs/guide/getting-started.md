# Getting Started

`@guebbit/react-toolkit` is a small set of React hooks and Zustand stores for building CRUD
screens: a normalized record store, a REST layer with caching, request dedup, and optimistic
mutations with automatic rollback (built on [TanStack Query](https://tanstack.com/query)),
Zod-backed form validation, and two small Zustand stores (toasts, named loading flags).

## Install

```bash
npm install @guebbit/react-toolkit
```

### Peer dependencies

The package expects these already in your project:

| Package | Version   |
| ------- | --------- |
| `react`   | `>=18.0.0` |
| `zustand` | `>=4.0.0` |

`useStructureRestApi` uses `@tanstack/query-core` for cache orchestration.

## What to use, and when

- **[`useStructureDataManagement`](/composables/structure-data-management)** — the base: a
  normalized `{ id -> record }` store with CRUD, selection, client-side pagination, and
  `hasMany`/`belongsTo` bookkeeping. Reach for this when you already have the data and just need
  somewhere local to put it.
- **[`useStructureRestApi`](/composables/structure-rest-api)** — everything above, plus fetch
  methods that cache, deduplicate, and support optimistic mutations with automatic rollback. Reach
  for this when the data comes from a REST API — it's the composable most apps will use directly.
- **[`useStructureFormValidation`](/composables/structure-form-validation)** — reactive form
  state with optional Zod validation and a submit-flow wrapper.
- **[`useNotificationsStore`](/stores/notifications)** — toast messages and named dialog flags,
  as a Zustand store.
- **[`useCoreStore`](/stores/core)** — a global named-loading-flags store, for one loading
  indicator shared across hooks/components instead of ad-hoc local state.

Each reference page documents the full API and the gotchas that matter in practice.
