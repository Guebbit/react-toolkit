import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/query-core';
import { canonicalize } from '@guebbit/js-toolkit';
import { useStructureRestApi, type IFetchSettings } from './structureRestApi';

/**
 * Page-cache for one search: page number => ids of the items that answered it.
 */
export type ISearchCache<K = string | number> = Record<string, Record<number, K[]>>;

/**
 * Settings accepted by `useWatchSearch`: `IFetchSettings` plus the watcher-specific
 * knob (immediate) and lifecycle callbacks (onSuccess/onError/onSettled).
 */
export interface IWatchSearchSettings<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number, any> = Record<string, any>,
    F = object
> extends IFetchSettings {
    immediate?: boolean;
    onSuccess?: (items: (T | undefined)[], filters: F) => void;
    onError?: (error: unknown, filters: F) => void;
    onSettled?: (items: (T | undefined)[] | undefined, error: unknown, filters: F) => void;
}

/**
 * Combines a search's cacheKey (filters + pageSize) with the caller's own
 * lastUpdateKey, if any, into the single lastUpdateKey dimension fetchPaginate
 * accepts. The result always starts with `searchKey` — searchCleanup depends on
 * that prefix to match every cached bucket of one search regardless of
 * lastUpdateKey.
 */
const combineKey = (searchKey: string, lastUpdateKey = ''): string =>
    lastUpdateKey ? searchKey + '|' + lastUpdateKey : searchKey;

/**
 * Reads the current value out of a getter function or a plain value.
 * In React context, filters are passed directly as values or via refs.
 */
const readSource = <X>(source: X | (() => X)): X =>
    typeof source === 'function' ? (source as () => X)() : source;

/**
 * Adds filtered search on top of an internally-owned useStructureRestApi() instance
 * — the same composition pattern useStructureRestApi itself uses on top of
 * useStructureDataManagement: `settings` is forwarded straight through as its options.
 *
 * Adds `fetchSearch`, `searchGet`, `checkSearch`, and the page-cache bookkeeping
 * (`searchCached`) behind them; pair it with the `useWatchSearch` hook (exported
 * below) for reactive, page-driven searching.
 *
 * `pageItemList` is overridden to be scoped to the CURRENT search's current page,
 * instead of a slice of the whole local item dictionary — otherwise its value would
 * silently drift once more than one search's items share the dictionary.
 *
 * The server-reported total (if any) is not this hook's concern: read it out
 * of your own apiCall response and keep it in your own state.
 *
 * `resetAll`/`destroy` are likewise overridden to also clear this hook's
 * own `searchCached`, so one call tears down everything.
 *
 * @param filtersSource  - Current search filters object or a getter producing them
 * @param settings       - options forwarded to the internally-created useStructureRestApi()
 */
export const useStructureSearchApi = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number, any> = Record<string, any>,
    K extends string | number = Extract<keyof T, string | number>,
    P extends string | number = string | number,
    F = object
