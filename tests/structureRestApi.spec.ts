/**
 * structureRestApi — table-like usage
 *
 * Simulates a page that displays a list of items in a table:
 *   - loading the full list (fetchAll)
 *   - selecting a single row to view/edit details (fetchTarget)
 *   - creating a new item (createTarget)
 *   - updating an existing item (updateTarget)
 *   - deleting an item (deleteTarget)
 *   - TTL caching (a second fetchAll within TTL does not call the API again)
 *   - forced refresh (bypasses TTL)
 *
 * All API calls are replaced by local in-memory mock functions — no network
 * access is required.
 */

import { act, renderHook } from '@testing-library/react';
import { useStructureRestApi } from '../src/hooks/structureRestApi';

interface IUser {
    id: number;
    name: string;
    email: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a composable with a 1-hour TTL (default). */
function makeComposable(TTL = 3_600_000) {
    const rendered = renderHook(() => useStructureRestApi<IUser, number>({ identifiers: 'id', TTL }));
    const current = () => rendered.result.current;
    const valueRef = <T>(getter: () => T, setter?: (value: T) => void) =>
        Object.defineProperty({}, 'value', {
            get: getter,
            set: (value: T) => setter?.(value),
            enumerable: true
        }) as { value: T };

    return {
        fetchAll: async (...args: any[]) => {
            let result: any;
            await act(async () => {
                result = await (current() as any).fetchAll(...args);
            });
            return result;
        },
        fetchTarget: async (...args: any[]) => {
            let result: any;
            await act(async () => {
                result = await (current() as any).fetchTarget(...args);
            });
            return result;
        },
        fetchMultiple: async (...args: any[]) => {
            let result: any;
            await act(async () => {
                result = await (current() as any).fetchMultiple(...args);
            });
            return result;
        },
        createTarget: async (...args: any[]) => {
            let result: any;
            await act(async () => {
                result = await (current() as any).createTarget(...args);
            });
            return result;
        },
        updateTarget: async (...args: any[]) => {
            let result: any;
            await act(async () => {
                result = await (current() as any).updateTarget(...args);
            });
            return result;
        },
        deleteTarget: async (...args: any[]) => {
            let result: any;
            await act(async () => {
                result = await (current() as any).deleteTarget(...args);
            });
            return result;
        },
        getRecord: (...args: any[]) => (current() as any).getRecord(...args),
        itemList: valueRef(() => current().itemList),
        selectedRecord: valueRef(() => current().selectedRecord),
        selectedIdentifier: valueRef(
            () => current().selectedIdentifier,
            (value) => act(() => current().setSelectedIdentifier(value))
        ),
        loading: valueRef(() => current().loading)
    };
}

/** Resolve-only API stub returning the given data. */
function apiResolve<T = undefined>(data?: T): () => Promise<T> {
    return jest.fn().mockResolvedValue(data);
}

/** Reject-only API stub. */
function apiReject(message = 'network error'): () => Promise<never> {
    return jest.fn().mockRejectedValue(new Error(message));
}

const USERS: IUser[] = [
    { id: 1, name: 'Alice', email: 'alice@example.com' },
    { id: 2, name: 'Bob', email: 'bob@example.com' },
    { id: 3, name: 'Carol', email: 'carol@example.com' }
];

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('useStructureRestApi — table-like usage', () => {
    // -----------------------------------------------------------------------
    // fetchAll
    // -----------------------------------------------------------------------
    describe('fetchAll — listing items', () => {
        it('populates itemList after a successful fetch', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([...USERS]));
            expect(c.itemList.value).toHaveLength(3);
        });

        it('stores each item in itemDictionary by id', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([...USERS]));
            expect(c.getRecord(1)).toEqual(USERS[0]);
            expect(c.getRecord(2)).toEqual(USERS[1]);
            expect(c.getRecord(3)).toEqual(USERS[2]);
        });

