# useUploadProgress

Progress state for one upload, and the wrapper that drives it — a percentage while the request
runs, idle however it ends, and nothing at all when there is no file to watch.

## Why it exists

Every form that submits a file makes the same three decisions:

- report progress only when there is something to report,
- surface the percentage while the request is in flight,
- return to idle on success, on failure and on cancellation alike.

None of them are hard. All of them are easy to get subtly wrong, and a form that gets the third
one wrong leaves a progress bar stuck at 60% forever after a failed request. So the view says what
to send, and this says how to watch it.

## Quickstart

The hook has no HTTP client of its own. You give it one function that turns a progress sink into
your client's per-call options, and it never has to know what that client is:

```ts
import { useUploadProgress } from '@guebbit/react-toolkit'
import type { AxiosRequestConfig, AxiosProgressEvent } from 'axios'

/**
 * Written once per app, next to the HTTP client.
 */
export const useAxiosUploadProgress = () =>
    useUploadProgress<AxiosRequestConfig>((onProgress) => ({
        onUploadProgress: (event: AxiosProgressEvent) => onProgress(event.progress ?? 0)
    }))
```

Then, in a form:

```tsx
const { progress, isUploading, track } = useAxiosUploadProgress()

const submit = () =>
    track((options) => updateProduct(id, { ...fields, imageUpload: file }, options), {
        enabled: !!file
    })

return isUploading ? <progress max={100} value={progress} /> : null
```

`track` forwards whatever `send` produced, untouched — a rejection stays a rejection with its
original reason, so your existing `.catch` keeps working.

## `undefined` is not `0`

`progress` is `undefined` while idle and `0–100` during a request. Those are different states and
components should treat them as such:

- `undefined` — no upload is happening. Hide the bar.
- `0` — an upload has started and nothing has gone out yet. Show the bar, empty.

`isUploading` is the readable form of that distinction (`progress !== undefined`); prefer it over
`progress && …`, which also hides the bar at exactly 0%.

Tracking starts at `0` the moment the request is in flight, not when the first progress event
arrives — on a fast connection the first event and the last are the same event, and a bar that
waits for it never appears at all.

Both `progress` and `isUploading` are exposed as getters over a ref, so a burst of progress events
inside a single tick is readable immediately rather than one render behind. The underlying state
still drives the re-render, so a bound component repaints as normal.

## `enabled`, and the form whose file is optional

This is the option worth understanding. On a form where the image is optional, a plain field edit
sends a payload measured in bytes: it completes instantly, and a bar that flashes to 100% for it
reads as a glitch rather than as feedback.

```ts
track(send, { enabled: !!file })
```

Disabled, `send` is called with **no options at all** and the state never leaves idle — so your
client is not handed a progress callback it would fire once, pointlessly, at 100%.

## The reported value is a fraction

`onProgress` takes a **0–1 fraction**, not a percentage, because that is what HTTP clients hand
out (axios' `event.progress`, `XMLHttpRequest`'s `loaded / total`). Converting once, inside the
hook, is what stops each call site from picking its own scale.

The value is clamped before it is stored. A client reporting `loaded` against a stale or absent
`total` can produce fractions above 1, and a bar rendered from `width: 137%` breaks the layout
rather than merely looking wrong.

When the total size is unknown — a chunked or compressed request — axios omits `progress`
entirely. Report `0` in that case (as the adapter above does) so the bar stays still rather than
jumping around on a number that means nothing.

## API

`useUploadProgress<TOptions>(buildOptions)`

| Parameter      | Type                                                   | Purpose                                                            |
| -------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| `buildOptions` | `(onProgress: (fraction: number) => void) => TOptions` | Builds your HTTP client's per-call options from the progress sink. |

| Property / method        | Purpose                                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress`               | `0–100` while tracking, `undefined` while idle.                                                                                                                                                |
| `isUploading`            | `true` while an upload is being tracked.                                                                                                                                                       |
| `report(fraction)`       | Records progress from a 0–1 fraction, clamped. For clients you drive yourself.                                                                                                                 |
| `reset()`                | Returns to idle.                                                                                                                                                                                |
| `track(send, settings?)` | Runs `send(options)` with tracking attached, returning to idle however it ends. `settings.enabled` (default `true`) turns tracking off for this call, in which case `send` receives no options. |

## Gotchas

- **It tracks one upload at a time.** Two concurrent `track` calls share the same `progress`, and
  the first to settle returns it to idle while the second is still running. For a multi-file
  uploader with a bar per file, call the hook once per file.
- **`buildOptions` is read through a ref**, so an inline arrow is fine — `track` stays stable
  across renders and is safe as a `useEffect` dependency.
- **It does not validate anything.** Accepted types and size limits are a separate concern, and
  checking them client-side is a UX affordance rather than a control — the server has to enforce
  them regardless.
