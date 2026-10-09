/* eslint-disable @typescript-eslint/no-explicit-any */

import { act, renderHook } from '@testing-library/react';
import {
    useStructureCrudApi,
    useWatchList,
    useWatchOne,
    type IStructureCrudOperations
} from '../src/hooks/structureCrudApi';
import type { IWatchSearchSettings } from '../src/hooks/structureSearchApi';
import { clearAllInstances, liveHandle, track } from './structureRestApi/_helpers/harness';
import { deferred } from './structureRestApi/_helpers/fakeApi';

interface IProduct {
    id: string;
    title: string;
    price?: number;
}

interface IProductFilters {
    text?: string;
}

/**
 * Update payload of a multipart form: carries a `File` the record itself has no business holding.
 */
interface IProductUpdate {
    title?: string;
    imageUpload?: { name: string };
}

/** What useWatchList hands back, named so the linter can resolve it through the hook result. */
type IWatchListHandle = {
    search: (forced?: boolean) => Promise<(IProduct | undefined)[] | undefined>;
};

/** Lets the effects a freshly-mounted hook scheduled run and settle. */
const flushEffects = () =>
    act(async () => {
        await Promise.resolve();
    });

const PRODUCT: IProduct = { id: 'p1', title: 'First', price: 10 };
const OTHER: IProduct = { id: 'p2', title: 'Second', price: 20 };

/**
 * The operations as the spies they are. Declared rather than inferred: spreading overrides over
 * defaults widens each one to a union with its declared operation type, and the mock methods the
 * assertions call go with it.
 */
interface IOperationMocks {
    list: jest.Mock;
    search: jest.Mock;
    get: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    optimisticPatch?: (data: IProductUpdate) => Partial<IProduct>;
}

type TOperations = Partial<IOperationMocks>;

const buildOperations = (overrides: TOperations = {}): IOperationMocks => ({
    list: jest.fn().mockResolvedValue([PRODUCT, OTHER]),
    search: jest.fn().mockResolvedValue([PRODUCT]),
    get: jest.fn().mockResolvedValue(PRODUCT),
    create: jest.fn().mockResolvedValue(PRODUCT),
    update: jest.fn().mockResolvedValue({ ...PRODUCT, title: 'Updated' }),
    remove: jest.fn().mockResolvedValue({ deleted: true }),
    ...overrides
});

/**
 * Builds a tracked hook over spied operations, so every test can assert both what the store
 * ended up holding and which call was made to get there.
 *
 * `api` is the live-wrapped handle (every method auto-wrapped in act()); `result` is the raw
 * renderHook result, for the few tests that must observe state while a request is still in
 * flight and so cannot let the wrapper await it.
 */
const makeCrud = (overrides: TOperations = {}, initialFilters?: IProductFilters) => {
    const operations = buildOperations(overrides);
    const { result } = renderHook(() =>
        useStructureCrudApi<IProduct, string, IProductFilters, any, any>(operations, {
            identifiers: 'id',
            TTL: 3_600_000,
            initialFilters
        })
    );
    const api = track(liveHandle(() => result.current));
    return { api, operations, result };
};

/**
 * A crud instance with {@link useWatchList} mounted alongside it, the pairing a list screen uses.
 */
const makeWatchedCrud = (
    overrides: TOperations = {},
    settings: IWatchSearchSettings<IProduct, IProductFilters> = {}
) => {
    const operations = buildOperations(overrides);
    const { result } = renderHook(() => {
        const api = useStructureCrudApi<IProduct, string, IProductFilters, any, any>(operations, {
            identifiers: 'id',
            TTL: 3_600_000
        });
        const watch: IWatchListHandle = useWatchList<IProduct, IProductFilters>(api, settings);
        return { api, watch };
    });
    const api = track(liveHandle(() => result.current.api));
    return { api, operations, result };
};

/**
 * A read-only resource: the methods with no counterpart must fail in a way that names what is
 * missing, rather than deeper down with a less obvious message.
 */
const makeReadOnly = () => {
    const operations = { list: jest.fn().mockResolvedValue([PRODUCT]) };
    const { result } = renderHook(() =>
        useStructureCrudApi<IProduct, string, IProductFilters>(operations, { identifiers: 'id' })
    );
    return track(liveHandle(() => result.current));
};

