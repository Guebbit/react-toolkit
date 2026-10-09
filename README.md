# @guebbit/react-toolkit

[![npm version](https://img.shields.io/npm/v/@guebbit/react-toolkit.svg)](https://www.npmjs.com/package/@guebbit/react-toolkit)
[![license](https://img.shields.io/npm/l/@guebbit/react-toolkit.svg)](./LICENSE)

React hooks and Zustand stores for CRUD screens: a normalized record store, a REST layer with
caching and optimistic updates (rolled back automatically on failure), Zod-backed form
validation, and toast/loading stores.

## Install

```bash
npm install @guebbit/react-toolkit
```

Peer dependencies: `react >= 18.0.0`, `react-dom >= 18.0.0`, `zustand >= 4.0.0`.

## Quick intro

### `useStructureCrudApi` — a whole resource, from the calls that reach it

The highest-level entry point, and the one to start from. Everything below is still available
through it, so it is a convenience and never a ceiling.

```ts
import { useStructureCrudApi, useWatchList } from '@guebbit/react-toolkit';

export const useProducts = () =>
    useStructureCrudApi<IProduct, string, IProductFilters>(
        {
            list: () => listProducts().then((r) => r.data.items),
            search: (filters, page, pageSize) =>
                listProducts({ ...filters, page, pageSize }).then((r) => r.data.items),
            get: (id) => getProductById(id).then((r) => r.data),
            create: (data) => createProduct(data).then((r) => r.data),
            update: (id, data) => updateProductById(id, data).then((r) => r.data),
            remove: (id) => deleteProductById(id)
        },
        { identifiers: 'id' }
    );

// …and the resource is done: filters, pagination, caching, optimistic updates and rollback included
const api = useProducts();
useWatchList(api, { onError: notifyError });
api.pageItemList; // the current search's current page
```

Every operation is optional — a read-only resource supplies `list` and `get` and nothing else.

### `useStructureRestApi` — fetch, cache, and mutate against a REST API

```ts
import { useStructureRestApi } from '@guebbit/react-toolkit';

const users = useStructureRestApi<IUser, number>({ identifiers: 'id' });

await users.fetchAll(() => axios.get('/api/users').then((r) => r.data));
users.itemList; // record ids currently in store

// Optimistic — updates locally right away, rolls back automatically on failure
await users.updateTarget(
    () => axios.put('/api/users/1', { name: 'New name' }).then((r) => r.data),
    { name: 'New name' },
    1
);
```

### `useStructureSearchApi` — the same, plus filtered pagination

```ts
import { useStructureSearchApi, useWatchSearch } from '@guebbit/react-toolkit';

const [filters, setFilters] = useState({ text: '' });
const products = useStructureSearchApi<IProduct, string, string, typeof filters>(() => filters);

// re-runs on every pageCurrent/pageSize change; `search()` applies edited filters on demand
const { search } = useWatchSearch(products, (currentFilters, page, pageSize) =>
    listProducts({ ...currentFilters, page, pageSize }).then((r) => r.data.items)
);

products.pageItemList; // the current search's current page
```

### `useStructureDataManagement` — normalized store, no networking

```ts
import { useStructureDataManagement } from '@guebbit/react-toolkit';

const users = useStructureDataManagement<IUser>('id');
users.addRecord({ id: 1, name: 'Alice' });
users.getRecord(1); // { id: 1, name: 'Alice' }
```

### `useStructureFormValidation` — reactive form state + Zod validation

```ts
import { z } from 'zod';
import { useStructureFormValidation } from '@guebbit/react-toolkit';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const formElement = useRef<HTMLFormElement>(null);
const login = useStructureFormValidation({ email: '', password: '' }, loginSchema, { formElement });

// Owns `showFormErrors`: a rejected submit reveals the errors and focuses the first invalid field
await login
    .handleSubmit(async (data) => api.post('/login', data))
    .catch((error) => {
        // and the errors only the server can find go under the right input too
        if (!login.applyServerErrors(error)) addMessage('Something went wrong');
    });
```

### `useUploadProgress` — a progress bar for one upload, without an HTTP client

```ts
import { useUploadProgress } from '@guebbit/react-toolkit';

// the one client-specific line, written once per app
const { progress, isUploading, track } = useUploadProgress<AxiosRequestConfig>((onProgress) => ({
    onUploadProgress: (event) => onProgress(event.progress ?? 0)
}));

// `enabled` off means no options are passed at all — no bar flashing for a payload with no file
await track((options) => updateProduct(id, data, options), { enabled: !!file });
```

### `useNotificationsStore` — toasts, as a Zustand store

```ts
import { useNotificationsStore, IToastType } from '@guebbit/react-toolkit';

const notifications = useNotificationsStore();
notifications.addMessage('Saved successfully', IToastType.SUCCESS, 4000);
```

## Documentation

The snippets above are just the entry point. Full API reference, setup options, and the gotchas
that matter in practice: **[guebbit.github.io/react-toolkit](https://guebbit.github.io/react-toolkit/)**

## License

AGPL-3.0 — see [LICENSE](./LICENSE).
