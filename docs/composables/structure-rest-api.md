# useStructureRestApi

The REST layer. Wraps [`useStructureDataManagement`](/composables/structure-data-management) and
adds fetch/mutate methods backed by a [TanStack Query](https://tanstack.com/query) `QueryClient`:
caching, request de-duplication, staleness (TTL), and optimistic mutations with automatic
rollback on failure.

The pattern throughout: you pass in your own already-parameterized fetch closure (an
`() => Promise<...>` wrapping `axios`/`fetch`/whatever you use), and the composable handles
caching, loading state, and store sync around it. It never assumes an HTTP client.

## Quickstart

```ts
import { useStructureRestApi } from '@guebbit/react-toolkit'
import axios from 'axios'

interface IUser {
    id: number
    name: string
    email: string
}

const users = useStructureRestApi<IUser, number>({ identifiers: 'id' })

// Load the list — cached for `TTL` ms (default 1h) and deduplicated across callers
await users.fetchAll(() => axios.get('/api/users').then((r) => r.data))

// Render straight from the store
users.itemList // IUser[]
users.getRecord(1) // IUser | undefined
users.loading // true while any request is in flight

// Update — the UI updates immediately (optimistic) and rolls back automatically
// if the request rejects. No cache invalidation to write by hand: the item's
// cache entry is reseeded from the response.
await users.updateTarget(
    () => axios.put('/api/users/1', { name: 'New name' }).then((r) => r.data),
    { name: 'New name' },
    1
)
```

Opening the same user's detail view afterwards (`fetchTarget(apiCall, 1)`) is a cache hit — no
extra request — because `fetchAll` and `updateTarget` both seed the per-item cache entry as they
go.

## Setup options

Passed to `useStructureRestApi<T, K, P>(options)`:

| Option         | Default                | Purpose                                                                               |
| -------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `identifiers`  | `'id'`                  | Field name (or array, for composite keys) used to key records.                       |
| `loadingKey`   | random                  | Key used for loading state and to namespace this instance's query cache entries.      |
| `TTL`          | `3_600_000` (1h)        | Default staleTime, in ms, for all fetch methods. Overridable per call.                |
| `maxRecords`   | `100_000`               | Critical-mass backstop on the store size — see [Gotchas](#gotchas). `0` disables it.  |
| `delimiter`    | `'|'`                   | Joins composite identifier parts into a single dictionary key.                       |
| `getLoading` / `setLoading` | —         | Wire loading state into an external store instead of the composable's internal one.  |
| `queryClient`  | new internal instance   | Provide an external `QueryClient` to share cache/loading across composable instances. |

## API

### Fetching

| Method                                                    | Purpose                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `fetchAny(apiCall, settings?)`                          | Generic fetch — loading + optional caching, for calls that don't fit the other shapes.      |
| `fetchAll(apiCall, settings?)`                             | Fetch and cache a full list.                                                                 |
| `fetchByParent(apiCall, parentId, settings?)`              | Like `fetchAll`, scoped to a `belongsTo` parent; updates `parentHasMany`.                     |
| `fetchTarget(apiCall, id?, settings?)`                     | Fetch a single item; per-item freshness tracking.                                            |
| `fetchMultiple(apiCall, ids?, settings?)`                  | Fetch several ids in one call, but only the stale ones — fresh ids are served from cache.    |
| `fetchSearch(apiCall, filters?, page?, pageSize?, settings?)` | Fetch a filtered, paginated page. `apiCall` may resolve a plain array or a `[items, total]` tuple. |
| `fetchPaginate(apiCall, page?, pageSize?, settings?)`      | `fetchSearch` with no filters — server pagination.                                          |

### Mutating

| Method                                                              | Purpose                                                                              |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `createTarget(apiCall, dummyData?, settings?)`                      | Optionally shows `dummyData` immediately under a temporary id, then swaps in the real record on success; rolls back on failure. `settings.fetchLike` (default `true`) controls whether the target cache is seeded. |
| `updateTarget(apiCall, itemData, id?, settings?)`                   | Optimistic merge into the record, confirmed/rolled back by the request outcome. `settings.fetchLike`/`settings.fetchAgain` (both default `true`) control target-cache seeding and whether the response replaces the record. |
| `deleteTarget(apiCall, id, settings?)`                              | Optimistic delete; restores the record if the request fails.                        |
| `saveRecords(items, merge?, onSave?)`                               | Lower-level: writes a batch of items into the store (used internally by every fetch method; rarely called directly). |

### Search cache

| Method / property                          | Purpose                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `searchGet(filters, page?, pageSize?)`      | Read back the stored items for a given (filters, page, pageSize).      |
| `searchGetTotal(filters, pageSize?)`        | Server-reported total for a search, if the API returned the tuple shape. |
| `searchSetTotal(filters, total, pageSize?)` | Set the total manually (e.g. it came from a separate call).            |
| `searchKeyGen(object)`                      | The stable cache-key serializer `fetchSearch` uses internally — exposed for advanced use. |
| `searchCleanup()`                           | Prunes stale/excess search buckets. Called automatically by `fetchSearch`. |
| `searchCached` / `searchTotals`             | Raw refs backing the above, exposed for inspection.                    |

### Loading

| Property / method              | Purpose                                                    |
| --------------------------------- | -------------------------------------------------------------- |
| `loading`                      | Computed — true while anything tracked under `loadingKey` is in flight. |
| `startLoading(postfix?)` / `stopLoading(postfix?)` | Manual, ref-counted loading control, if you need it outside a fetch call. |

### Lifecycle

| Property / method   | Purpose                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `queryClient`        | The underlying TanStack `QueryClient` — exposed for direct inspection or manual teardown.        |
| `destroy()`          | Clears the query cache and resets the store. Call it from your React cleanup when you manually manage a long-lived instance. |
| `resetRecords()`     | Empties the item dictionary (inherited).                                                          |
| `resetSearches()`    | Empties `searchCached`/`searchTotals` without touching records or the query cache.                |
| `resetAll()`         | `resetRecords()` + `resetSearches()` + clears parent relations — does **not** touch the query cache. |

### Inherited from `useStructureDataManagement`

Everything documented on the [`useStructureDataManagement`](/composables/structure-data-management)
page — `itemDictionary`, `itemList`, `getRecord`, `getRecords`, `addRecord`, `addRecords`,
`editRecord`, `deleteRecord`, `selectedIdentifier`/`selectedRecord`, `lastInsertedIdentifier(s)`/
`lastInsertedRecord`, client pagination (`pageCurrent`, `pageSize`, `pageTotal`, `pageOffset`,
`pageItemList`), and parent relations (`parentHasMany`, `addToParent`, `removeFromParent`,
`removeDuplicateChildren`, `getRecordsByParent`, `getListByParent`) are all available directly on
the object `useStructureRestApi` returns.

## Fetch settings

Every fetch/mutate method accepts a trailing settings object (`IFetchSettings`):

| Option          | Default | Purpose                                                                                       |
| ------------------ | --------- | -------------------------------------------------------------------------------------------------- |
| `forced`         | `false` | Bypass the cache and always hit the network.                                                  |
| `loading`        | `true`  | Whether this call participates in `loading`/`startLoading`/`stopLoading`.                     |
| `merge`          | `false` | Merge fetched fields into existing records instead of replacing them wholesale.               |
| `TTL`            | instance TTL | Per-call staleTime override.                                                             |
| `lastUpdateKey`  | `''`    | Extra cache-key segment — use it to give independent cache buckets to otherwise-identical calls (e.g. one per server-side page variant). |
| `loadingKey`     | instance loadingKey | Override which loading key this call reports to.                                 |
| `mismatch`       | `false` | Skip reseeding the per-item target cache — use when a fetch returns partial fields that shouldn't be mistaken for a full record. |
| `fetchLike`      | `true`  | `createTarget`/`updateTarget` only — seed the per-item target cache as if the record had just been fetched. |
| `fetchAgain`     | `true`  | `updateTarget` only — apply the request's response as the record's new data. Turn off if the response isn't the full updated item. |

## Gotchas

- **`maxRecords` is a critical-mass backstop, not a cache policy.** Records are never evicted for
  being old — stale data is what keeps a list on screen while a fresh copy downloads. Past
  `maxRecords`, the *entire* store is wiped and immediately repopulated with the incoming batch.
  Harmless for server-paginated UIs; visible for infinite-scroll UIs that render `itemList`
  directly (the list collapses to the last batch). Set it to `0` and prune manually if that
  matters to you.
- **Two caches, two jobs.** `itemDictionary` (from `useStructureDataManagement`) owns *what to
  render* — it's synchronous, reactive, and never evicted on a timer. The TanStack `queryClient`
  owns *when to fetch* — staleness, in-flight dedup, retries. A query-cache entry expiring only
  means "we forgot this was fresh"; it never deletes the item itself. This split is what gives
  stale-while-revalidate behavior for free: an expired item keeps rendering the old value for the
  whole flight of the refetch.
- **`mismatch: true`** when a fetch call returns partial fields (e.g. a list endpoint that omits
  some detail-only fields) that shouldn't overwrite a fuller cached record's freshness.
- **`destroy()`** is explicit in React. If you create a long-lived instance outside normal component
  teardown, call `destroy()` yourself in your cleanup path.