>(
    filtersSource: F | (() => F),
    settings?: Parameters<typeof useStructureRestApi<T, K, P>>[0]
) => {
    // Create the underlying REST API hook
    const restSettings: Parameters<typeof useStructureRestApi<T, K, P>>[0] = settings ?? {};

    const api = useStructureRestApi<T, K, P>(restSettings);

    /**
     * fetchSearch/checkSearch are built on top of these restApi primitives
     * instead of reimplementing them:
     *  - pageCurrent/pageSize: shared pagination state driving fetchSearch/useWatchSearch
     *  - createIdentifier: builds the id list stored per page in searchCached
     *  - getRecords: resolves searchCached's stored ids back into items for searchGet
     *  - fetchPaginate/checkPaginate: the fetch/freshness primitives fetchSearch
     *    and checkSearch key their filters into (see combineKey)
     *  - queryClient/loadingKey: let searchCleanup inspect the TanStack cache to
     *    tell which searches are still live
     */
    const {
        pageCurrent,
        pageSize,
        createIdentifier,
        getRecords,
        fetchPaginate,
        checkPaginate,
        queryClient,
        loadingKey,
        resetAll: restApiResetAll,
        destroy: restApiDestroy
    } = api;

    /**
     * Reads the CURRENT filters this hook is bound to. Kept behind a ref so its
     * identity is stable while always returning the latest value — `filtersSource`
     * may be a getter reading external, non-React storage (e.g. a ref) whose value
     * changes without a re-render, so it must be read fresh on every call.
     */
    const filtersSourceRef = useRef(filtersSource);
    filtersSourceRef.current = filtersSource;
    const getFilters = useCallback((): F => readSource(filtersSourceRef.current), []);

    /**
     * Cached item ids per page, keyed by (filters, pageSize). The item DATA lives
     * in restApi's item dictionary; this only tracks which ids answered which search.
     */
    const [searchCached, setSearchCached] = useState<ISearchCache<K>>({});

    /**
     * Drops this hook's own search index (the page-to-ids map).
     * Leaves restApi's item dictionary/TanStack cache untouched — use the merged
     * `resetAll`/`destroy` below for a full reset.
     */
    const resetSearches = useCallback(() => {
        setSearchCached({});
    }, []);

    /**
     * Create a stable and always-the-same key from an object.
     * Nested objects are supported: see canonicalize.
     * @param object
     */
    const searchKeyGen = useCallback(
        (object: object = {}) => JSON.stringify(canonicalize(object)),
        []
    );

    /**
     * Get search page based on key, pageSize and page number
     * @param key - stringified search parameters
     * @param page - page
     * @param pageSize - page size (must match the value used in fetchSearch)
     */
    const searchGet = useCallback(
        (key: string | object, page = 1, pageSize = 10) => {
            const searchKey = typeof key === 'string' ? key : searchKeyGen(key);
            return getRecords(searchCached[searchKey + ':' + pageSize]?.[page]);
        },
        [searchCached, searchKeyGen, getRecords]
    );

    /**
     * Prune searchCached entries that no longer have a corresponding live entry
     * in restApi's TanStack query cache. Keeps at most MAX_SEARCHES entries to
     * bound memory usage.
     */
    const searchCleanup = useCallback(() => {
        // Upper bound on distinct (filters, pageSize) combinations kept around
        const MAX_SEARCHES = 50;

        // Every live 'paginate' query restApi currently holds — searches are
        // built on fetchPaginate, so this is where their cache entries live.
        const paginateQueries = queryClient
            .getQueryCache()
            .findAll({ queryKey: [loadingKey, 'paginate'] });

        // cacheKeys that still have at least one page backed by a live TanStack entry
        const activeKeys: string[] = [];

        setSearchCached((prev) => {
            const cachedCopy = { ...prev };

            for (const cacheKey of Object.keys(cachedCopy)) {
                // Live if ANY page under ANY caller lastUpdateKey is still cached. A query's
                // combinedKey (queryKey[2], see fetchPaginate/combineKey) is `cacheKey` itself
                // or `cacheKey + '|' + lastUpdateKey` — checking a single hardcoded
                // lastUpdateKey would prune searches that are very much alive.
                const hasActivePage = paginateQueries.some((query) => {
                    const combinedKey = query.queryKey[2];
                    return (
                        query.state.dataUpdatedAt &&
                        typeof combinedKey === 'string' &&
                        (combinedKey === cacheKey || combinedKey.startsWith(cacheKey + '|'))
                    );
                });

                if (hasActivePage) {
                    activeKeys.push(cacheKey);
                } else {
                    delete cachedCopy[cacheKey];
                }
            }

            // Enforce MAX_SEARCHES — prune excess active keys
            if (activeKeys.length > MAX_SEARCHES) {
                for (const cacheKey of activeKeys.slice(MAX_SEARCHES)) {
                    delete cachedCopy[cacheKey];
                }
            }

            return cachedCopy;
        });
    }, [queryClient, loadingKey]);

    /**
     * Fetches one page of a filtered search, built on top of restApi.fetchPaginate:
     * filters are turned into a stable key (searchKey of filters + ":" + pageSize,
     * e.g. '{"q":"test"}:20') and passed through as fetchPaginate's lastUpdateKey,
     * so each distinct filter set gets its own bucket of cached pages.
     *
     * apiCall resolves with plain items. If the server also reports a total, read
     * it out of your own apiCall response and keep it in your own state — this
     * hook has nothing to do with it.
     *
     * @param apiCall
     * @param filters - search parameters
     * @param page - page number
     * @param pageSize - page size used for caching
     * @param settings - forwarded to fetchPaginate (forced, loading, merge, mismatch, TTL, ...)
     */
    const fetchSearch = useCallback(
        <FF = F>(
            apiCall: () => Promise<(T | undefined)[]>,
            filters: FF = {} as FF,
            page = 1,
            // Could be set in the filters directly but it could be forgotten so it's better to say it explicitly
            pageSize = 10,
            settings: IFetchSettings = {}
        ): Promise<(T | undefined)[]> => {
            // cacheKey groups all pages for the same (filters, pageSize) combination
            const searchKey = searchKeyGen(filters as object) + ':' + pageSize;

            // Prune stale searchCached entries before each search
            searchCleanup();

            return fetchPaginate(apiCall, page, pageSize, {
                ...settings,
                lastUpdateKey: combineKey(searchKey, settings.lastUpdateKey ?? '')
            }).then((items = []) => {
                // Reset and repopulate the page-to-ids map
                setSearchCached((prev) => {
                    const newCache = { ...prev };
                    if (!(searchKey in newCache)) newCache[searchKey] = {};
                    newCache[searchKey][page] = items
                        .filter((item): item is T => item !== undefined)
                        .map((item) => createIdentifier(item));
                    return newCache;
                });

                return items;
            });
        },
        [searchKeyGen, searchCleanup, fetchPaginate, createIdentifier]
    );

    /**
     * Would fetchSearch(apiCall, filters, page, pageSize, settings) be served from cache?
     * Mirrors fetchSearch's own query key: the same (filters, pageSize) searchKey,
     * forwarded as fetchPaginate's lastUpdateKey.
     */
    const checkSearch = useCallback(
        <FF = F>(
            filters: FF = {} as FF,
            page = 1,
            pageSize = 10,
            { lastUpdateKey = '', TTL }: Pick<IFetchSettings, 'lastUpdateKey' | 'TTL'> = {}
        ): boolean => {
            const searchKey = searchKeyGen(filters as object) + ':' + pageSize;
            return checkPaginate(page, pageSize, {
                lastUpdateKey: combineKey(searchKey, lastUpdateKey),
                TTL
            });
        },
        [searchKeyGen, checkPaginate]
    );

    /**
     * Would `fetchSearch` for the current filters/pageCurrent/pageSize be
     * served from cache right now?
     */
    const isPageCached = useCallback(
        (settings?: Pick<IFetchSettings, 'lastUpdateKey' | 'TTL'>): boolean =>
            checkSearch(getFilters() as object, pageCurrent, pageSize, settings),
        [pageCurrent, pageSize, getFilters, checkSearch]
    );

    /**
     * Same as `isPageCached`, but checks `fetchPaginate` (no filters) instead of `fetchSearch`.
     */
    const isPaginateCached = useCallback(
        (settings?: Pick<IFetchSettings, 'lastUpdateKey' | 'TTL'>): boolean => {
            return checkPaginate(pageCurrent, pageSize, settings);
        },
        [checkPaginate, pageCurrent, pageSize]
    );

    /**
     * restApi.resetAll(), plus this hook's own search indexes: a single
     * call resets both halves of the combined store.
     */
    const resetAll = useCallback(() => {
        restApiResetAll();
        resetSearches();
    }, [restApiResetAll, resetSearches]);

    /**
     * restApi.destroy(), plus this hook's own search indexes: a single
     * call tears down both halves of the combined store.
     * @param forced - see restApi.destroy
     */
    const destroy = useCallback(
        (forced = false) => {
            restApiDestroy(forced);
            resetSearches();
        },
        [restApiDestroy, resetSearches]
    );

    return {
        ...api,

        // `api.loading` is a live getter (backed by a ref, not React state) — the
        // spread above already evaluated and froze it, so it must be redeclared
        // here to keep reading through to the live value.
        get loading() {
            // Reading through the property IS the point: destructuring would
            // snapshot it and reintroduce the staleness this getter avoids.
            // eslint-disable-next-line unicorn/consistent-destructuring
            return api.loading;
        },

        // A getter (not a useMemo'd value) because `filtersSource` may be a getter
        // reading external, non-React-state storage (e.g. a ref) — its value can
        // change without a re-render, so this must recompute on every read, not
        // just on the renders React already knows to schedule.
        get pageItemList() {
            return searchGet(getFilters() as object, pageCurrent, pageSize);
        },
        resetAll,
        destroy,

        // Current filters this instance is bound to (read fresh). Consumed by
        // useWatchSearch and available to callers that need the live filters.
        getFilters,

        searchCached,
        searchKeyGen,
        searchGet,
        searchCleanup,
        resetSearches,
        fetchSearch,
        checkSearch,

        isPageCached,
        isPaginateCached
    };
};

