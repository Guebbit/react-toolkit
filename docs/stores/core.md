# useCoreStore

A small Zustand store for global named loading flags — one place to track "is
anything loading" across composables and components, instead of ad-hoc local refs per screen.

## Quickstart

```ts
import { useCoreStore } from '@guebbit/react-toolkit'

const core = useCoreStore()

core.setLoading('users:fetch', true)
core.getLoading('users:fetch') // true
core.isLoading // true — at least one key is active

core.setLoading('users:fetch', false)
core.isLoading // false
```

This is the same shape `useStructureRestApi` expects if you wire it to an external loading store
via its `getLoading`/`setLoading` options — see
[Setup options](/composables/structure-rest-api#setup-options).

## API

| Property / method            | Purpose                                              |
| -------------------------------- | ----------------------------------------------------------- |
| `loadings`                     | `Record<string, boolean>` of every tracked key.         |
| `isLoading`                    | `true` when at least one key is `true`.                |
| `setLoading(key, value)`       | Sets one key's loading state.                          |
| `getLoading(key)`              | Reads one key's loading state.                         |
| `resetLoadings()`              | Clears every tracked key.                               |
