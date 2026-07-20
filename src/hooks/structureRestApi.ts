import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { QueryClient } from '@tanstack/query-core';
import type { QueryKey } from '@tanstack/query-core';
import { useStructureDataManagement } from './structureDataManagement';
import { generateFallbackValue } from '../utils/generateFallbackValue';

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
     * When true (default false) the fetched value is merged into the existing
     * record instead of replacing it wholesale — use when the response carries
     * only a subset of the record's fields.
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
}

export interface IStructureRestApi<
    K extends string | number,
    T,
    P extends string | number = string | number
> {
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
     * Critical-mass backstop on the store size: past this many records, the
     * entire store is wiped and immediately repopulated with the incoming
     * batch. `0` disables it. Default `100_000`.
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
    K extends string | number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number | symbol, any>,
    P extends string | number = string | number
>(
    settings: IStructureRestApi<K, T, P> = {}
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
        removeDuplicateChildren,
        setSelectedIdentifier
    } = dataManagement;

    // ─── QueryClient (own or injected) ───────────────────────────────────────

    const injectedClient = settings.queryClient;
    const internalClientRef = useRef<QueryClient | null>(null);
    const queryClient: QueryClient =
        injectedClient ??
        (internalClientRef.current ??= new QueryClient({
            defaultOptions: { queries: { retry: false, structuralSharing: false } }
        }));

    useEffect(
        () => () => {
            if (!injectedClient) internalClientRef.current?.clear();
        },
        [injectedClient]
    );

    // ─── Instance settings ────────────────────────────────────────────────────

    const [fallbackLoadingKey] = useState(generateFallbackValue);
    const instanceLoadingKey = settings.loadingKey ?? fallbackLoadingKey;
    const instanceTtl = settings.TTL ?? 3_600_000;
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

    /** Replace (not merge) the record at `id`, overriding its derived identifier. */
    const replaceRecord = useCallback(
        (data: T, id: K) => {
            deleteRecord(id);
            editRecord(data, id);
        },
        [deleteRecord, editRecord]
    );

    // ─── check* (pre-flight freshness — synchronous, mirrors each fetch*'s key) ─

    const checkTarget = useCallback(
        (id: K, checkSettings: { TTL?: number; lastUpdateKey?: string } = {}): boolean =>
            isFresh(targetKey(id, checkSettings.lastUpdateKey), getEffectiveTtl(checkSettings.TTL)),
        [isFresh, targetKey, getEffectiveTtl]
    );

    const checkAll = useCallback(
        (checkSettings: { TTL?: number } = {}): boolean =>
            isFresh(listKey(), getEffectiveTtl(checkSettings.TTL)),
        [isFresh, listKey, getEffectiveTtl]
    );

    const checkByParent = useCallback(
        (parentId: P, checkSettings: { TTL?: number } = {}): boolean =>
            isFresh(parentKeyFor(parentId), getEffectiveTtl(checkSettings.TTL)),
        [isFresh, parentKeyFor, getEffectiveTtl]
    );

    const checkAny = useCallback(
        (lastUpdateKey?: string, checkSettings: { TTL?: number } = {}): boolean =>
            !!lastUpdateKey && isFresh(anyKey(lastUpdateKey), getEffectiveTtl(checkSettings.TTL)),
        [isFresh, anyKey, getEffectiveTtl]
    );

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
                const result =
                    id === undefined
                        ? await apiCall()
                        : fromSafeResult<R>(
                              await queryClient.fetchQuery({
                                  queryKey: targetKey(id, lastUpdateKey),
                                  queryFn: toSafeQueryFunction(apiCall),
                                  staleTime: forced ? 0 : getEffectiveTtl(callTtl)
                              })
                          );

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

    // ─── watchTarget — polls a mutable id source, since a React ref (unlike a
    // Vue ref) is not itself reactive and cannot be a useEffect dependency ────

    const watchTarget = useCallback(
        <R = T>(
            idSource: RefObject<K | undefined>,
            apiCall: (id: K) => Promise<R>,
            watchSettings: IWatchTargetSettings<R> = {}
        ): (() => void) => {
            const { onSuccess, onError, onSettled, ...fetchSettings } = watchSettings;
            const effectiveTtl = getEffectiveTtl(fetchSettings.TTL);

            let lastId = idSource.current;

            const run = (id: K) => {
                runFetchTarget(() => apiCall(id), id, fetchSettings)
                    .then((item) => {
                        onSuccess?.(item, id);
                        onSettled?.(item, undefined, id);
                    })
                    .catch((error: unknown) => {
                        onError?.(error, id);
                        onSettled?.(undefined, error, id);
                    });
            };

            if (lastId !== undefined && lastId !== null) {
                setSelectedIdentifier(lastId);
                run(lastId);
            }

            const interval = setInterval(
                () => {
                    const currentId = idSource.current;
                    if (currentId === undefined || currentId === null) return;
                    if (currentId !== lastId) {
                        lastId = currentId;
                        setSelectedIdentifier(currentId);
                        run(currentId);
                        return;
                    }
                    if (!isFresh(targetKey(currentId), effectiveTtl)) run(currentId);
                },
                Math.max(50, effectiveTtl / 2)
            );

            return () => clearInterval(interval);
        },
        [runFetchTarget, isFresh, targetKey, getEffectiveTtl]
    );

    // ─── CRUD mutations with optimistic updates ───────────────────────────────

    const createTarget = useCallback(
        async <R = T>(
            apiCall: () => Promise<R>,
            dummyData?: Partial<T>,
            fetchSettings: IFetchSettings = {}
        ): Promise<R> => {
            const { loading: showLoading = true, loadingKey } = fetchSettings;

            const dummyId = dummyData === undefined ? undefined : createIdentifier(dummyData as T);
            if (dummyData !== undefined) ingestOne(dummyData as T);

            if (showLoading) startLoading(loadingKey);
            try {
                const result = await apiCall();
                if (dummyId !== undefined) deleteRecord(dummyId);
                if (result !== undefined) {
                    const id = createIdentifier(result as unknown as T);
                    ingestOne(result as unknown as T);
                    seedTarget(id, result as unknown as T);
                }
                return result;
            } catch (error: unknown) {
                if (dummyId !== undefined) deleteRecord(dummyId);
                throw error;
            } finally {
                if (showLoading) stopLoading(loadingKey);
            }
        },
        [createIdentifier, ingestOne, deleteRecord, seedTarget, startLoading, stopLoading]
    );

    const updateTarget = useCallback(
        async <R = T>(
            apiCall: () => Promise<R>,
            itemData: Partial<T>,
            id: K,
            fetchSettings: IFetchSettings = {}
        ): Promise<R> => {
            const { loading: showLoading = true, loadingKey, merge = false } = fetchSettings;

            const rollbackSnapshot = getRecord(id);
            const optimisticRecord = { ...rollbackSnapshot, ...itemData } as T;
            editRecord(itemData, id);

            if (showLoading) startLoading(loadingKey);
            try {
                const result = await apiCall();
                if (result !== undefined) {
                    const finalRecord = merge
                        ? ({ ...optimisticRecord, ...result } as T)
                        : (result as unknown as T);
                    if (merge) editRecord(result as Partial<T>, id);
                    else replaceRecord(finalRecord, id);
                    seedTarget(id, finalRecord);
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
        [getRecord, editRecord, replaceRecord, deleteRecord, seedTarget, startLoading, stopLoading]
    );

    const deleteTarget = useCallback(
        async <R = unknown>(
            apiCall: () => Promise<R>,
            id: K,
            fetchSettings: IFetchSettings = {}
        ): Promise<R> => {
            const { loading: showLoading = true, loadingKey } = fetchSettings;
            const rollbackSnapshot = getRecord(id);

            deleteRecord(id);
            queryClient.removeQueries({ queryKey: [instanceLoadingKey, 'target', id] });

            if (showLoading) startLoading(loadingKey);
            try {
                return await apiCall();
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
            startLoading,
            stopLoading
        ]
    );

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    const resetAll = useCallback(() => {
        resetRecords();
        resetLoading();
    }, [resetRecords, resetLoading]);

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

        // fetch
        fetchAny,
        fetchAll,
        fetchByParent,
        fetchTarget,
        fetchMultiple,
        fetchPaginate,
        watchTarget,

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
