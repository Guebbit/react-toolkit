# useStructureCrudApi

A whole resource — list, filtered search, read, create, update, delete — from the API calls that
reach it. The highest-level entry point in the toolkit, and the one to start from.

This is [`useStructureSearchApi`](./structure-search-api) with the wiring already done. That
wiring is not difficult, but it is _identical for every resource in an app_, so writing it per
resource means each hook is a few hundred lines that differ only in which endpoint each one
calls — and a fix to any of it has to be made in every one of them.

## Quickstart

```ts
import { useStructureCrudApi } from '@guebbit/react-toolkit'

interface IProductFilters {
    text?: string
    minPrice?: number
}

export const useProducts = () =>
    useStructureCrudApi<IProduct, string, IProductFilters>(
        {
            list: () => listProducts().then((r) => r.data.items),
            search: (filters, page, pageSize) =>
                listProducts({ ...filters, page, pageSize }).then((r) => r.data.items),
            get: (id) => getProductById(id).then((r) => r.data),
            create: (data, options) => createProduct(data, options).then((r) => r.data),
            update: (id, data, options) => updateProductById(id, data, options).then((r) => r.data),
            remove: (id) => deleteProductById(id)
        },
        { identifiers: 'id' }
    )
```

A list screen:

```tsx
const api = useProducts()
useWatchList(api, { onError: notifyError })

return (
    <>
        <input
            value={api.filters.text ?? ''}
            onChange={(event) => api.setFilters({ text: event.target.value })}
            onKeyUp={(event) => event.key === 'Enter' && void api.searchNow()}
        />
        <button onClick={() => void api.searchNow()}>Search</button>
        <button onClick={() => void api.resetFilters()}>Reset</button>

        {api.pageItemList.map((item) => item && <ProductRow key={item.id} item={item} />)}
        <Pagination page={api.pageCurrent} total={api.pageTotal} onChange={api.setPageCurrent} />
    </>
)
```

And a detail screen:

```tsx
const { id } = useParams()
const api = useProducts()
useWatchOne(api, id)

return <ProductForm record={api.selectedRecord} onSave={(data) => api.updateOne(id, data)} />
```

## Nothing is given up

Everything `useStructureSearchApi` returns is passed straight through, and everything _it_ is
built on with it. `itemDictionary`, `selectedRecord`, `pageCurrent`, `fetchTarget`,
`fetchByParent`, `searchGet`, `resetAll` — all still there.

So this layer is a convenience, never a ceiling. When a resource needs something it does not
cover, reach past it for that one call rather than abandoning it:

```ts
// this layer for the ordinary 95%…
await api.fetchList()
// …and the layer underneath for the rest
await api.fetchByParent(() => listOrderItems(orderId).then((r) => r.data.items), orderId)
```

## The reactive half is two hooks

`useWatchList` and `useWatchOne` are hooks, not methods on the returned object, for exactly the
reason [`useWatchSearch`](./structure-search-api) and `useWatchTarget` are: only a value React
re-renders on can drive a `useEffect`, and a method reading a mutable ref would have to poll to
notice a change. Both are thin — they are the resource's own `search`/`get` operation already
wired into the hook underneath.

```ts
const api = useStructureCrudApi<IProduct, string, IProductFilters>(operations, { identifiers: 'id' })

// runs now, and again on every pageCurrent/pageSize change
const { search } = useWatchList(api, { onError: notifyError })

// selects and (re)fetches whenever `id` changes; a nullish id is a no-op
useWatchOne(api, id)
```

**Pass `onError` to `useWatchList`.** It runs inside an effect, so a rejection is otherwise
swallowed.

## Operations

Each operation is a plain function returning a promise of records — you unwrap your HTTP client's
envelope inside it. That is the _entire_ integration surface: no client, no interceptor and no
response shape is assumed anywhere in this hook.

| Operation         | Signature                                             | Powers                                                    |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| `list`            | `(options?) => Promise<T[]>`                          | `fetchList`                                                |
| `search`          | `(filters, page, pageSize, options?) => Promise<T[]>` | `useWatchList`, `searchNow`, `resetFilters`, `fetchPage`   |
| `get`             | `(id, options?) => Promise<T>`                        | `fetchOne`, `useWatchOne`                                  |
| `create`          | `(data, options?) => Promise<T>`                      | `createOne`                                                |
| `update`          | `(id, data, options?) => Promise<T>`                  | `updateOne`                                                |
| `remove`          | `(id, options?) => Promise<unknown>`                  | `deleteOne`                                                |
| `optimisticPatch` | `(data) => Partial<T>`                                | what `updateOne` writes locally                            |

