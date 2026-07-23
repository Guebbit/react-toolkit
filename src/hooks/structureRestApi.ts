import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, CancelledError } from '@tanstack/query-core';
import type { QueryKey } from '@tanstack/query-core';
import { useStructureDataManagement } from './structureDataManagement';
import { getUuid } from '@guebbit/js-toolkit';

// ─── Type helpers ───────────────────────────────────────────────────────

/**
 * Settings for fetch-like methods that control loading indicators and caching behaviour.
 */
export interface IFetchSettings {
    /**
     * Toggle loading indicators during API calls. When true (default), the hook
     * tracks an active loading session via the provided loading key.
     */
    loading?: boolean;

    /**
     * Arbitrary string appended to the instance's loadingKey to group loading
     * sessions under a sub-key (e.g. one row of a table vs the whole table).
     */
    loadingKey?: string;

    /**
     * Bypass a still-fresh cache entry and re-hit the API.
     */
    forced?: boolean;

    /**
     * TTL override (ms) for this single call. When omitted the hook falls back
     * to the instance's {@link IStructureRestApi.TTL}.
     */
    TTL?: number;

    /**
     * When I don't want to replace the data but merge it instead with the existing one
     * (replacing only the old fields with the new ones)
     *
     * This could happen because different fetches return different fields for the same item.
     *
     * Example: a fetch call with a custom lastUpdateKey retrieves a list of items already
     * held, maybe with a valid TTL. Without merge this would just refresh like a
     * soft-forced call. With merge the items are updated with the new data instead.
     */
    merge?: boolean;

    /**
     * The list/parent/paginate payload carries only PARTIAL fields, so it must
     * not be trusted as the authoritative per-item value: skips seeding the
     * per-item target cache (a later `fetchTarget(id)` still hits the API).
     * `fetchByParent` additionally merges instead of replacing.
     */
    mismatch?: boolean;

    /**
     * Extra cache-key segment for `fetchTarget`/`checkTarget`/`deleteTarget` —
     * lets a caller keep independent cached "versions" of the same target.
     */
    lastUpdateKey?: string;

    /**
     * `createTarget`/`updateTarget` only. When true (default) the resulting record
     * is seeded into the per-item target cache as if it had just been fetched via
     * `fetchTarget`, so a later `fetchTarget(id)` is a cache hit instead of an extra
     * request. Turn off when the record should not be treated as freshly fetched.
     */
    fetchLike?: boolean;

    /**
     * `updateTarget` only. When true (default) the request's response is applied as
     * the record's new data (replace, or merge when `merge` is set). Turn off when
     * the response is not the full updated item (e.g. a bare acknowledgement): the
     * optimistic edit is then kept as the record's final state instead of being
     * overwritten by the response.
     */
    fetchAgain?: boolean;
}

export interface IStructureRestApi {
    /**
     * Identifier field name (or array, for composite keys) used to key records.
     * Forwarded to {@link useStructureDataManagement}.
     */
    identifiers?: string | string[];

    /**
     * Delimiter joining composite identifier parts into a single dictionary key.
     * Forwarded to {@link useStructureDataManagement}.
     */
    delimiter?: string;

    /**
     * Key used for loading state and to namespace this instance's query cache
     * entries. Defaults to a random per-instance value.
     */
    loadingKey?: string;

    /**
     * Default TTL in milliseconds for query cache entries. Override per-call
     * via the `TTL` option on individual fetch methods.
     */
    TTL?: number;

    /**
     * Hard upper bound on the item dictionary size. When a fetched batch would push
     * the dictionary past it, the WHOLE client store is wiped before the batch is
     * stored (see `resetAll`). 0 disables it.
     *
     * This is a critical-mass backstop, NOT a cache policy. Records are never dropped
     * for being old: stale data is useful data — it keeps the list on screen while the
     * fresh copy downloads. A record is garbage only when nothing points at it, and age
     * says nothing about that. So there is no TTL on the dictionary and no eviction tied
     * to query-cache expiry; the store is thrown away only when it grows absurd.
     * (`useStructureSearchApi`'s `searchCached` applies the same idea from the other
     * end: it is capped at MAX_SEARCHES = 50 buckets rather than expired by age.)
     *
     * WARNING: a wipe empties `itemList` / `pageItemList` / `selectedRecord`. Harmless
     * for a server-paginated UI (the incoming batch is stored right after, so the page
     * being rendered is intact), VISIBLE for an infinite-scroll UI that renders itemList
     * directly — there the list collapses to the last batch. Set 0 and prune manually
     * if that matters. At the default 100k (~20MB of plain records) it should never fire.
     *
     * Default `100_000`.
     */
    maxRecords?: number;

    /**
     * Inject a shared QueryClient instead of creating an internal one. Useful
     * when the consumer wants a single query client for the entire app.
     */
    queryClient?: QueryClient;

    /**
     * Read loading state from an external store instead of the hook's internal
     * ref-counted state.
     */
    getLoading?: (key?: string) => boolean;

    /**
     * Write loading state to an external store instead of the hook's internal
     * ref-counted state.
     */
    setLoading?: (key?: string, value?: boolean) => void;
}