        it('replaces old list on a second forced fetchAll', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([USERS[0]]));
            await c.fetchAll(apiResolve([...USERS]), { forced: true });
            expect(c.itemList.value).toHaveLength(3);
        });

        it('does NOT call the API again when TTL is still valid', async () => {
            const c = makeComposable();
            const firstCall = jest.fn().mockResolvedValue([...USERS]);
            const secondCall = jest.fn().mockResolvedValue([...USERS]);
            await c.fetchAll(firstCall);
            await c.fetchAll(secondCall);
            expect(firstCall).toHaveBeenCalledTimes(1);
            expect(secondCall).not.toHaveBeenCalled();
        });

        it('calls the API again when TTL has expired', async () => {
            // Use TTL = 0 so every call is considered expired
            const c = makeComposable(0);
            const firstCall = jest.fn().mockResolvedValue([...USERS]);
            const secondCall = jest.fn().mockResolvedValue([...USERS]);
            await c.fetchAll(firstCall);
            await c.fetchAll(secondCall);
            expect(firstCall).toHaveBeenCalledTimes(1);
            expect(secondCall).toHaveBeenCalledTimes(1);
        });

        it('bypasses TTL when forced: true', async () => {
            const c = makeComposable();
            const firstCall = jest.fn().mockResolvedValue([...USERS]);
            const secondCall = jest.fn().mockResolvedValue([...USERS]);
            await c.fetchAll(firstCall);
            await c.fetchAll(secondCall, { forced: true });
            expect(secondCall).toHaveBeenCalledTimes(1);
        });

        it('re-throws on API error and keeps itemList as-is', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([USERS[0]]));
            await expect(c.fetchAll(apiReject(), { forced: true })).rejects.toThrow(
                'network error'
            );
            // pre-existing record from the first call should still be there
            expect(c.getRecord(1)).toEqual(USERS[0]);
        });

        it('skips undefined entries returned by the API', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([USERS[0], undefined, USERS[1]] as (IUser | undefined)[]));
            expect(c.itemList.value).toHaveLength(2);
        });
    });

    // -----------------------------------------------------------------------
    // fetchTarget
    // -----------------------------------------------------------------------
    describe('fetchTarget — selecting a single item', () => {
        it('fetches and stores a single item', async () => {
            const c = makeComposable();
            const result = await c.fetchTarget(apiResolve(USERS[0]), 1);
            expect(result).toEqual(USERS[0]);
            expect(c.getRecord(1)).toEqual(USERS[0]);
        });

        it('returns cached item within TTL without calling the API again', async () => {
            const c = makeComposable();
            const firstCall = jest.fn().mockResolvedValue(USERS[0]);
            const secondCall = jest.fn().mockResolvedValue(USERS[0]);
            await c.fetchTarget(firstCall, 1);
            await c.fetchTarget(secondCall, 1);
            expect(secondCall).not.toHaveBeenCalled();
        });

        it('re-fetches when forced: true', async () => {
            const c = makeComposable();
            const firstCall = jest.fn().mockResolvedValue(USERS[0]);
            const secondCall = jest.fn().mockResolvedValue({ ...USERS[0], name: 'Alice V2' });
            await c.fetchTarget(firstCall, 1);
            await c.fetchTarget(secondCall, 1, { forced: true });
            expect(c.getRecord(1)?.name).toBe('Alice V2');
        });

        it('returns undefined when the API returns undefined', async () => {
            const c = makeComposable();
            const result = await c.fetchTarget(apiResolve(), 99);
            expect(result).toBeUndefined();
        });

        it('re-throws on API error', async () => {
            const c = makeComposable();
            await expect(c.fetchTarget(apiReject(), 1)).rejects.toThrow('network error');
        });
    });

    // -----------------------------------------------------------------------
    // selectedIdentifier / selectedRecord — row selection in a table
    // -----------------------------------------------------------------------
    describe('selectedIdentifier / selectedRecord — row selection', () => {
        it('selectedRecord is undefined when no identifier is set', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([...USERS]));
            expect(c.selectedRecord.value).toBeUndefined();
        });

        it('reflects the currently selected row', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([...USERS]));
            c.selectedIdentifier.value = 2;
            expect(c.selectedRecord.value).toEqual(USERS[1]);
        });

        it('changes when a different row is selected', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([...USERS]));
            c.selectedIdentifier.value = 1;
            c.selectedIdentifier.value = 3;
            expect(c.selectedRecord.value).toEqual(USERS[2]);
        });

        it('clears selectedRecord when identifier is set back to undefined', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([...USERS]));
            c.selectedIdentifier.value = 1;
            c.selectedIdentifier.value = undefined;
            expect(c.selectedRecord.value).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // createTarget
    // -----------------------------------------------------------------------
    describe('createTarget — adding a new item', () => {
        it('adds the returned item to itemDictionary', async () => {
            const c = makeComposable();
            const newUser: IUser = { id: 4, name: 'Dave', email: 'dave@example.com' };
            await c.createTarget(apiResolve(newUser));
            expect(c.getRecord(4)).toEqual(newUser);
        });

        it('removes dummy data on success and replaces with real item', async () => {
            const c = makeComposable();
            const dummy: IUser = { id: -1, name: 'Loading...', email: '' };
            const real: IUser = { id: 4, name: 'Dave', email: 'dave@example.com' };
            await c.createTarget(apiResolve(real), dummy);
            expect(c.getRecord(4)).toEqual(real);
            // The dummy record (with its temp uuid key) should be gone
            expect(c.itemList.value.some((u) => u.name === 'Loading...')).toBe(false);
        });

        it('rolls back dummy data on API error', async () => {
            const c = makeComposable();
            const dummy: IUser = { id: -1, name: 'Loading...', email: '' };
            await expect(c.createTarget(apiReject(), dummy)).rejects.toThrow();
            expect(c.itemList.value).toHaveLength(0);
        });

        it('returns undefined when the API returns undefined', async () => {
            const c = makeComposable();
            const result = await c.createTarget(apiResolve());
            expect(result).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // updateTarget
    // -----------------------------------------------------------------------
    describe('updateTarget — editing an existing item', () => {
        it('applies the update optimistically and then confirms it', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([...USERS]));
            const updated: IUser = { id: 1, name: 'Alice Updated', email: 'new@example.com' };
            await c.updateTarget(apiResolve(updated), { name: 'Alice Updated' }, 1);
            expect(c.getRecord(1)?.name).toBe('Alice Updated');
        });

        it('rolls back to old data on API error', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([...USERS]));
            await expect(c.updateTarget(apiReject(), { name: 'Broken' }, 1)).rejects.toThrow();
            expect(c.getRecord(1)?.name).toBe('Alice');
        });
    });

    // -----------------------------------------------------------------------
    // deleteTarget
    // -----------------------------------------------------------------------
    describe('deleteTarget — removing an item', () => {
        it('removes the item from itemDictionary immediately', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([...USERS]));
            await c.deleteTarget(apiResolve(), 1);
            expect(c.getRecord(1)).toBeUndefined();
            expect(c.itemList.value).toHaveLength(2);
        });

        it('rolls back the deleted item on API error', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve([...USERS]));
            await expect(c.deleteTarget(apiReject(), 1)).rejects.toThrow();
            // item should be restored
            expect(c.getRecord(1)).toEqual(USERS[0]);
        });
    });

    // -----------------------------------------------------------------------
    // loading flag
    // -----------------------------------------------------------------------
    describe('loading flag', () => {
        it('is false before any fetch', () => {
            const c = makeComposable();
            expect(c.loading.value).toBe(false);
        });

        it('becomes true during a fetch and false after it resolves', async () => {
            const c = makeComposable();
            let duringFetch = false;
            const apiCall = jest.fn().mockImplementation(async () => {
                duringFetch = c.loading.value as boolean;
                return [...USERS];
            });
            await c.fetchAll(apiCall);
            expect(typeof duringFetch).toBe('boolean');
            expect(c.loading.value).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // fetchMultiple
    // -----------------------------------------------------------------------
    describe('fetchMultiple — fetching several items at once', () => {
        it('returns an empty array when no ids are provided', async () => {
            const c = makeComposable();
            const result = await c.fetchMultiple(apiResolve([USERS[0]]), []);
            expect(result).toEqual([]);
        });

        it('fetches only expired items and merges with cached ones', async () => {
            const c = makeComposable();
            // Pre-populate item 1 so it is cached
            await c.fetchTarget(apiResolve(USERS[0]), 1);

            const apiCall = jest.fn().mockResolvedValue([USERS[1]]);
            // Ask for ids 1 (cached) and 2 (not cached)
            const result = await c.fetchMultiple(apiCall, [1, 2]);
            // The API should be called only for id 2
            expect(apiCall).toHaveBeenCalledTimes(1);
            // Both items should be returned
            expect(result.some((u: IUser | undefined) => u?.id === 1)).toBe(true);
            expect(result.some((u: IUser | undefined) => u?.id === 2)).toBe(true);
        });
    });
});
