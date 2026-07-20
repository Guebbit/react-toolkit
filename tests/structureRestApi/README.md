# `useStructureRestApi` test suite

Categorized tests for `src/hooks/structureRestApi.ts` — the REST wrapper that
uses TanStack Query as its cache / freshness / revalidation engine.

## Layout

Folders classify by **subject** — never by how harshly a test asserts, nor by how a bug
was once found. A regression test for a fixed bug lives with the feature it constrains: it
states a contract, and nothing needs renaming once the bug is history.

| Folder                 | What it proves                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_helpers/`            | Shared fixtures, hook factories, fake API stubs, a stateful fake REST server, and fake-clock helpers. **Not** `*.spec.ts`, so Jest ignores them.                                         |
| `unit/`                | Direct per-function contracts — each fetch/mutate/search/loading function in isolation.                                                                                                  |
| `ttl/`                 | Freshness over time with a **fake clock**: explicit _valid_ (`<TTL`) vs _stale_ (`>TTL`) cases per method, mixed per-id staleness, mutation↔freshness interplay, and concurrency dedupe. |
| `search/`              | Filter params as cache keys (flat, array, and nested-object filters), per-page and per-pageSize buckets, server totals, and `searchCleanup` memory bounding.                             |
| `pagination/`          | Client-side (offline) paging, server-side paging (`fetchAll` per page), and `fetchPaginate`.                                                                                             |
| `modifiers/`           | The request "versions": `forced`, `loading` (internal/external/postfix/off, and ref-counting under concurrency), `merge`, `mismatch`.                                                    |
| `intention/`           | Multi-call scenarios: search-as-you-type journeys, full CRUD lifecycle vs a fake server, cross-method cache seeding, parent relations, shared client.                                    |
| `lifecycle/`           | Lifetime and memory of the client store: the `destroy()` teardown contract, and the `maxRecords` critical-mass bound.                                                                    |
| `served-value.spec.ts` | Cross-cutting: asserts the _value_ served, not merely that the network was skipped. See below.                                                                                           |

## Running

```bash
npm test                       # whole repo
npm run test:target            # just tests/structureRestApi
npx jest tests/structureRestApi/ttl   # one category
```

## Helper contracts (`_helpers/`)

- **`harness.ts`** — `makeHook<T,K>(opts?)` (tracked, 1h TTL by default),
  `makeExternalLoading()` (returns `{ c, store }`), `makeShared()` (two hook instances on one
  `QueryClient` + `loadingKey`). Every spec calls `afterEach(clearAllInstances)` to stop
  TanStack's gc timers.
- **`fakeApi.ts`** — `apiResolve`/`apiReject` (call-counting), `deferred()`/`deferredApi()`
  for concurrency & controlled latency.
- **`fakeServer.ts`** — `createServer(seed)` → stateful `list/get/many/search/create/update/remove`
  closures plus a `calls` counter, used by the intention scenarios.
- **`time.ts`** — `useFakeClock()`, `advance(ms)` (async, flushes microtasks), `restoreClock()`.

## Also know

- **The `ttl/` specs assume TanStack resolves via microtasks (no internal `setTimeout`).**
  With `retry:false` + `networkMode:'always'` that holds, so `await advance(ms)` + awaiting the
  fetch is enough. If a `ttl/*` test ever _times out_ (rather than asserting), add
  `await jest.advanceTimersByTimeAsync(0)` after the awaited fetch — it's a timing artifact, not
  a logic failure.

- **`maxRecords` is a critical-mass backstop, not a cache policy.** Records are never evicted
  for being old: stale data is what keeps a list rendered while the fresh copy downloads. A
  record is garbage only once nothing points at it, and age says nothing about that.

    Do not "fix" unbounded growth by letting the query cache evict dictionary entries. Nothing
    in the hook calls `useQuery`, so no cache entry ever has an observer, so every entry
    is gc-eligible from the moment it is written — evicting on that signal deletes items a
    component is still rendering, `gcTime` after their last fetch. Growth is bounded instead by
    `maxRecords` (a full wipe past critical mass, see `lifecycle/maxRecords.spec.ts`) and by the
    owning scope (`destroy()` / `resetAll()`, see `lifecycle/destroy.spec.ts`). `searchCached`
    applies the same idea from the other end: capped at `MAX_SEARCHES = 50` buckets rather than
    expired by age.

## Deliberate coverage choice

Most cache-hit tests assert **"the network was not called"** rather than the returned value.
`served-value.spec.ts` is the counter-weight: it asserts the actual data returned and stored, on
both cache hits and refetches. Those value-level assertions are worth promoting into the subject
suites over time, so stale/wrong cached values get caught everywhere — at which point that file
can disappear.
