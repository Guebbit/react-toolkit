# useStructureDataManagement

The base primitive: a normalized `{ id -> record }` store with CRUD, selection state,
client-side pagination, and `hasMany`/`belongsTo` parent-relation bookkeeping. No networking —
[`useStructureRestApi`](/composables/structure-rest-api) builds fetching/caching on top of this.
Use it directly when you already have the data (e.g. from a WebSocket push, a props tree, a
non-REST source) and just need somewhere reactive and CRUD-shaped to put it.

## Quickstart

```ts
import { useStructureDataManagement } from '@guebbit/react-toolkit'

interface IUser {
    id: number
    name: string
}

const users = useStructureDataManagement<IUser>('id')

users.addRecord({ id: 1, name: 'Alice' })
users.getRecord(1) // { id: 1, name: 'Alice' }

users.editRecord({ name: 'Alice Updated' }, 1) // merges into the existing record

users.itemList // IUser[] — computed view of the whole store
```

## API

### Setup

`useStructureDataManagement<T, K, P>(identifiers = 'id', delimiter = '|')` — `identifiers` can be
a single field name or an array for composite keys; `delimiter` joins composite key parts into a
single dictionary key.

### CRUD

| Method / property                     | Purpose                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `itemDictionary`                       | The raw `Record<K, T>` store object.                                                              |
| `itemList`                             | Computed array view of `itemDictionary`.                                                          |
| `getRecord(...idParts)`                | Look up one record. Accepts variadic parts for composite identifiers (joined internally).         |
| `getRecords(idsArray)`                 | Look up many records; each entry is a single id or an array of composite parts; misses are dropped. |
| `addRecord(itemData)`                  | Insert or overwrite one record.                                                                   |
| `addRecords(itemsArray)`               | Bulk `addRecord`; falsy entries are skipped.                                                       |
| `editRecord(data, id?, create = true)` | Partial merge into an existing record, or creates it when `create` is `true`. Returns the new id if it created a record, `undefined` if it only updated one. |
| `editRecords(itemsArray)`              | Bulk `editRecord`.                                                                                 |
| `deleteRecord(id)`                     | Removes a record.                                                                                  |
| `setRecords(items)`                    | Replaces the whole dictionary directly.                                                            |
| `resetRecords()`                       | Empties the dictionary.                                                                            |
| `createIdentifier(itemData, customIdentifiers?)` | Builds the dictionary key for an item; auto-generates and writes back a fallback id if one is missing. |
| `identifier`                           | The (possibly joined) identifier field name, as a plain string.                                    |

### Selection & last-inserted tracking

| Property                    | Purpose                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `selectedIdentifier`         | Id of the "currently selected" record (list selection, detail page, ...).        |
| `selectedRecord`             | Computed record for `selectedIdentifier`.                                        |
| `lastInsertedIdentifier`     | Id of the most recently *created* record (not merely updated).                    |
| `lastInsertedIdentifiers`    | Ids created by the most recent batch call (`addRecords`/`editRecords`).           |
| `lastInsertedRecord`         | Computed record for `lastInsertedIdentifier`.                                    |

### Client-side pagination

Operates on `itemList` — for offline/already-fetched data. For server-side pagination, see
[`fetchPaginate`](/composables/structure-rest-api#fetching) on `useStructureRestApi`.

| Property        | Purpose                                          |
| ------------------ | --------------------------------------------------- |
| `pageCurrent`     | Current page, 1-based.                             |
| `pageSize`        | Items per page (default `10`).                     |
| `pageTotal`       | Computed — total page count.                       |
| `pageOffset`      | Computed — index of the first item on the current page. |
| `pageItemList`    | Computed — `itemList` slice for the current page.  |

### `hasMany` / `belongsTo` relations

For child records that need to remember which parent they belong to:

| Method / property                     | Purpose                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `parentHasMany`                        | `Record<P, id[]>` mapping a parent id to its child ids.              |
| `addToParent(parentId, childId)`       | Appends a child id under a parent (lazily creates the list).        |
| `removeFromParent(parentId, childId)`  | Removes a child id from a parent's list.                            |
| `removeDuplicateChildren(parentId)`    | Dedupes a parent's child-id list.                                    |
| `getRecordsByParent(parentId?)`        | Resolves a parent's child ids into a `Record<K, T>` of full records. |
| `getListByParent(parentId?)`           | Same, as an array.                                                    |

## Gotchas

- **Identifier changes don't rekey the dictionary.** If a partial `editRecord` call changes a
  field that's part of the identifier, the record stays under its *old* dictionary key — you get
  an orphaned entry, not a moved one. Delete and re-add if you need to change an id.
- **Missing ids get a fallback, loudly.** If you `addRecord`/`editRecord` an item without its
  identifier field(s) set, a random id is generated and written back onto the item — and a
  `console.warn` fires so it's visible in dev tools rather than silently wrong.
- **Composite identifiers** are passed as multiple arguments (`getRecord('part1', 'part2')`), not
  a single pre-joined string — the composable joins them internally with `delimiter`.
- **Nothing here evicts by age.** The dictionary is only cleared by `resetRecords()` (or, on
  `useStructureRestApi`, by `resetAll()`/`destroy()`/the `maxRecords` critical-mass wipe). Stale
  data is treated as useful data, not garbage.
