import { useCallback, useRef, useState } from 'react';
import {
    useStructureSearchApi,
    useWatchSearch,
    type IWatchSearchSettings
} from './structureSearchApi';
import {
    useWatchTarget,
    type useStructureRestApi,
    type IFetchSettings,
    type IStructureRestApi,
    type IWatchTargetSettings
} from './structureRestApi';

/**
 * The API calls a resource is reached through.
 *
 * All optional: a read-only resource supplies list/get and nothing else, and a method whose
 * operation is missing returns a rejection naming it.
 *
 * @key T - the record
 * @key K - its identifier
 * @key F - the search filters
 * @key C - the create payload
 * @key U - the update payload
 * @key O - per-call options forwarded to your HTTP client (axios config, AbortSignal, ...)
 */
export interface IStructureCrudOperations<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number, any> = Record<string, any>,
    K extends string | number = Extract<keyof T, string | number>,
    F = object,
    C = Partial<T>,
    U = Partial<T>,
    O = unknown
> {
    /** Every record, unpaginated. Powers fetchList. */
    list?: (options?: O) => Promise<(T | undefined)[]>;

    /** One page of a filtered search. Powers useWatchList, searchNow, resetFilters, fetchPage. */
    search?: (
        filters: F,
        page: number,
        pageSize: number,
        options?: O
    ) => Promise<(T | undefined)[]>;

    /** One record by id. Powers fetchOne, useWatchOne. */
    get?: (id: K, options?: O) => Promise<T | undefined>;

    /** Creates a record, resolving with it as stored. */
    create?: (data: C, options?: O) => Promise<T | undefined>;

    /** Updates a record, resolving with it as stored. */
    update?: (id: K, data: U, options?: O) => Promise<T | undefined>;

    /** Deletes a record. Resolved value ignored. */
    remove?: (id: K, options?: O) => Promise<unknown>;

    /**
     * Turns an update payload into the patch updateOne applies locally, default the payload
     * itself. Override when the two differ, e.g. a multipart form whose payload carries a File
     * the record has no business holding: `({ imageUpload, ...fields }) => fields`
     */
    optimisticPatch?: (data: U) => Partial<T>;
}

/**
 * Hook customization settings: everything useStructureRestApi accepts, plus the filters.
 */
export interface IStructureCrudSettings<F = object> extends IStructureRestApi {
    // Starting value of `filters`, and what resetFilters() returns to
    initialFilters?: F;
}

/**
 * A whole resource — list, filtered search, read, create, update, delete — from the API calls
 * that reach it.
 *
 * useStructureSearchApi with the wiring done. Everything it returns is passed through, so this
 * layer is a convenience and never a ceiling: drop to fetchTarget, fetchByParent, searchGet and
 * the rest for anything it does not cover.
 *
 * The two reactive operations are hooks rather than methods, the way the layers below already
 * split them: pair this with {@link useWatchList} and {@link useWatchOne}, since only a value
 * React re-renders on can drive the effect behind them.
 *
 * @param operations - see {@link IStructureCrudOperations}
 * @param settings   - see {@link IStructureCrudSettings}
 */
export const useStructureCrudApi = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number, any> = Record<string, any>,
    K extends string | number = Extract<keyof T, string | number>,
    F = object,
    C = Partial<T>,
    U = Partial<T>,
    O = unknown,
    P extends string | number = string | number
