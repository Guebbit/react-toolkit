# useStructureSearchApi

Filtered, paginated search on top of [`useStructureRestApi`](./structure-rest-api). Adds a
page-cache keyed by the filters that produced each page, and a companion hook that re-runs the
search when the page changes.

It **is** a `useStructureRestApi` — it creates one internally and spreads everything it returns,
so `fetchTarget`, `createTarget`, `itemDictionary` and the rest are all still there. You do not
compose the two; you use this one instead.

For most resources, reach for [`useStructureCrudApi`](./structure-crud-api) instead: it is this
hook with the wiring below already done.

## Quickstart

```tsx
import { useStructureSearchApi, useWatchSearch } from '@guebbit/react-toolkit'

interface IProductFilters {
    text?: string
    minPrice?: number
}

const ProductList = () => {
    const [filters, setFilters] = useState<IProductFilters>({})

    const api = useStructureSearchApi<IProduct, string, string, IProductFilters>(
        () => filters,
        { identifiers: 'id' }
    )

    const { search } = useWatchSearch(api, (currentFilters, page, pageSize) =>
        listProducts({ ...currentFilters, page, pageSize }).then((r) => r.data.items)
    )

    return (
        <>
            {api.pageItemList.map((item) => item && <ProductRow key={item.id} item={item} />)}
            <Pagination page={api.pageCurrent} total={api.pageTotal} onChange={api.setPageCurrent} />
        </>
    )
}
```

Changing `pageCurrent` or `pageSize` re-runs the search on its own. Changing `filters` does not —
see below.

`filtersSource` accepts a plain value or a getter. Prefer the getter when the filters live
somewhere React does not re-render on (a ref, an external store): it is read fresh on every
search and by `pageItemList`, so a value that changed without a render is still seen.

## Filters are read, not watched

This is the one thing to understand about this hook, and it is deliberate.

`useWatchSearch` watches `pageCurrent` and `pageSize`. It **reads** your filters at the moment a
search runs, and never watches them, because "when should a filter edit trigger a search" is a UI
decision the toolkit has no business making: as-you-type and on-submit are both correct, for
different screens.

So a filter change takes effect the next time a search runs. Usually you want that to be now, from
a submit handler — and usually you want to go back to page 1 while you are at it:

```ts
const applyFilters = () => {
    api.setPageCurrent(1)
    return search(true)
}
```

`search()` exists precisely for the case the effect cannot cover: the user was already on page 1,
so `pageCurrent` did not change and nothing fired.

For as-you-type search, debounce the filter edit yourself and call `search()`.

## `pageItemList` is the current search's page

`useStructureRestApi.pageItemList` is a slice of the whole local dictionary — correct when the
dictionary holds exactly one list, wrong as soon as two searches share it. This hook overrides it
to mean _the items that answered the current filters, on the current page_.

It is exposed as a getter rather than a memo, because `filtersSource` may read storage React does
not re-render on. Anything re-exporting this hook by spreading it must redeclare that getter, or
the spread freezes it at the value it had on that render — which is exactly what
[`useStructureCrudApi`](./structure-crud-api) does with both `pageItemList` and `loading`.

Which is also why the `filtersSource` you pass to the hook and the one your search runs against
must be the same source. `useWatchSearch` reads the api's own `getFilters` for that reason: it
cannot be handed a different one by accident.

The item **data** lives in the shared dictionary, as always. What is cached per search is only the
list of ids that answered it, keyed by `(filters, pageSize)` and then by page number.

## Server-reported totals

Not this hook's concern, on purpose. `apiCall` resolves with plain items; if your API also reports
a total, read it out of your own response and keep it in your own state:

```ts
const [total, setTotal] = useState(0)

const { search } = useWatchSearch(api, (filters, page, pageSize) =>
    listProducts({ ...filters, page, pageSize }).then((response) => {
        setTotal(response.data.total)
        return response.data.items
    })
)
```

Note that the inherited `pageTotal` is computed from the **local dictionary** size, not from a
server total, so it is only meaningful for a fully-local list. For server-side pagination, derive
your own from the total above.

## Cache bookkeeping

Each search's pages are cached under a key built from its filters (canonicalized, so key order
never matters) plus `pageSize`. `fetchSearch` prunes before every search: a cached search whose
underlying TanStack entries have all expired is dropped, and at most 50 searches are kept.

Same principle as `useStructureRestApi`'s `maxRecords` — a bound on absurd growth, not an expiry
policy. Nothing is dropped for being old, because stale ids still render a list while the fresh
copy downloads.

`resetAll()` and `destroy()` clear both halves — the inherited item dictionary and query cache,
plus this hook's search index — so one call tears down the whole store.

## API

`useStructureSearchApi<T, K, P, F>(filtersSource, settings?)`

| Parameter       | Type                  | Purpose                                                                                                                     |
| --------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `filtersSource` | `F \| (() => F)`      | The current filters, or a getter producing them. Read on each search, and by `pageItemList`.                                |
| `settings`      | `IStructureRestApi`   | Forwarded verbatim to the internal `useStructureRestApi` (`identifiers`, `TTL`, `loadingKey`, `getLoading`/`setLoading`, …). |

Everything `useStructureRestApi` returns, plus:

| Property / method                                          | Purpose                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pageItemList`                                             | **Overridden** — items of the current search's current page.                                        |
| `getFilters()`                                             | The filters this instance is bound to, read fresh.                                                  |
| `fetchSearch(apiCall, filters, page, pageSize, settings?)` | One page of one search, imperatively.                                                               |
| `checkSearch(filters, page, pageSize, settings?)`          | Would that call be served from cache?                                                               |
| `isPageCached(settings?)`                                  | `checkSearch` for the current filters/page/pageSize.                                                |
| `isPaginateCached(settings?)`                              | The same question for `fetchPaginate` (no filters).                                                 |
| `searchGet(key, page, pageSize)`                           | Cached items for a search, without fetching. `key` is a filters object or a `searchKeyGen` string.  |
| `searchKeyGen(object)`                                     | The stable, canonicalized key a filters object maps to.                                             |
| `searchCached`                                             | The raw `filters → page → ids` index.                                                               |
| `searchCleanup()`                                          | Prunes dead searches. Called for you before each `fetchSearch`.                                     |
| `resetSearches()`                                          | Drops the search index only, leaving items and query cache alone.                                   |
| `resetAll()` / `destroy(forced?)`                          | **Overridden** — the inherited teardown, plus the search index.                                      |

`useWatchSearch(api, apiCall, settings?)` → `{ search }`

A hook, not a method, for the same reason `useWatchTarget` is: only a value React re-renders on
can drive the `useEffect` that watches `pageCurrent`/`pageSize`. It cleans up on unmount by
itself — there is no stop handle to wire up. `settings` takes `immediate` (default `true`),
`onSuccess`, `onError`, `onSettled`, plus any `IFetchSettings`.

## Gotchas

- **`onError` is not optional in practice.** `useWatchSearch` runs its search inside an effect, so
  an unhandled rejection is swallowed exactly as any other effect callback's would be. Pass
  `onError` or your failed searches are silent.
- **`pageSize` is part of the cache key.** The same filters at a different page size are a
  different search, with its own pages. That is correct — page 2 of 10 is not page 2 of 25 — but
  it does mean changing page size discards nothing and re-fetches everything.
- **`pageTotal` is inherited, and local.** See above: derive your own from the server's total for
  server-side pagination.