export interface IWatchTargetSettings<T> extends IFetchSettings {
    onSuccess?: (item: T, id: string | number) => void;
    onError?: (error: unknown, id: string | number) => void;
    onSettled?: (item: T | undefined, error: unknown, id: string | number) => void;
}

// ─── Internal helpers (module-scope, framework-agnostic) ─────────────────

/**
 * TanStack Query rejects `undefined` as query data. Fetch methods here
 * legitimately resolve `undefined` (a 404, an absent record), so query
 * functions round-trip through this sentinel instead.
 */
const UNDEFINED_RESULT = Symbol('structure-rest-api/undefined-result');

const toSafeQueryFunction =
    <R>(apiCall: () => Promise<R>) =>
    async (): Promise<R | typeof UNDEFINED_RESULT> => {
        const result = await apiCall();
        return result === undefined ? UNDEFINED_RESULT : result;
    };

const fromSafeResult = <R>(result: R | typeof UNDEFINED_RESULT): R =>
    result === UNDEFINED_RESULT ? (undefined as R) : result;

const asItems = <T>(result: unknown): T[] =>
    (Array.isArray(result) ? result : [result]).filter((item): item is T => item !== undefined);

// ─── Hook ────────────────────────────────────────────────────────────────

/**
 * Custom hook that manages REST API state with TanStack Query integration.
 *
 * Wraps {@link useStructureDataManagement} and adds fetch/mutate methods backed
 * by a TanStack Query `QueryClient`: caching, request de-duplication,
 * staleness (TTL), and optimistic mutations with automatic rollback on failure.
 *
 * @param settings - Configuration for identifier extraction, caching, relationships
 */
export const useStructureRestApi = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number | symbol, any> = Record<string, any>,
    K extends string | number = Extract<keyof T, string | number>,
    P extends string | number = string | number