>(
    operations: IStructureCrudOperations<T, K, F, C, U, O> = {},
    { initialFilters, ...settings }: IStructureCrudSettings<F> = {}
) => {
    /**
     * Latest operations without making them a dependency of anything: the object is normally
     * declared inline, so reading through a ref is what keeps every method below stable.
     */
    const operationsRef = useRef(operations);
    operationsRef.current = operations;

    /**
     * The filters resetFilters() returns to, captured once. Later renders passing a different
     * `initialFilters` do not move the reset target — Reset means "back to how this screen
     * opened", and a value rebuilt inline every render would otherwise redefine that silently.
     */
    const initialFiltersRef = useRef<F>((initialFilters ?? {}) as F);

    /**
     * Current search filters, everything except pagination.
     *
     * Editing this does NOT re-run the search: as-you-type vs on-submit is a decision about the
     * screen, not about the resource. Change it, then call searchNow().
     *
     * The ref holds the live value so `setFilters(...)` followed by `searchNow()` in the same
     * handler searches on what was just set; the state exists to drive the re-render.
     */
    const filtersRef = useRef<F>(initialFiltersRef.current);
    const [, setFiltersState] = useState<F>(filtersRef.current);

    /**
     * Replace the filters, by value or by updater.
     *
     * @param update
     */
    const setFilters = useCallback((update: F | ((previous: F) => F)) => {
        const next =
            typeof update === 'function'
                ? (update as (previous: F) => F)(filtersRef.current)
                : update;
        filtersRef.current = next;
        setFiltersState(next);
    }, []);

    const getFilters = useCallback((): F => filtersRef.current, []);

    const api = useStructureSearchApi<T, K, P, F>(getFilters, settings);

    const {
        fetchAll,
        fetchPaginate,
        fetchSearch,
        fetchTarget,
        createTarget,
        updateTarget,
        deleteTarget,
        pageSize,
        setPageCurrent,
        setSelectedIdentifier
    } = api;

    /**
     * Answer for a call whose operation was never supplied.
     * A rejection, not a throw, so it surfaces through the same .catch as a failed request.
     *
     * @param operation
     */
    const missing = useCallback(
        <R>(operation: keyof IStructureCrudOperations<T, K, F, C, U, O>): Promise<R> =>
            Promise.reject(
                new Error(`useStructureCrudApi - no "${String(operation)}" operation was supplied`)
            ),
        []
    );

    /**
     * Apply optimisticPatch, or treat the payload as the patch when there is none.
     *
     * @param data
     */
    const toPatch = useCallback((data: U): Partial<T> => {
        const { optimisticPatch } = operationsRef.current;
        return optimisticPatch ? optimisticPatch(data) : (data as unknown as Partial<T>);
    }, []);

    /**
     * Fetch every record into the dictionary.
     *
     * @param fetchSettings - forwarded to fetchAll (forced, TTL, merge, ...)
     */
    const fetchList = useCallback(
        (fetchSettings: IFetchSettings = {}) => {
            const { list } = operationsRef.current;
            return list
                ? fetchAll(() => list(), fetchSettings)
                : missing<(T | undefined)[]>('list');
        },
        [fetchAll, missing]
    );

    /**
     * Fetch one unfiltered page, without touching the shared search state.
     *
     * @param page
     * @param size
     * @param fetchSettings - forwarded to fetchPaginate
     */
    const fetchPage = useCallback(
        (page = 1, size = 10, fetchSettings: IFetchSettings = {}) => {
            const { search } = operationsRef.current;
            return search
                ? fetchPaginate(() => search({} as F, page, size), page, size, fetchSettings)
                : missing<(T | undefined)[]>('search');
        },
        [fetchPaginate, missing]
    );

    /**
     * The filters/page/pageSize-parametrized fetch {@link useWatchList} drives, and the one
     * place the missing-operation rejection is produced for the reactive path.
     */
    const runSearch = useCallback(
        (currentFilters: F, page: number, size: number): Promise<(T | undefined)[]> => {
            const { search } = operationsRef.current;
            return search
                ? search(currentFilters, page, size)
                : missing<(T | undefined)[]>('search');
        },
        [missing]
    );

    /**
     * The id-parametrized fetch {@link useWatchOne} drives.
     */
    const runGet = useCallback(
        (id: K): Promise<T | undefined> => {
            const { get } = operationsRef.current;
            return get ? get(id) : missing<T | undefined>('get');
        },
        [missing]
    );

    /**
     * Apply the current filters from page one — the "Search" button.
     *
     * Resetting the page is the point: useWatchList's effect fires on a page CHANGE, so a user
     * already on page 1 would otherwise press Search and see nothing happen.
     *
     * @param fetchSettings - forwarded to fetchSearch
     */
    const searchNow = useCallback(
        (fetchSettings: IFetchSettings = {}) => {
            const { search } = operationsRef.current;
            setPageCurrent(1);
            if (!search) return missing<(T | undefined)[]>('search');
            const currentFilters = filtersRef.current;
            return fetchSearch(
                () => search(currentFilters, 1, pageSize),
                currentFilters,
                1,
                pageSize,
                fetchSettings
            );
        },
        [fetchSearch, pageSize, setPageCurrent, missing]
    );

    /**
     * Clear every filter and search again from page one.
     * Forced: Reset asks for the truth, and answering it out of the cache that produced the state
     * being reset is what it does not mean.
     *
     * @param fetchSettings - forwarded to fetchSearch
     */
    const resetFilters = useCallback(
        (fetchSettings: IFetchSettings = {}) => {
            setFilters(initialFiltersRef.current);
            return searchNow({ forced: true, ...fetchSettings });
        },
        [setFilters, searchNow]
    );

    /**
     * Fetch one record and select it, so selectedRecord is what the screen is showing.
     *
     * Selects up front and undoes it on failure — same order as useWatchOne, so a record already
     * in the dictionary renders instead of blanking the page. Use fetchTarget directly to load a
     * record WITHOUT making it current.
     *
     * @param id
     * @param fetchSettings - forwarded to fetchTarget
     */
    const fetchOne = useCallback(
        (id: K, fetchSettings: IFetchSettings = {}) => {
            const { get } = operationsRef.current;
            if (!get) return missing<T | undefined>('get');
            setSelectedIdentifier(id);
            return fetchTarget<T | undefined>(() => get(id), id, fetchSettings).catch(
                (error: unknown) => {
                    setSelectedIdentifier(undefined);
                    throw error;
                }
            );
        },
        [fetchTarget, setSelectedIdentifier, missing]
    );

    /**
     * Create a record and store it.
     *
     * @param data
     * @param options - per-call HTTP options, forwarded to the operation
     */
    const createOne = useCallback(
        (data: C, options?: O) => {
            const { create } = operationsRef.current;
            return create
                ? createTarget<T | undefined>(() => create(data, options))
                : missing<T | undefined>('create');
        },
        [createTarget, missing]
    );

    /**
     * Update a record, applying the change locally first and rolling it back on failure.
     *
     * @param id
     * @param data    - see optimisticPatch for what reaches local state
     * @param options - per-call HTTP options, forwarded to the operation
     */
    const updateOne = useCallback(
        (id: K, data: U, options?: O) => {
            const { update } = operationsRef.current;
            return update
                ? updateTarget<T | undefined>(() => update(id, data, options), toPatch(data), id)
                : missing<T | undefined>('update');
        },
        [updateTarget, toPatch, missing]
    );

    /**
     * Delete a record and drop it from the dictionary.
     *
     * @param id
     * @param options - per-call HTTP options, forwarded to the operation
     */
    const deleteOne = useCallback(
        (id: K, options?: O) => {
            const { remove } = operationsRef.current;
            return remove
                ? deleteTarget(() => remove(id, options), id)
                : missing<unknown>('remove');
        },
        [deleteTarget, missing]
    );

    return {
        ...api,

        // `api.loading` and `api.pageItemList` are live getters — the spread above already
        // evaluated and froze them, so both must be redeclared here to keep reading through.
        get loading() {
            // eslint-disable-next-line unicorn/consistent-destructuring
            return api.loading;
        },
        get pageItemList() {
            // eslint-disable-next-line unicorn/consistent-destructuring
            return api.pageItemList;
        },

        /**
         * Read fresh, for the same reason it is written through a ref: a search fired in the
         * same handler as the edit must see the edit.
         */
        get filters() {
            return filtersRef.current;
        },
        setFilters,

        // Consumed by useWatchList / useWatchOne
        runSearch,
        runGet,

        fetchList,
        fetchPage,
        searchNow,
        resetFilters,
        fetchOne,
        createOne,
        updateOne,
        deleteOne
    };
};

