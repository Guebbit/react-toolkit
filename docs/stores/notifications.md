# useNotificationsStore

A Zustand store for toast-style messages and simple named dialog visibility
flags.

## Quickstart

```ts
import { useNotificationsStore, IToastType } from '@guebbit/react-toolkit'

const notifications = useNotificationsStore()

// Show a toast that auto-hides after 4s
notifications.addMessage('Saved successfully', IToastType.SUCCESS, 4000)

// Render only the visible ones
notifications.getMessages() // IToastMessage[]

// A named dialog flag — no dedicated open/close actions, just read/write the map
notifications.dialogs.confirmDelete = true
```

## API

### Types

```ts
enum IToastType {
    PRIMARY = 'primary',
    SECONDARY = 'secondary',
    DANGER = 'error',
    WARNING = 'warning',
    SUCCESS = 'success'
}

interface IToastMessage {
    id: string
    message: string
    type: IToastType
    visible: boolean
}
```

### Messages (toasts)

| Property / method                          | Purpose                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `history`                                   | Every toast ever added, including hidden ones.                                            |
| `getMessages()`                             | Returns only `visible: true` entries from `history`.                                      |
| `addMessage(message, type?, timeout?)`      | Adds a toast. `type` defaults to `PRIMARY`. When `timeout > 0` (ms), it auto-hides via `hideMessage` after that delay; the default `-1` means it persists until hidden/removed manually. |
| `findMessage(id)`                           | Finds a toast in `history` by id.                                                        |
| `hideMessage(id)`                           | Sets `visible = false` — the toast stays in `history`.                                   |
| `showMessage(id)`                           | Sets `visible = true`.                                                                    |
| `removeMessage(id)`                         | Permanently removes a toast from `history`.                                              |

### Dialogs

| Property   | Purpose                                                                          |
| ------------ | --------------------------------------------------------------------------------------- |
| `dialogs`   | `Record<string, boolean>` for arbitrary named dialog open/closed state. No dedicated actions; consumers read/write `dialogs[name]` directly. |

## Gotchas

- **`history` grows unbounded unless you call `removeMessage`.** `hideMessage` only toggles
  visibility — it doesn't free anything. If you want toasts to actually disappear from memory
  after they're dismissed, call `removeMessage(id)` (you can do this in the same `setTimeout` you'd
  otherwise use for auto-hide, or right after `hideMessage`).
- **`addMessage`'s `timeout` default is `-1`** (persist forever) — pass a positive number
  explicitly for auto-dismissing toasts.