// ─── useWatchSearch ────────────────────────────────────────────────────────

/**
 * fetchSearch's reactive counterpart — the React-first equivalent of a Vue
 * `watch([pageCurrent, pageSize], ...)`. A `useEffect` re-runs the search
 * whenever the api's `pageCurrent` or `pageSize` changes, reading whatever
 * filters the api is bound to at that moment. It cleans up on unmount by itself;
 * there is no stop handle to wire up.
 *
 * Filters are READ, not watched: this hook has no opinion on when a filter edit
 * should trigger a search (as-you-type vs on-submit is a UI decision it must not
 * make for you). A filter change only takes effect the next time a search runs —
 * on a page/pageSize change, or via the returned `search()`. For as-you-type,
 * watch your filters yourself (debounced if desired) and call `search()`.
 *
 *     const filters = useState({ q: '' });
 *     const api = useStructureSearchApi(() => filters[0]);
 *     const { search } = useWatchSearch(api, (f, page, size) => fetchPage(f, page, size), {
 *         onSuccess
 *     });
 *     // reset to page 1 and search now, even if pageCurrent was already 1:
 *     const submit = () => { api.setPageCurrent(1); search(true); };
 *
 * @param api      - a useStructureSearchApi instance
 * @param apiCall  - filters/page/pageSize-parametrized fetch
 * @param settings - immediate (run on mount, default true), onSuccess/onError/onSettled,
 *                   plus anything forwarded to fetchSearch (forced, merge, TTL, ...)
 * @returns { search } — trigger a search on demand with the current filters/page/pageSize
 */