/**
 * Everything {@link useStructureCrudApi} returns.
 */
export type IStructureCrudApi<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number, any> = Record<string, any>,
    K extends string | number = Extract<keyof T, string | number>,
    F = object,
    C = Partial<T>,
    U = Partial<T>,
    O = unknown,
    P extends string | number = string | number
> = ReturnType<typeof useStructureCrudApi<T, K, F, C, U, O, P>>;

// ─── useWatchList ──────────────────────────────────────────────────────────

/**
 * Run the filtered search and keep it running: now, then on every pageCurrent/pageSize change.
 *
 * `useWatchSearch` with the resource's own `search` operation already wired in — the reactive
 * half of {@link useStructureCrudApi}, and a hook rather than a method for the same reason
 * `useWatchSearch` is: only a value React re-renders on can drive the effect.
 *
 * Filters are READ, not watched. A filter edit reaches the next search — on a page change, or
 * via the returned `search()`. Pass `onError`: this runs inside an effect, so a rejection is
 * otherwise swallowed.
 *
 *     const api = useStructureCrudApi<IUser, number, IFilters>(operations, { identifiers: 'id' });
 *     const { search } = useWatchList(api, { onError });
 *     const submit = () => { api.setFilters({ q }); void api.searchNow(); };
 *
 * @param api      - a useStructureCrudApi instance
 * @param settings - immediate (run on mount, default true), onSuccess/onError/onSettled,
 *                   plus anything forwarded to fetchSearch (forced, merge, TTL, ...)
 * @returns { search } — re-run with whatever `filters` now holds
 */