>(
    settings: IStructureRestApi = {}
) => {
    const dataManagement = useStructureDataManagement<T, K, P>(
        settings.identifiers ?? 'id',
        settings.delimiter ?? '|'
    );
    const {
        getRecordDictionary,
        createIdentifier,
        getRecord,
        addRecord,
        addRecords,
        editRecord,
        editRecords,
        deleteRecord,
        resetRecords,
        addToParent,
        removeDuplicateChildren
    } = dataManagement;

    // ─── QueryClient (own or injected) ───────────────────────────────────────

    const injectedClient = settings.queryClient;
    const instanceTtl = settings.TTL ?? 3_600_000;
    const internalClientRef = useRef<QueryClient | null>(null);
    /**
     * TanStack QueryClient — freshness, request de-duplication and revalidation engine.
     * A new instance is created per hook unless an external one is provided.
     *
     * OWNERSHIP (do not blur these two):
     *  - `itemDictionary` owns WHAT TO RENDER: synchronous, reactive, the only thing
     *    consumers read (getRecord / itemList / ...). Prune it with `resetRecords()`.
     *  - this cache owns WHEN TO FETCH: is an entry stale, is a request already in
     *    flight, should it retry. Nothing renders from it.
     *
     * An entry garbage-collected after `gcTime` only means "we forgot that this item
     * was fresh" — the next read refetches it. It must NEVER evict the item from the
     * dictionary: with no query observers (nothing here calls useQuery) every entry is
     * gc-eligible from birth, so `gcTime` must outlive the TTL, else an entry could be
     * collected while still fresh. `networkMode: 'always'` because the queryFn is the
     * caller's apiCall, not necessarily a network request — never pause it while offline.
     */
    const queryClient: QueryClient =
        injectedClient ??
        (internalClientRef.current ??= new QueryClient({
            defaultOptions: {
                queries: {
                    retry: false,
                    gcTime: Math.max(instanceTtl, 5 * 60 * 1000),
                    networkMode: 'always'
                }
            }
        }));

    useEffect(
        () => () => {
            if (!injectedClient) internalClientRef.current?.clear();
        },
        [injectedClient]
    );

    // ─── Instance settings ────────────────────────────────────────────────────

    const [fallbackLoadingKey] = useState(getUuid);
    const instanceLoadingKey = settings.loadingKey ?? fallbackLoadingKey;
    const maxRecordsLimit = settings.maxRecords ?? 100_000;
    const getEffectiveTtl = useCallback((ttl?: number) => ttl ?? instanceTtl, [instanceTtl]);

    // settings.getLoading/setLoading read through a ref so startLoading/stopLoading
    // stay referentially stable across renders regardless of an inline object literal
    // being passed as `settings` from the caller.
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    // ─── Query key builders ────────────────────────────────────────────────────
    // Namespaced by instanceLoadingKey so two hook instances sharing one
    // QueryClient but different loadingKeys never share cache buckets.

    const targetKey = useCallback(
        (id: K, lastUpdateKey = ''): QueryKey => [instanceLoadingKey, 'target', id, lastUpdateKey],
        [instanceLoadingKey]
    );
    const listKey = useCallback(
        (lastUpdateKey = ''): QueryKey => [instanceLoadingKey, 'list', lastUpdateKey],
        [instanceLoadingKey]
    );
    const parentKeyFor = useCallback(
        (parentId: P): QueryKey => [instanceLoadingKey, 'parent', parentId],
        [instanceLoadingKey]
    );
    const anyKey = useCallback(
        (lastUpdateKey: string): QueryKey => [instanceLoadingKey, 'any', lastUpdateKey],
        [instanceLoadingKey]
    );
    const paginateKey = useCallback(
        (lastUpdateKey: string, page: number, pageSize: number): QueryKey => [
            instanceLoadingKey,
            'paginate',
            lastUpdateKey,
            page,
            pageSize
        ],
        [instanceLoadingKey]
    );

    /**
     * Returns true when the TanStack cache entry for the given key is still
     * within its stale window (i.e. data age < ttl).
     */
    const isFresh = useCallback(
        (key: QueryKey, ttl: number): boolean => {
            const dataUpdatedAt = queryClient.getQueryState(key)?.dataUpdatedAt;
            return !!dataUpdatedAt && Date.now() - dataUpdatedAt < ttl;
        },
        [queryClient]
    );

    const seedTarget = useCallback(
        (id: K, data: T, lastUpdateKey = '') =>
            queryClient.setQueryData(targetKey(id, lastUpdateKey), data),
        [queryClient, targetKey]
    );

    // ─── Loading (ref-counted; a ref, not state, so `loading` is always
    // synchronously accurate — including mid-call, from inside apiCall itself) ──

    const loadingCountsRef = useRef<Record<string, number>>({});
    const [, bumpLoadingVersion] = useState(0);

    const startLoading = useCallback(
        (key?: string) => {
            const bucket = key ? `${instanceLoadingKey}${key}` : instanceLoadingKey;
            const counts = loadingCountsRef.current;
            counts[bucket] = (counts[bucket] ?? 0) + 1;
            if (counts[bucket] === 1) {
                settingsRef.current.setLoading?.(bucket, true);
                bumpLoadingVersion((v) => v + 1);
            }
        },
        [instanceLoadingKey]
    );

    const stopLoading = useCallback(
        (key?: string) => {
            const bucket = key ? `${instanceLoadingKey}${key}` : instanceLoadingKey;
            const counts = loadingCountsRef.current;
            counts[bucket] = Math.max((counts[bucket] ?? 0) - 1, 0);
            if (counts[bucket] === 0) {
                settingsRef.current.setLoading?.(bucket, false);
                bumpLoadingVersion((v) => v + 1);
            }
        },
        [instanceLoadingKey]
    );

    const resetLoading = useCallback(() => {
        loadingCountsRef.current = {};
        bumpLoadingVersion((v) => v + 1);
    }, []);

    // ─── Ingestion (maxRecords-aware wrapper over addRecords/editRecords) ────

    const ingestMany = useCallback(
        (items: T[], { merge = false }: { merge?: boolean } = {}) => {
            if (items.length === 0) return;
            // Counted off the LIVE dictionary, not a per-render snapshot: several
            // ingests can land in one tick (a fetchAll seeding targets, a watcher
            // firing alongside it) and a stale count would let the store sail past
            // maxRecords. Critical mass only — nothing is dropped for being stale,
            // since stale records are the ones keeping the UI populated while fresher
            // data is on its way. Past maxRecords the whole store goes, and the batch
            // below immediately repopulates it, so the freshest items always survive.
            if (
                maxRecordsLimit > 0 &&
                Object.keys(getRecordDictionary()).length + items.length > maxRecordsLimit
            ) {
                resetRecords();
            }
            if (merge) editRecords(items);
            else addRecords(items);
        },
        [maxRecordsLimit, getRecordDictionary, resetRecords, editRecords, addRecords]
    );

    const ingestOne = useCallback(
        (item: T, options: { merge?: boolean } = {}) => ingestMany([item], options),
        [ingestMany]
    );

    /**
     * Public store-writing helper, mirroring the routine the fetch* methods use:
     * writes each item into the local store (add, or merge fields into the existing
     * one when `merge` is true), enforcing maxRecords first so the incoming (freshest)
     * items always survive the wipe. `onSave` runs per stored item for extra
     * bookkeeping (e.g. seeding the per-item target cache). Skips `undefined` entries
     * and returns `items` unchanged.
     *
     * @param items
     * @param merge - true: merge fields into the existing record, false: replace
     * @param onSave - customized single-item operation
     */
    const saveRecords = useCallback(
        (
            items: (T | undefined)[] = [],
            merge = false,
            onSave?: (item: T) => void
        ): (T | undefined)[] => {
            const defined = items.filter((item): item is T => !!item);
            ingestMany(defined, { merge });
            if (onSave) for (const item of defined) onSave(item);
            return items;
        },
        [ingestMany]
    );

    /** Replace (not merge) the record at `id`, overriding its derived identifier. */
    const replaceRecord = useCallback(
        (data: T, id: K) => {
            deleteRecord(id);
            editRecord(data, id);
        },
        [deleteRecord, editRecord]
    );

    // ─── check* (pre-flight freshness — synchronous, mirrors each fetch*'s key) ─
    //
    // "Would this call be served from cache, or would it hit the network?" — answered
    // synchronously, without calling apiCall or touching loading state. Each check builds
    // the exact query key its fetch* counterpart uses, so an entry reported fresh here is
    // the same entry that fetch* would reuse instead of refetching.
    //
    // There is no `forced` parameter: a forced call always fetches, so there is nothing
    // to check. Being synchronous, a check's result only holds until the next microtask
    // that might mutate the cache (e.g. an awaited fetch elsewhere) — treat it as advisory
    // for the immediate next call, not as a durable state to hold onto.

    /** Would `fetchTarget(apiCall, id, settings)` be served from cache? */
    const checkTarget = useCallback(
        (id: K, checkSettings: { TTL?: number; lastUpdateKey?: string } = {}): boolean =>
            isFresh(targetKey(id, checkSettings.lastUpdateKey), getEffectiveTtl(checkSettings.TTL)),
        [isFresh, targetKey, getEffectiveTtl]
    );

    /** Would `fetchAll(apiCall, settings)` be served from cache? */
    const checkAll = useCallback(
        (checkSettings: { TTL?: number } = {}): boolean =>
            isFresh(listKey(), getEffectiveTtl(checkSettings.TTL)),
        [isFresh, listKey, getEffectiveTtl]
    );

    /** Would `fetchByParent(apiCall, parentId, settings)` be served from cache? */
    const checkByParent = useCallback(
        (parentId: P, checkSettings: { TTL?: number } = {}): boolean =>
            isFresh(parentKeyFor(parentId), getEffectiveTtl(checkSettings.TTL)),
        [isFresh, parentKeyFor, getEffectiveTtl]
    );

    /**
     * Would `fetchAny(apiCall, settings)` be served from cache? Without a lastUpdateKey,
     * fetchAny never caches at all — always false, matching fetchAny's own rule.
     */
    const checkAny = useCallback(
        (lastUpdateKey?: string, checkSettings: { TTL?: number } = {}): boolean =>
            !!lastUpdateKey && isFresh(anyKey(lastUpdateKey), getEffectiveTtl(checkSettings.TTL)),
        [isFresh, anyKey, getEffectiveTtl]
    );

    /** Would `fetchPaginate(apiCall, page, pageSize, settings)` be served from cache? */
    const checkPaginate = useCallback(
        (
            page: number,
            pageSize: number,
            checkSettings: { TTL?: number; lastUpdateKey?: string } = {}
        ): boolean =>
            isFresh(
                paginateKey(checkSettings.lastUpdateKey ?? '', page, pageSize),
                getEffectiveTtl(checkSettings.TTL)
            ),
        [isFresh, paginateKey, getEffectiveTtl]
    );

    /**
     * Would `fetchMultiple(apiCall, ids, settings)` skip the network for some, all, or
     * none of the given ids? Mirrors fetchMultiple's own per-id split: cachedIds would
     * be served without a request, expiredIds would trigger the one batched apiCall
     * fetchMultiple makes to cover all of them.
     */
    const checkMultiple = useCallback(
        (ids: K[], checkSettings: { TTL?: number } = {}): { cachedIds: K[]; expiredIds: K[] } => {
            const cachedIds: K[] = [];
            const expiredIds: K[] = [];
            for (const id of ids)
                (checkTarget(id, checkSettings) ? cachedIds : expiredIds).push(id);
            return { cachedIds, expiredIds };
        },
        [checkTarget]
    );

    // ─── fetch* methods ───────────────────────────────────────────────────────

    /**
     * Generic fetch for all types of requests.
     * Just for loading management and optional TanStack-backed caching.
     * When no lastUpdateKey is supplied the call is always executed without caching.
     *
     * @param apiCall - call that we are going to make
     * @param fetchSettings - forced, loading, lastUpdateKey, loadingKey, TTL
     */
    const fetchAny = useCallback(
        async <R = unknown>(
            apiCall: () => Promise<R>,
            fetchSettings: IFetchSettings = {}
        ): Promise<R> => {
            const {
                loading: showLoading = true,
                loadingKey,
                forced,
                TTL: callTtl,
                lastUpdateKey
            } = fetchSettings;
            if (showLoading) startLoading(loadingKey);
            try {
                if (!lastUpdateKey) return await apiCall();
                const raw = await queryClient.fetchQuery({
                    queryKey: anyKey(lastUpdateKey),
                    queryFn: toSafeQueryFunction(apiCall),
                    staleTime: forced ? 0 : getEffectiveTtl(callTtl)
                });
                return fromSafeResult(raw);
            } finally {
                if (showLoading) stopLoading(loadingKey);
            }
        },
        [queryClient, anyKey, getEffectiveTtl, startLoading, stopLoading]
    );

    /**
     * Get ALL items from server.
     * Uses TanStack QueryClient for caching and freshness (staleTime = TTL).
     * When the cache is still fresh the apiCall is skipped entirely.
     *
     * @param apiCall
     * @param fetchSettings - forced (bypass cache), loading, merge, lastUpdateKey
     *                        (appended to the query key to namespace independent
     *                        cache entries), loadingKey, mismatch, TTL (per-call
     *                        staleTime override)
     */
    const fetchAll = useCallback(
        async <R = (T | undefined)[]>(
            apiCall: () => Promise<R>,
            fetchSettings: IFetchSettings = {}
        ): Promise<R> => {
            const {
                loading: showLoading = true,
                loadingKey,
                forced,
                TTL: callTtl,
                lastUpdateKey = '',
                mismatch = false,
                merge = false
            } = fetchSettings;
            if (showLoading) startLoading(loadingKey);
            try {
                const result = await queryClient.fetchQuery({
                    queryKey: listKey(lastUpdateKey),
                    queryFn: toSafeQueryFunction(apiCall),
                    staleTime: forced ? 0 : getEffectiveTtl(callTtl)
                });
                const items = asItems<T>(fromSafeResult(result));
                ingestMany(items, { merge });
                if (!mismatch) for (const item of items) seedTarget(createIdentifier(item), item);
                return fromSafeResult(result);
            } finally {
                if (showLoading) stopLoading(loadingKey);
            }
        },
        [
            queryClient,
            listKey,
            getEffectiveTtl,
            ingestMany,
            seedTarget,
            createIdentifier,
            startLoading,
            stopLoading
        ]
    );

    /**
     * Same as fetchAll, but with a parent identifier (belongsTo relationship).
     *
     * @param apiCall
     * @param parentId - identifier of parent
     *                   WARNING: in case of multiple identifiers, createIdentifier(id) must be used!
     * @param fetchSettings - forced, loading, merge, mismatch, TTL (per-call staleTime override)
     */
    const fetchByParent = useCallback(
        async <R = (T | undefined)[]>(
            apiCall: () => Promise<R>,
            parentId: P,
            fetchSettings: IFetchSettings = {}
        ): Promise<R> => {
            const {
                loading: showLoading = true,
                loadingKey,
                forced,
                TTL: callTtl,
                mismatch = false,
                merge = false
            } = fetchSettings;
            if (showLoading) startLoading(loadingKey);
            try {
                const result = await queryClient.fetchQuery({
                    queryKey: parentKeyFor(parentId),
                    queryFn: toSafeQueryFunction(apiCall),
                    staleTime: forced ? 0 : getEffectiveTtl(callTtl)
                });
                const items = asItems<T>(fromSafeResult(result));
                ingestMany(items, { merge: merge || mismatch });
                for (const item of items) {
                    const id = createIdentifier(item);
                    addToParent(parentId, id);
                    if (!mismatch) seedTarget(id, item);
                }
                removeDuplicateChildren(parentId);
                return fromSafeResult(result);
            } finally {
                if (showLoading) stopLoading(loadingKey);
            }
        },
        [
            queryClient,
            parentKeyFor,
            getEffectiveTtl,
            ingestMany,
            createIdentifier,
            addToParent,
            removeDuplicateChildren,
            seedTarget,
            startLoading,
            stopLoading
        ]
    );

    /**
     * Get target item from server.
     * Per-item freshness is tracked via the TanStack query key [instanceLoadingKey,
     * 'target', id, lastUpdateKey]. Shared by `fetchTarget` and `watchTarget`.
     *
     * @param apiCall
     * @param id - can be undefined if we don't know yet the id (always executes, uncached)
     *             WARNING: in case of multiple identifiers, createIdentifier(id) must be used!
     * @param fetchSettings - forced, loading, merge, lastUpdateKey, loadingKey, mismatch, TTL
     */
    const runFetchTarget = useCallback(
        async <R = T>(
            apiCall: () => Promise<R>,
            id: K | undefined,
            fetchSettings: IFetchSettings = {}
        ): Promise<R> => {
            const {
                loading: showLoading = true,
                loadingKey,
                forced,
                TTL: callTtl,
                lastUpdateKey = '',
                mismatch = false,
                merge = false
            } = fetchSettings;
            if (showLoading) startLoading(loadingKey);
            try {
                let result: R;
                if (id === undefined) {
                    result = await apiCall();
                } else {
                    try {
                        result = fromSafeResult<R>(
                            await queryClient.fetchQuery({
                                queryKey: targetKey(id, lastUpdateKey),
                                queryFn: toSafeQueryFunction(apiCall),
                                staleTime: forced ? 0 : getEffectiveTtl(callTtl)
                            })
                        );
                    } catch (error: unknown) {
                        // A concurrent updateTarget/deleteTarget cancels this in-flight
                        // fetch to apply its own newer value first. That is NOT a failure:
                        // the caller just gets whatever is currently cached (their own
                        // optimistic edit already won) instead of an error. Any other
                        // error is a real failure and propagates.
                        if (!(error instanceof CancelledError)) throw error;
                        result = fromSafeResult<R>(
                            queryClient.getQueryData(targetKey(id, lastUpdateKey)) as
                                | R
                                | typeof UNDEFINED_RESULT
                        );
                    }
                }

                if (result !== undefined) {
                    ingestOne(result as unknown as T, { merge });
                    // When `id` was given, the fetchQuery call above already seeded
                    // targetKey(id, lastUpdateKey) — seeding again here would always
                    // write the DEFAULT ('') bucket on top, collapsing every
                    // lastUpdateKey back into one. Only the id-less path (no query key
                    // to seed up front) needs an explicit seed once the id is known.
                    if (id === undefined && !mismatch) {
                        seedTarget(
                            createIdentifier(result as unknown as T),
                            result as unknown as T,
                            lastUpdateKey
                        );
                    }
                }
                return result;
            } finally {
                if (showLoading) stopLoading(loadingKey);
            }
        },
        [
            queryClient,
            targetKey,
            getEffectiveTtl,
            ingestOne,
            seedTarget,
            createIdentifier,
            startLoading,
            stopLoading
        ]
    );

    const fetchTarget = useCallback(
        <R = T>(apiCall: () => Promise<R>, id?: K, fetchSettings?: IFetchSettings): Promise<R> =>
            runFetchTarget(apiCall, id, fetchSettings),
        [runFetchTarget]
    );

    /**
     * Fetch multiple items by id, batching only the ones that are stale.
     * Items with a fresh TanStack cache entry are returned immediately without
     * hitting the network; expired items are requested via a single apiCall.
     *
     * @param apiCall
     * @param ids - Array of ids
     *              WARNING: in case of multiple identifiers, createIdentifier(id) must be used!
     * @param fetchSettings - forced, loading, loadingKey, TTL (per-call staleTime override)
     */
    const fetchMultiple = useCallback(
        async (
            apiCall: (ids: K[]) => Promise<(T | undefined)[]>,
            ids: K[] = [],
            fetchSettings: IFetchSettings = {}
        ): Promise<(T | undefined)[]> => {
            if (ids.length === 0) return [];
            const { loading: showLoading = true, loadingKey, forced, TTL: callTtl } = fetchSettings;
            const { expiredIds } = forced
                ? { expiredIds: ids }
                : checkMultiple(ids, { TTL: callTtl });

            if (expiredIds.length > 0) {
                if (showLoading) startLoading(loadingKey);
                try {
                    const items = asItems<T>(await apiCall(expiredIds));
                    ingestMany(items);
                    for (const item of items) seedTarget(createIdentifier(item), item);
                } finally {
                    if (showLoading) stopLoading(loadingKey);
                }
            }
            // getRecord reads the live dictionary, so the items ingested just above
            // are already visible here alongside the ones this call never touched.
            return ids.map((id) => getRecord(id));
        },
        [
            checkMultiple,
            ingestMany,
            seedTarget,
            createIdentifier,
            getRecord,
            startLoading,
            stopLoading
        ]
    );

    /**
     * fetchAll, one server-paginated page at a time. This is a generic paginated
     * fetch, not a search — apiCall resolves with plain items. A caller that also
     * needs a server-reported total (e.g. useStructureSearchApi.fetchSearch) reads
     * it out of its own apiCall wrapper; this hook has nothing to do with it.
     *
     * @param apiCall
     * @param page
     * @param pageSize - page size used for caching
     * @param fetchSettings - forced, loading, merge, lastUpdateKey (namespaces independent
     *                        cache buckets, e.g. per filter set), loadingKey, mismatch, TTL
     */
    const fetchPaginate = useCallback(
        async <R = (T | undefined)[]>(
            apiCall: () => Promise<R>,
            page: number,
            pageSize: number,
            fetchSettings: IFetchSettings = {}
        ): Promise<R> => {
            const {
                loading: showLoading = true,
                loadingKey,
                forced,
                TTL: callTtl,
                lastUpdateKey = '',
                mismatch = false,
                merge = false
            } = fetchSettings;
            if (showLoading) startLoading(loadingKey);
            try {
                const result = await queryClient.fetchQuery({
                    queryKey: paginateKey(lastUpdateKey, page, pageSize),
                    queryFn: toSafeQueryFunction(apiCall),
                    staleTime: forced ? 0 : getEffectiveTtl(callTtl)
                });
                const items = asItems<T>(fromSafeResult(result));
                ingestMany(items, { merge });
                if (!mismatch) for (const item of items) seedTarget(createIdentifier(item), item);
                return fromSafeResult(result);
            } finally {
                if (showLoading) stopLoading(loadingKey);
            }
        },
        [
            queryClient,
            paginateKey,
            getEffectiveTtl,
            ingestMany,
            seedTarget,
            createIdentifier,
            startLoading,
            stopLoading
        ]
    );

    // ─── CRUD mutations with optimistic updates ───────────────────────────────

    /**
     * Mark every 'list' / 'paginate' / 'parent' query of this hook as stale.
     *
     * There are no live query observers here (nothing calls useQuery), so this only
     * flips each entry's isInvalidated flag — it does NOT trigger a request by itself.
     * The next explicit fetchAll/fetchPaginate/fetchByParent is what actually refetches,
     * via fetchQuery picking up the invalidated flag.
     *
     * Called after createTarget/deleteTarget succeed: a created or deleted record
     * changes what a list-shaped fetch should return, even though the record's own
     * data is already correct in itemDictionary/target cache regardless.
     */
    const invalidateListQueries = useCallback(() => {
        // Fire-and-forget: with no live observers this only flips the invalidated
        // flag synchronously; the returned promise settles once refetches (there are
        // none) complete, so there is nothing to await.
        void queryClient.invalidateQueries({
            predicate: (query) => {
                const [lk, kind] = query.queryKey as [string, string];
                return (
                    lk === instanceLoadingKey &&
                    (kind === 'list' || kind === 'paginate' || kind === 'parent')
                );
            }
        });
    }, [queryClient, instanceLoadingKey]);

    /**
     * dummyData: Create data immediately and then update it later
     * when the server returns the real data
     *
     * @param apiCall
     * @param dummyData
     * @param fetchSettings - loading, loadingKey, fetchLike (seed the target cache, default true)
     */
    const createTarget = useCallback(
        async <R = T>(
            apiCall: () => Promise<R>,
            dummyData?: Partial<T>,
            fetchSettings: IFetchSettings = {}
        ): Promise<R> => {
            const { loading: showLoading = true, loadingKey, fetchLike = true } = fetchSettings;

            const dummyId = dummyData === undefined ? undefined : createIdentifier(dummyData as T);
            if (dummyData !== undefined) ingestOne(dummyData as T);

            if (showLoading) startLoading(loadingKey);
            try {
                const result = await apiCall();
                if (dummyId !== undefined) deleteRecord(dummyId);
                if (result !== undefined) {
                    const id = createIdentifier(result as unknown as T);
                    ingestOne(result as unknown as T);
                    if (fetchLike) seedTarget(id, result as unknown as T);
                    // A new record can belong in cached lists that don't know about it yet
                    invalidateListQueries();
                }
                return result;
            } catch (error: unknown) {
                if (dummyId !== undefined) deleteRecord(dummyId);
                throw error;
            } finally {
                if (showLoading) stopLoading(loadingKey);
            }
        },
        [
            createIdentifier,
            ingestOne,
            deleteRecord,
            seedTarget,
            invalidateListQueries,
            startLoading,
            stopLoading
        ]
    );

    /**
     * Update an existing record
     *
     * @param apiCall
     * @param itemData
     * @param id - WARNING: in case of multiple identifiers, createIdentifier(id) must be used!
     * @param fetchSettings - loading, merge, loadingKey, fetchLike (seed the target cache,
     *                        default true), fetchAgain (apply the response as the record's
     *                        new data, default true)
     */
    const updateTarget = useCallback(
        async <R = T>(
            apiCall: () => Promise<R>,
            itemData: Partial<T>,
            id: K,
            fetchSettings: IFetchSettings = {}
        ): Promise<R> => {
            const {
                loading: showLoading = true,
                loadingKey,
                merge = false,
                fetchLike = true,
                fetchAgain = true
            } = fetchSettings;

            const rollbackSnapshot = getRecord(id);
            const optimisticRecord = { ...rollbackSnapshot, ...itemData } as T;

            // Cancel any in-flight fetchTarget for this id (all lastUpdateKey buckets)
            // BEFORE the optimistic edit: otherwise an older response could resolve
            // afterwards and clobber it with pre-update data. Mirrors TanStack's
            // optimistic-update recipe (cancelQueries before the optimistic write).
            await queryClient.cancelQueries({ queryKey: [instanceLoadingKey, 'target', id] });

            editRecord(itemData, id);

            if (showLoading) startLoading(loadingKey);
            try {
                const result = await apiCall();
                if (result !== undefined) {
                    // fetchAgain=false: the response isn't the full item (e.g. a bare
                    // acknowledgement), so keep the optimistic edit as the final record.
                    let finalRecord = optimisticRecord;
                    if (fetchAgain) {
                        finalRecord = merge
                            ? ({ ...optimisticRecord, ...result } as T)
                            : (result as unknown as T);
                        if (merge) editRecord(result as Partial<T>, id);
                        else replaceRecord(finalRecord, id);
                    }
                    if (fetchLike) seedTarget(id, finalRecord);
                }
                return result;
            } catch (error: unknown) {
                if (rollbackSnapshot === undefined) {
                    deleteRecord(id);
                } else {
                    replaceRecord(rollbackSnapshot, id);
                }
                throw error;
            } finally {
                if (showLoading) stopLoading(loadingKey);
            }
        },
        [
            getRecord,
            editRecord,
            replaceRecord,
            deleteRecord,
            seedTarget,
            queryClient,
            instanceLoadingKey,
            startLoading,
            stopLoading
        ]
    );

    /**
     * @param apiCall
     * @param id - WARNING: in case of multiple identifiers, createIdentifier(id) must be used!
     * @param fetchSettings - loading, loadingKey
     */
    const deleteTarget = useCallback(
        async <R = unknown>(
            apiCall: () => Promise<R>,
            id: K,
            fetchSettings: IFetchSettings = {}
        ): Promise<R> => {
            const { loading: showLoading = true, loadingKey } = fetchSettings;
            const rollbackSnapshot = getRecord(id);

            // Cancel any in-flight fetchTarget for this id first, same reasoning as
            // updateTarget: an older response resolving after the delete below would
            // re-add stale data.
            await queryClient.cancelQueries({ queryKey: [instanceLoadingKey, 'target', id] });

            deleteRecord(id);
            queryClient.removeQueries({ queryKey: [instanceLoadingKey, 'target', id] });

            if (showLoading) startLoading(loadingKey);
            try {
                const result = await apiCall();
                // Cached lists may still list this id; make them refetch next time
                invalidateListQueries();
                return result;
            } catch (error: unknown) {
                if (rollbackSnapshot !== undefined) addRecord(rollbackSnapshot);
                throw error;
            } finally {
                if (showLoading) stopLoading(loadingKey);
            }
        },
        [
            getRecord,
            deleteRecord,
            queryClient,
            instanceLoadingKey,
            addRecord,
            invalidateListQueries,
            startLoading,
            stopLoading
        ]
    );

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Wipe the client store's records and this hook's ref-counted loading state.
     *
     * Does not touch the TanStack cache: its entries stay valid and a later fetch
     * repopulates the dictionary from them without hitting the network.
     *
     * NOTE for callers layering their own id-indexed bookkeeping on top of this
     * hook (e.g. useStructureSearchApi's searchCached): dropping records here
     * leaves THEIR ids dangling, and getRecords() silently filters those out. If you
     * built a searchApi on top of this instance, also call its resetSearches() when
     * you call this (or destroy()).
     */
    const resetAll = useCallback(() => {
        resetRecords();
        resetLoading();
    }, [resetRecords, resetLoading]);

    /**
     * Tear down this hook: for a client this hook created, clear it (removing every
     * query and cancelling the background gc timers) so nothing leaks after the
     * owner is gone. Also resets the item dictionary and loading state, since their
     * lifetime is meant to track this hook's usage.
     *
     * Not called automatically on unmount (only the internally-created QueryClient
     * itself is, via the effect above) — call `destroy()` yourself, typically from
     * your own `useEffect` cleanup, when you want a full manual teardown.
     *
     * @param forced - also clear an externally-provided queryClient (normally left alone)
     */
    const destroy = useCallback(
        (forced = false) => {
            resetRecords();
            resetLoading();
            if (!injectedClient || forced) queryClient.clear();
        },
        [resetRecords, resetLoading, injectedClient, queryClient]
    );

    // ─── Return public API ────────────────────────────────────────────────────

    return {
        // inherited from useStructureDataManagement
        ...dataManagement,

        // settings
        loadingKey: instanceLoadingKey,
        maxRecords: maxRecordsLimit,

        // TanStack QueryClient
        queryClient,

        // lifecycle
        resetAll,
        destroy,

        // loading
        get loading() {
            return settings.getLoading
                ? !!settings.getLoading(instanceLoadingKey)
                : (loadingCountsRef.current[instanceLoadingKey] ?? 0) > 0;
        },
        startLoading,
        stopLoading,

        // store writes
        saveRecords,

        // fetch
        fetchAny,
        fetchAll,
        fetchByParent,
        fetchTarget,
        fetchMultiple,
        fetchPaginate,

        // mutate
        createTarget,
        updateTarget,
        deleteTarget,

        // pre-flight freshness checks
        checkTarget,
        checkAll,
        checkByParent,
        checkAny,
        checkPaginate,
        checkMultiple
    };
};

// ─── useWatchTarget ────────────────────────────────────────────────────────

/**
 * fetchTarget's reactive counterpart — the React-first equivalent of a Vue
 * `watch(idSource, ...)`. Give it the CURRENT id VALUE (state or prop, NOT a ref):
 * a `useEffect` keyed on that id re-runs `fetchTarget` the instant it changes,
 * selecting the record as it goes. This is why it is a hook, not a method on the
 * api object: only a value React re-renders on can drive a `useEffect`, whereas a
 * mutable ref would force polling to notice changes.
 *
 * A nullish id is a no-op. onSuccess/onError/onSettled fire with the item/error and
 * id; a change (or unmount) mid-flight suppresses the previous run's late callbacks.
 *
 *     const [userId, setUserId] = useState<number>();
 *     const api = useStructureRestApi<IUser, number>({ identifiers: 'id' });
 *     useWatchTarget(api, userId, (id) => fetchUser(id), { onSuccess });
 *
 * @param api      - a useStructureRestApi instance (for fetchTarget + setSelectedIdentifier)
 * @param id       - the id to fetch/select; the effect re-runs whenever it changes
 * @param apiCall  - id-parametrized fetch
 * @param settings - forwarded to fetchTarget (forced, loading, merge, TTL, ...), plus
 *                   onSuccess/onError/onSettled lifecycle callbacks
 */
export const useWatchTarget = <
    K extends string | number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number | symbol, any> = Record<string, any>,
    R = T
>(
    api: Pick<
        ReturnType<typeof useStructureRestApi<T, K>>,
        'fetchTarget' | 'setSelectedIdentifier'
    >,
    id: K | undefined | null,
    apiCall: (id: K) => Promise<R>,
    settings: IWatchTargetSettings<R> = {}
): void => {
    const { fetchTarget, setSelectedIdentifier } = api;

    // Latest apiCall/settings without making them effect dependencies: only an
    // actual id change (or a new api instance) should re-run the fetch.
    const latestRef = useRef({ apiCall, settings });
    latestRef.current = { apiCall, settings };

    useEffect(() => {
        if (id === undefined || id === null) return;
        setSelectedIdentifier(id);

        let cancelled = false;
        const { apiCall: call, settings: options } = latestRef.current;
        const { onSuccess, onError, onSettled, ...fetchSettings } = options;

        fetchTarget<R>(() => call(id), id, fetchSettings)
            .then((item) => {
                if (cancelled) return;
                onSuccess?.(item, id);
                onSettled?.(item, undefined, id);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                onError?.(error, id);
                onSettled?.(undefined, error, id);
            });

        // A newer id (or unmount) suppresses this run's late-arriving callbacks.
        return () => {
            cancelled = true;
        };
    }, [id, fetchTarget, setSelectedIdentifier]);
};