export const useWatchSearch = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number, any> = Record<string, any>,
    F = object
>(
    api: Pick<
        ReturnType<typeof useStructureSearchApi<T, string | number, string | number, F>>,
        'fetchSearch' | 'getFilters' | 'pageCurrent' | 'pageSize'
    >,
    apiCall: (filters: F, page: number, pageSize: number) => Promise<(T | undefined)[]>,
    settings: IWatchSearchSettings<T, F> = {}
): { search: (forced?: boolean) => Promise<(T | undefined)[] | undefined> } => {
    const { fetchSearch, getFilters, pageCurrent, pageSize } = api;
    const { immediate = true } = settings;

    // pageCurrent/pageSize are read fresh by search() (which is stable), while the
    // effect below still keys on their VALUES so a change actually re-triggers it.
    const pageRef = useRef(pageCurrent);
    pageRef.current = pageCurrent;
    const sizeRef = useRef(pageSize);
    sizeRef.current = pageSize;

    // Latest apiCall/settings without making them effect dependencies: only an
    // actual page/pageSize change should re-run the search.
    const latestRef = useRef({ apiCall, settings });
    latestRef.current = { apiCall, settings };

    const search = useCallback(
        (forced = false): Promise<(T | undefined)[] | undefined> => {
            const { apiCall: call, settings: options } = latestRef.current;
            const { onSuccess, onError, onSettled, ...fetchSettings } = options;
            const filters = getFilters();
            const page = pageRef.current;
            const size = sizeRef.current;
            return fetchSearch(() => call(filters, page, size), filters, page, size, {
                ...fetchSettings,
                forced: forced || fetchSettings.forced
            })
                .then((items) => {
                    onSuccess?.(items, filters);
                    onSettled?.(items, undefined, filters);
                    return items;
                })
                .catch((error: unknown): undefined => {
                    onError?.(error, filters);
                    onSettled?.(undefined, error, filters);
                    return;
                });
        },
        [fetchSearch, getFilters]
    );

    // Skip only the very first run when immediate is false; every later
    // pageCurrent/pageSize change always searches.
    const firstRunRef = useRef(true);
    useEffect(() => {
        if (firstRunRef.current) {
            firstRunRef.current = false;
            if (!immediate) return;
        }
        void search();
        // `immediate` is read once, on mount; later renders are page/size changes.
    }, [pageCurrent, pageSize, search, immediate]);

    return { search };
};