describe('useStructureCrudApi', () => {
    afterEach(clearAllInstances);

    // ─── pass-through ─────────────────────────────────────────────────────────

    describe('the underlying search api', () => {
        it('is passed through, so nothing is given up by using this layer', () => {
            const { api } = makeCrud();
            // A representative member of each layer it is built on.
            expect(api.itemDictionary).toBeDefined(); // dataManagement
            expect(api.fetchTarget).toBeDefined(); // restApi
            expect(api.searchGet).toBeDefined(); // searchApi
            expect(api.pageCurrent).toBeDefined();
        });

        // `loading` and `pageItemList` are getters on the layer below, so the spread that
        // re-exports them evaluates them once. Both tests read through an object captured at an
        // EARLIER render, which is the only way to tell a live getter from a frozen value.

        it('reads pageItemList through to the live value, not the one the spread froze', async () => {
            const { api, result } = makeCrud();
            await api.searchNow();
            const captured = result.current;
            expect(captured.pageItemList).toEqual([PRODUCT]);

            api.setFilters({ text: 'never-searched' });

            // Same object, but pageItemList is scoped to the filters as they are NOW.
            expect(captured.pageItemList).toEqual([]);
        });

        it('reads loading through to the live value', async () => {
            // Loading is ref-counted, so it moves with no re-render at all: a frozen spread
            // would report the value from mount for the whole request.
            const control = deferred<(IProduct | undefined)[]>();
            const { result } = makeCrud({ list: jest.fn().mockReturnValue(control.promise) });
            const captured = result.current;
            expect(captured.loading).toBe(false);

            let pending: Promise<unknown> | undefined;
            act(() => {
                pending = captured.fetchList();
            });
            expect(captured.loading).toBe(true);

            control.resolve([PRODUCT]);
            await act(async () => {
                await pending;
            });
            expect(captured.loading).toBe(false);
        });
    });

    // ─── filters ──────────────────────────────────────────────────────────────

    describe('filters', () => {
        it('starts empty', () => {
            const { api } = makeCrud();
            expect(api.filters).toEqual({});
        });

        it('starts from initialFilters when given', () => {
            const { api } = makeCrud({}, { text: 'seed' });
            expect(api.filters).toEqual({ text: 'seed' });
        });

        it('is the source the search reads, so an edit reaches the next search', async () => {
            const { api, operations } = makeCrud();
            api.setFilters({ text: 'chair' });

            await api.searchNow();

            expect(operations.search).toHaveBeenCalledWith({ text: 'chair' }, 1, 10);
        });

        it('is readable synchronously after being set, so the Search button is not one edit behind', async () => {
            const { api, operations } = makeCrud();
            // No re-render in between: the ref is what makes this hold.
            api.setFilters({ text: 'chair' });
            expect(api.filters).toEqual({ text: 'chair' });
            await api.searchNow();
            expect(operations.search).toHaveBeenLastCalledWith({ text: 'chair' }, 1, 10);
        });

        it('accepts an updater, the way React setters do', () => {
            const { api } = makeCrud({}, { text: 'seed' });
            api.setFilters((previous) => ({ ...previous, text: previous.text + '-more' }));
            expect(api.filters).toEqual({ text: 'seed-more' });
        });

        it('does not search on its own when edited', async () => {
            const { api, operations } = makeWatchedCrud();
            await flushEffects();
            operations.search.mockClear();

            api.setFilters({ text: 'chair' });
            await flushEffects();

            // As-you-type vs on-submit is the screen's decision, not the resource's.
            expect(operations.search).not.toHaveBeenCalled();
        });
    });

    // ─── fetchList ────────────────────────────────────────────────────────────

    describe('fetchList', () => {
        it('stores every record', async () => {
            const { api } = makeCrud();
            await api.fetchList();
            expect(api.itemList).toEqual([PRODUCT, OTHER]);
        });

        it('forwards its settings', async () => {
            const { api, operations } = makeCrud();
            await api.fetchList();
            await api.fetchList({ forced: true });
            expect(operations.list).toHaveBeenCalledTimes(2);
        });

        it('serves a second call from cache without settings', async () => {
            const { api, operations } = makeCrud();
            await api.fetchList();
            await api.fetchList();
            expect(operations.list).toHaveBeenCalledTimes(1);
        });
    });

    // ─── search ───────────────────────────────────────────────────────────────

    describe('useWatchList', () => {
        it('searches immediately', async () => {
            const { operations } = makeWatchedCrud();
            await flushEffects();
            expect(operations.search).toHaveBeenCalledWith({}, 1, 10);
        });

        it('re-searches when the page changes', async () => {
            const { api, operations } = makeWatchedCrud();
            await flushEffects();

            api.setPageCurrent(2);
            await flushEffects();

            expect(operations.search).toHaveBeenLastCalledWith({}, 2, 10);
        });

        it('reports failures through onError instead of swallowing them', async () => {
            const reason = new Error('search failed');
            const onError = jest.fn();
            const { result } = makeWatchedCrud(
                { search: jest.fn().mockRejectedValue(reason) },
                { onError }
            );

            await act(async () => {
                await result.current.watch.search();
            });

            expect(onError).toHaveBeenCalledWith(reason, {});
        });

        it('scopes pageItemList to the current search', async () => {
            const { api, result } = makeWatchedCrud();
            await act(async () => {
                await result.current.watch.search();
            });
            expect(api.pageItemList).toEqual([PRODUCT]);
        });
    });

    describe('searchNow', () => {
        it('goes back to page one, so the Search button always does something', async () => {
            const { api, operations } = makeCrud();
            api.setPageCurrent(4);

            await api.searchNow();

            expect(api.pageCurrent).toBe(1);
            expect(operations.search).toHaveBeenCalledWith({}, 1, 10);
        });
    });

    describe('resetFilters', () => {
        it('clears the filters and searches again', async () => {
            const { api, operations } = makeCrud();
            api.setFilters({ text: 'chair' });

            await api.resetFilters();

            expect(api.filters).toEqual({});
            expect(operations.search).toHaveBeenLastCalledWith({}, 1, 10);
        });

        it('returns to initialFilters, not to empty, when the resource has defaults', async () => {
            const { api } = makeCrud({ search: jest.fn().mockResolvedValue([]) }, { text: 'seed' });
            api.setFilters({ text: 'chair' });

            await api.resetFilters();

            expect(api.filters).toEqual({ text: 'seed' });
        });

        it('bypasses the cache, because Reset is a request for the truth', async () => {
            const { api, operations } = makeCrud();
            await api.searchNow();
            operations.search.mockClear();

            await api.resetFilters();

            expect(operations.search).toHaveBeenCalledTimes(1);
        });
    });

    describe('fetchPage', () => {
        it('fetches an unfiltered page', async () => {
            const { api, operations } = makeCrud();
            await api.fetchPage(3, 25);
            expect(operations.search).toHaveBeenCalledWith({}, 3, 25);
        });

        it('leaves the shared search state alone', async () => {
            const { api } = makeCrud();
            api.setPageCurrent(2);
            await api.fetchPage(3, 25);
            expect(api.pageCurrent).toBe(2);
        });
    });

    // ─── one record ───────────────────────────────────────────────────────────

    describe('fetchOne', () => {
        it('stores the record and selects it', async () => {
            const { api } = makeCrud();
            await api.fetchOne('p1');
            expect(api.selectedRecord).toEqual(PRODUCT);
        });

        it('selects before fetching, so a cached record renders without a blank frame', async () => {
            // Observed while the request is still pending, which is the whole claim — hence the
            // raw result rather than the live handle, whose act() wrapper would await it.
            const control = deferred<IProduct>();
            const { result } = makeCrud({ get: jest.fn().mockReturnValue(control.promise) });

            let pending: Promise<unknown> | undefined;
            act(() => {
                pending = result.current.fetchOne('p1');
            });

            expect(result.current.selectedIdentifier).toBe('p1');

            control.resolve(PRODUCT);
            await act(async () => {
                await pending;
            });
        });

        it('undoes the selection when the fetch fails', async () => {
            // Both halves asserted: a test that only checks the end state passes just as well
            // when the selection was never made, which is not the behaviour being described.
            const control = deferred<IProduct>();
            const { result } = makeCrud({ get: jest.fn().mockReturnValue(control.promise) });

            let pending: Promise<unknown> | undefined;
            act(() => {
                pending = result.current.fetchOne('p1');
            });
            expect(result.current.selectedIdentifier).toBe('p1');

            control.reject(new Error('404'));
            await act(async () => {
                await expect(pending).rejects.toThrow('404');
            });

            expect(result.current.selectedIdentifier).toBeUndefined();
        });

        it('forwards the id to the operation', async () => {
            const { api, operations } = makeCrud();
            await api.fetchOne('p1');
            expect(operations.get).toHaveBeenCalledWith('p1');
        });
    });

    describe('useWatchOne', () => {
        it('fetches immediately and again whenever the id changes', async () => {
            const operations = buildOperations();
            const { rerender } = renderHook(
                ({ id }: { id: string | undefined }) => {
                    const api = useStructureCrudApi<IProduct, string, IProductFilters, any, any>(
                        operations,
                        { identifiers: 'id', TTL: 3_600_000 }
                    );
                    useWatchOne(api, id);
                    return api;
                },
                { initialProps: { id: 'p1' as string | undefined } }
            );

            await flushEffects();
            act(() => {
                rerender({ id: 'p2' });
            });
            await flushEffects();

            expect(operations.get).toHaveBeenCalledWith('p1');
            expect(operations.get).toHaveBeenCalledWith('p2');
        });
    });

    // ─── mutations ────────────────────────────────────────────────────────────

    describe('createOne', () => {
        it('stores the created record', async () => {
            const { api } = makeCrud();
            await api.createOne({ title: 'First' });
            expect(api.getRecord('p1')).toEqual(PRODUCT);
        });

        it('forwards per-call options to the operation', async () => {
            const { api, operations } = makeCrud();
            const options = { signal: 'abort-signal' };
            await api.createOne({ title: 'First' }, options);
            expect(operations.create).toHaveBeenCalledWith({ title: 'First' }, options);
        });
    });

    describe('updateOne', () => {
        it('applies the change locally before the request goes out', async () => {
            // Observed from inside the pending request rather than after N microtasks: how long
            // updateTarget's cancel-then-write takes is TanStack's business, but that the local
            // record is already updated by the time the request is sent is the actual contract.
            const update = jest.fn();
            const { api } = makeCrud({ update });
            let titleWhenSent: string | undefined;
            update.mockImplementation(() => {
                titleWhenSent = api.getRecord('p1')?.title;
                return Promise.resolve({ ...PRODUCT, title: 'Updated' });
            });
            await api.fetchOne('p1');

            await api.updateOne('p1', { title: 'Optimistic' });

            expect(titleWhenSent).toBe('Optimistic');
        });

        it('rolls back when the request fails', async () => {
            const { api } = makeCrud({ update: jest.fn().mockRejectedValue(new Error('nope')) });
            await api.fetchOne('p1');

            await expect(api.updateOne('p1', { title: 'Optimistic' })).rejects.toThrow('nope');

            expect(api.getRecord('p1')?.title).toBe('First');
        });

        it('forwards per-call options to the operation', async () => {
            const { api, operations } = makeCrud();
            const options = { onUploadProgress: jest.fn() };
            await api.updateOne('p1', { title: 'Updated' }, options);
            expect(operations.update).toHaveBeenCalledWith('p1', { title: 'Updated' }, options);
        });

        // ── optimisticPatch ──
        it('stores the payload itself as the patch by default', async () => {
            const { api } = makeCrud();
            await api.fetchOne('p1');
            await api.updateOne('p1', { title: 'Updated' });
            expect(api.getRecord('p1')?.title).toBe('Updated');
        });

        it('keeps a File out of the record when optimisticPatch strips it', async () => {
            const update = jest.fn();
            const { api } = makeCrud({
                update,
                optimisticPatch: ({ imageUpload: _dropped, ...fields }: IProductUpdate) => fields
            });
            let recordWhenSent: IProduct | undefined;
            update.mockImplementation(() => {
                recordWhenSent = { ...api.getRecord('p1')! };
                return Promise.resolve({ ...PRODUCT, title: 'Updated' });
            });
            await api.fetchOne('p1');

            await api.updateOne('p1', {
                title: 'Optimistic',
                imageUpload: { name: 'photo.png' }
            });

            // The server answers with a URL; parking a Blob in store state until it does is nonsense.
            expect(recordWhenSent).not.toHaveProperty('imageUpload');
            expect(recordWhenSent?.title).toBe('Optimistic');
        });
    });

    describe('deleteOne', () => {
        it('drops the record', async () => {
            const { api } = makeCrud();
            await api.fetchOne('p1');
            await api.deleteOne('p1');
            expect(api.getRecord('p1')).toBeUndefined();
        });

        it('forwards the id to the operation', async () => {
            const { api, operations } = makeCrud();
            await api.deleteOne('p1');
            expect(operations.remove).toHaveBeenCalledWith('p1', undefined);
        });
    });

    // ─── missing operations ───────────────────────────────────────────────────

    describe('operations that were not supplied', () => {
        it.each<[string, (api: ReturnType<typeof makeReadOnly>) => Promise<unknown>]>([
            ['get', (api) => api.fetchOne('p1')],
            ['create', (api) => api.createOne({ title: 'x' })],
            ['update', (api) => api.updateOne('p1', { title: 'x' })],
            ['remove', (api) => api.deleteOne('p1')],
            ['search', (api) => api.searchNow()],
            ['search', (api) => api.fetchPage()]
        ])('rejects naming the missing "%s" operation', async (operation, call) => {
            const api = makeReadOnly();
            await expect(call(api)).rejects.toThrow(
                `useStructureCrudApi - no "${operation}" operation was supplied`
            );
        });

        it('rejects naming "search" from the reactive path too', async () => {
            const onError = jest.fn();
            const { result } = renderHook(() => {
                const api = useStructureCrudApi<IProduct, string, IProductFilters>(
                    { list: jest.fn().mockResolvedValue([PRODUCT]) },
                    { identifiers: 'id' }
                );
                const watch: IWatchListHandle = useWatchList<IProduct, IProductFilters>(api, {
                    onError
                });
                return { api, watch };
            });
            track(liveHandle(() => result.current.api));

            await act(async () => {
                await result.current.watch.search();
            });

            expect(onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'useStructureCrudApi - no "search" operation was supplied'
                }),
                {}
            );
        });

        it('still serves the operations that were supplied', async () => {
            const api = makeReadOnly();
            await expect(api.fetchList()).resolves.toEqual([PRODUCT]);
        });
    });
});
