# useCoreStore

A small Zustand store for global named loading flags — one place to track "is
anything loading" across hooks and components, instead of ad-hoc local state per screen.

## Quickstart

```ts
import { useCoreStore } from '@guebbit/react-toolkit'

const { setLoading, getLoading, isLoading } = useCoreStore.getState()

setLoading('accountProfile', true)
getLoading('accountProfile') // true
isLoading() // true — at least one key is active
isLoading(['cart']) // false — nothing under that prefix is

setLoading('accountProfile', false)
isLoading() // false
```

This is the same shape `useStructureRestApi` expects if you wire it to an external loading store
via its `getLoading`/`setLoading` options — see
[Setup options](/composables/structure-rest-api#setup-options).

## Scoping with prefixes

`isLoading()` with no argument is "is the app doing literally anything", which is rarely what a
screen wants to render: a background poll lights the same indicator as a user's save. Pass
prefixes to ask a narrower question.

Give each store a stable `loadingKey` and each call its action postfix, and the dictionary's keys
become addressable:

```ts
// in the store
useStructureRestApi<User, string>({ loadingKey: 'accountProfile', getLoading, setLoading })
// at the call site
updateProfile(payload, { loadingKey: ':avatar-upload' }) // -> 'accountProfile:avatar-upload'
```

```ts
// one global overlay, one discreet indicator, one button spinner — same dictionary
const isBootLoading = useCoreStore((state) => state.isLoading(['core']))
const isSideLoading = useCoreStore((state) => state.isLoading(['account', 'cart', 'orders']))
const isUploading = useCoreStore((state) => state.getLoading('accountProfile:avatar-upload'))
```

Read it through a selector, as above: the selector returns a boolean, so the component re-renders
on the answer changing rather than on every unrelated key in the dictionary.

A prefix matches from the start of the key, so `'account'` covers every store and action under
it. Keep that in mind when naming: a future `accounting` store would answer to `'account'` too.

## API

| Property / method            | Purpose                                              |
| -------------------------------- | ----------------------------------------------------------- |
| `loadings`                     | `Record<string, boolean>` of every tracked key.         |
| `isLoading(prefixes?)`         | `true` when a key is active; scoped to keys starting with one of `prefixes`, or any key when omitted. |
| `setLoading(key, value)`       | Sets one key's loading state.                          |
| `getLoading(key)`              | Reads one key's loading state.                         |
| `resetLoadings()`              | Clears every tracked key.                               |
