# useStructureFormValidation

Reactive form state with optional [Zod](https://zod.dev) schema validation and a submit-flow
wrapper (validate, then call your handler, tracking `isSubmitting` around it).

## Quickstart

```ts
import { z } from 'zod'
import { useStructureFormValidation } from '@guebbit/react-toolkit'

interface ILoginForm {
    email: string
    password: string
}

const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters')
})

const login = useStructureFormValidation<ILoginForm>({ email: '', password: '' }, loginSchema)

login.setForm({ email: 'jane@example.com', password: 'hunter22' })

await login.handleSubmit(async (data) => {
    // data is typed as ILoginForm, and already validated against loginSchema
    await api.post('/login', data)
})
```

`handleSubmit` validates first and skips calling your handler if validation fails — check the
return value (`true`/`false`) or read `login.formErrors` / `login.isValid` to drive
the UI.

## API

`useStructureFormValidation<T>(initialData: T = {}, schema?: ZodType<T>)` — `schema` is optional;
without one, `validate()` always passes.

| Property / method                      | Purpose                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `form`                                   | Current form data. Initialized as a shallow copy of `initialData`.                              |
| `formErrors`                             | `Partial<Record<keyof T, string[]>>`, per-field error messages.                                 |
| `isSubmitting`                           | `true` while `handleSubmit`'s handler is running.                                                |
| `isValid`                                | Computed — `true` when `formErrors` has no keys.                                                |
| `isDirty`                                | Computed — `true` when `form` differs from `initialData` (compared via `JSON.stringify`).       |
| `setForm(data)`                          | Shallow-merges partial data into `form`.                                                        |
| `resetForm()`                            | Restores `form` to `initialData` and clears `formErrors`.                                       |
| `clearErrors()`                          | Clears all `formErrors`.                                                                         |
| `setFieldError(field, errors)`           | Sets error message(s) for one field — accepts a string or a string array.                       |
| `clearFieldError(field)`                 | Removes errors for one field.                                                                    |
| `validate()`                             | Runs `schema.safeParse(form)`, populates `formErrors` on failure, returns a boolean.             |
| `handleSubmit(onSubmit, withValidation?)`| Validates (unless `withValidation` is `false`), then awaits `onSubmit(form)` with `isSubmitting` set around it. Returns `true` on success, `false` on validation failure. |

## Gotchas

- **`handleSubmit` doesn't catch errors from your handler.** Only `isSubmitting` is guaranteed to
  be reset (in a `finally`) — if `onSubmit` throws or rejects, the promise from `handleSubmit`
  rejects too. Wrap the call in your own `try`/`catch` if you need to handle submit failures.
- **Zod error grouping is top-level only.** Each issue is filed under `issue.path[0]` — a nested
  field like `address.city` collapses to the `address` key in `formErrors`, not
  `formErrors.address.city`. Fine for flat forms; for nested schemas you'll need to read
  `issue.path` yourself if you want per-nested-field messages.
- **`isDirty` is a `JSON.stringify` comparison** — it won't handle key-order-insensitive equality
  or non-serializable values (functions, `Date` instances, etc.) specially.