**All of them are optional.** A read-only resource supplies `list` and `get` and nothing else;
the methods with no counterpart return a rejected promise naming the missing operation, rather
than failing deeper down with a less obvious message.

The `options` parameter is yours — it is forwarded untouched from `createOne`/`updateOne`/
`deleteOne` to the operation, which is how per-call axios config (`onUploadProgress`, `signal`)
reaches a request without any call site reaching for the HTTP client directly.

### `optimisticPatch`

`updateOne` applies your payload to the local record before the server answers, and rolls it back
if the request fails. Usually the payload _is_ a partial record and there is nothing to configure.

Override it when the two differ. The case that forces it to exist is a multipart form, whose
payload carries a `File` the record has no business holding — the server answers with a URL, and
parking a `Blob` in store state until it does is nonsense:

```ts
optimisticPatch: ({ imageUpload, ...fields }) => fields
```

## Filters, and when a search actually runs

`filters` is owned here, and the search reads it. That is deliberate: this hook is the source
`pageItemList` is scoped to, so there is no way for the filters driving the search and the filters
scoping the visible page to be two different objects.

It is backed by a ref as well as state, so `setFilters(...)` is visible to a `searchNow()` in the
same handler — the Search button is never one edit behind:

```ts
const submit = () => {
    api.setFilters({ text: query })
    void api.searchNow()
}
```

Editing `filters` does **not** search on its own — whether a filter edit searches as-you-type or
on submit is a decision about the screen, not about the resource. `useWatchList` re-runs on page
changes only; `searchNow()` applies edited filters on demand.

`searchNow()` resets to page 1 first, and that is the point of it existing: `useWatchList`'s
effect fires on a page _change_, so a user already on page 1 would otherwise edit the filters,
press Search and see nothing happen.

`resetFilters()` restores `initialFilters` (not necessarily `{}`) and searches again, **forced** —
Reset is a request for the truth, and answering it out of the cache that produced the state being
reset is precisely what it does not mean.

For as-you-type search, debounce it yourself and call `searchNow()`.

## API

`useStructureCrudApi<T, K, F, C, U, O, P>(operations?, settings?)`

`settings` is everything [`useStructureRestApi`](./structure-rest-api) accepts (`identifiers`,
`TTL`, `loadingKey`, `getLoading`/`setLoading`, `maxRecords`, `queryClient`, …) plus:

| Option           | Type | Purpose                                                                          |
| ---------------- | ---- | -------------------------------------------------------------------------------- |
| `initialFilters` | `F`  | Starting value of `filters`, and what `resetFilters()` returns to. Default `{}`. |

Everything `useStructureSearchApi` returns, plus:

| Property / method                      | Purpose                                                          |
| -------------------------------------- | ---------------------------------------------------------------- |
| `filters`                              | The current search filters. Read by the search; never watched by it. |
| `setFilters(next \| updater)`          | Replaces them, by value or by updater.                            |
| `fetchList(settings?)`                 | Every record, unpaginated.                                        |
| `fetchPage(page, pageSize, settings?)` | One unfiltered page, without touching the shared search state.    |
| `searchNow(settings?)`                 | Applies the current filters from page one.                        |
| `resetFilters(settings?)`              | Back to `initialFilters`, forced, from page one.                  |
| `fetchOne(id, settings?)`              | One record, selected as the current one.                          |
| `createOne(data, options?)`            | Creates and stores.                                               |
| `updateOne(id, data, options?)`        | Updates optimistically, rolling back on failure.                  |
| `deleteOne(id, options?)`              | Deletes and drops from the dictionary.                            |
| `runSearch` / `runGet`                 | The operations `useWatchList` / `useWatchOne` drive. Not usually called directly. |

`useWatchList(api, settings?)` → `{ search }` — settings are `immediate` (default `true`),
`onSuccess`/`onError`/`onSettled`, plus anything forwarded to `fetchSearch`.

`useWatchOne(api, id, settings?)` → `void` — settings are forwarded to `fetchTarget`, plus
`onSuccess`/`onError`/`onSettled`.

## Gotchas

- **`fetchOne` selects; `fetchTarget` does not.** `fetchOne` sets `selectedIdentifier` up front
  and undoes it if the fetch fails, so a record already in the dictionary renders immediately
  instead of blanking the page. Use the underlying `fetchTarget` when you want a record loaded
  _without_ making it the current one.
- **`pageTotal` is computed from the local dictionary.** For server-side pagination, read the
  server's total out of your own `search` operation and keep it in your own state — see
  [`useStructureSearchApi`](./structure-search-api).
- **A missing operation fails at call time, not at setup.** Supplying `{}` is legal, and the error
  arrives when something calls a method that needed one.
- **`operations` is read through a ref**, so declaring it inline is fine and does not destabilise
  any of the returned methods.
