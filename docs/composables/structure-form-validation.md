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

## Translated messages, and errors already on screen

Two separate problems, and it is worth being clear about which is which.

**The next validation's language** is a schema concern. `schema` accepts a plain schema or a
factory, and it is resolved inside `validate()` and nowhere else — so a plain schema whose
messages are *thunks* is resolved exactly as late as a factory would be:

```ts
const loginSchema = z.object({
    email: z.string().email({ error: () => t('login.email-invalid') })
})

const login = useStructureFormValidation<ILoginForm>({ email: '', password: '' }, loginSchema)
```

Prefer this over `() => createLoginSchema(t)`. A factory that is accidentally *called* at the call
site — `createLoginSchema(t)` instead of `() => createLoginSchema(t)` — type-checks, runs, and
silently freezes the language; a thunk inside the schema module has no call site to get wrong.

**Errors already on screen** are not a schema concern at all. `validate()` copies resolved
*strings* into `formErrors`; once it has returned, those strings are inert text and the schema is
out of the picture. Switching language re-renders the labels and leaves the error under them in
the old language until the next keystroke or submit. `revalidateOn` fixes that by re-running
`validate()` over the unchanged data:

```ts
const { i18n } = useTranslation()

const login = useStructureFormValidation<ILoginForm>({ email: '', password: '' }, loginSchema, {
    revalidateOn: [i18n.language]
})
```

It never runs on mount, and only fires for a form that currently has errors showing, so a pristine
form does not sprout red text because someone changed the language. `revalidateOn` is an ordinary
React dependency array — keep its length constant across renders — and it is not i18n-specific;
the toolkit deliberately knows about no i18n library.

## API

`useStructureFormValidation<T>(initialData: T = {}, schema?: ZodType<T> | (() => ZodType<T>), options?)`
— `schema` is optional; without one, `validate()` always passes.

`options`:

| Option         | Type        | Purpose                                                                                       |
| -------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `revalidateOn` | `unknown[]` | Re-runs `validate()` over unchanged data when a dependency changes, but only while errors are on display and never on mount. See above. |

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