export const useWatchList = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number, any> = Record<string, any>,
    F = object
>(
    api: Pick<
        ReturnType<typeof useStructureSearchApi<T, string | number, string | number, F>>,
        'fetchSearch' | 'getFilters' | 'pageCurrent' | 'pageSize'
    > & {
        runSearch: (filters: F, page: number, pageSize: number) => Promise<(T | undefined)[]>;
    },
    settings: IWatchSearchSettings<T, F> = {}
): { search: (forced?: boolean) => Promise<(T | undefined)[] | undefined> } =>
    useWatchSearch<T, F>(api, api.runSearch, settings);

// ─── useWatchOne ───────────────────────────────────────────────────────────

/**
 * fetchOne's reactive counterpart: selects and (re)fetches whenever the id changes.
 *
 * `useWatchTarget` with the resource's own `get` operation already wired in. Give it the CURRENT
 * id VALUE (state or prop, not a ref); a nullish id is a no-op.
 *
 *     const [userId, setUserId] = useState<number>();
 *     const api = useStructureCrudApi<IUser, number>(operations, { identifiers: 'id' });
 *     useWatchOne(api, userId, { onError });
 *
 * @param api      - a useStructureCrudApi instance
 * @param id       - the id to fetch/select; re-runs whenever it changes
 * @param settings - forwarded to fetchTarget, plus onSuccess/onError/onSettled
 */
export const useWatchOne = <
    K extends string | number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number | symbol, any> = Record<string, any>
>(
    api: Pick<
        ReturnType<typeof useStructureRestApi<T, K>>,
        'fetchTarget' | 'setSelectedIdentifier'
    > & {
        runGet: (id: K) => Promise<T | undefined>;
    },
    id: K | undefined | null,
    settings: IWatchTargetSettings<T | undefined> = {}
): void => useWatchTarget<K, T, T | undefined>(api, id, api.runGet, settings);
