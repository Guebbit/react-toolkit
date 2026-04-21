import { computed, ref } from '../reactivity';
import { useStructureDataManagement } from './structureDataManagement';

/**
 * Ideas:
 *  - Create a "check" method to know in advance if a fetch request will be denied and cache used
 */

/**
 * fetchSearch apiCall can return either a plain array or a tuple [items, total].
 * Both shapes are handled transparently — existing callers returning a plain array keep working.
 */
export type SearchApiResult<T> = (T | undefined)[] | [(T | undefined)[], number];

/**
 * Fetch settings customization
 * If they are NOT set, default behavior will be used
 */
export interface IFetchSettings {
    /**
     * Ignore TTL and force the request anyway
     */
    forced?: boolean;

    /**
     * Enable loading during promises
     */
    loading?: boolean;

    /**
     * When I don't want to replace the data but merge it instead with the existing one
     * (replacing only the old fields with the new ones)
     *
     * This could happen because I use different fetches that return different fields for the same item
     *
     * Example:
     * I could have a fetch call with custom lastUpdateKey that retrieves a list of items that I have already and maybe with a valid TTL.
     * Without merge I would just refresh like a  soft-forced. With merge I can update the items with new data
     */
    merge?: boolean;

    /**
     * TTL for this specific request.
     * Example: if you set a 10 min TTL instead of the default 1 hour,
     * the data will be considered "stale" after 10 minutes
     * and a new request will be made to refresh it
     */
    TTL?: number;

    /**
     * Replace the key used for TTL management
     * (It will still have the unique prefix)
     */
    lastUpdateKey?: string;

    /**
     * Change the key used for loading management
     */
    loadingKey?: string;

    /**
     * When true, skip updating the per-item TARGET TTL after saving fetched records.
     * Use when the fetch returns partial data that should not reset the item's own cache validity.
     */
    mismatch?: boolean;
}

/**
 * Time To Live and Last Update
 * Optimize fetch requests by caching data and preventing unnecessary requests
 */
export enum ELastUpdateKeywords {
    ALL = '_all',
    TARGET = '_target',
    PARENT = '_parent',
    ONLINE = '_online',
    GENERIC = '_generic'
}

/**
 * Stringified query => page => array if ids of the found products
 */
export type ISearchCache<K = string | number> = Record<string, Record<number, K[]>>;

/**
 * Composable customization settings
 */
export interface IStructureRestApi {
    // The identification parameter of the item (READONLY and not exported)
    // WARNING: ORDER SENSITIVE (if multiple). VERY IMPORTANT.
    identifiers?: string | string[];
    // Unique key for loading management (If falsy: doesn't update the global loading state)
    loadingKey?: string;
    // Time To Live for the various fetches
    TTL?: number;
    // Delimiter for multiple identifiers
    delimiter?: string;
    getLoading?: (key?: string) => boolean;
    setLoading?: (key?: string, value?: boolean) => void;
}

const isSafeObjectKey = (key: number | string) =>
    key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
const createSafeDictionary = <V>() => Object.create(null) as Record<string, V>;

export const useStructureRestApi = <
    // type of item
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number, any> = Record<string, any>,
    // type of item[identifier] (Extract only "string" or "number", because "symbol" is a pain to manage)
    K extends string | number = Extract<keyof T, string | number>,
    // type of parent[identifier], where the parent is in a relation "belogsTo" with an unknown data
    // WARNING: Typescript is not inferring correctly between different composables and use the default type
    P extends string | number = string | number
>({
    identifiers = 'id',
    loadingKey = crypto.randomUUID(),
    TTL = 3_600_000, // 1 hour
    delimiter = '|',
    getLoading,
    setLoading
}: IStructureRestApi = {}) => {
    /**
     * Inherited
     */
    const {
        createIdentifier,
        identifier: identifierKey,
        itemDictionary,
        itemList,
        setRecords,
        resetRecords,
        getRecord,
        getRecords,
        addRecord,
        addRecords,
        editRecord,
        deleteRecord,
        selectedIdentifier,
        selectedRecord,

        // Pagination
        pageCurrent,
        pageSize,
        pageTotal,
        pageOffset,
        pageItemList,

        // belongsTo relationship
        parentHasMany,
        addToParent,
        removeFromParent,
        removeDuplicateChildren,
        getRecordsByParent,
        getListByParent
    } = useStructureDataManagement<T, K, P>(identifiers, delimiter);

    /**
     * loadings
     */
    // loading mutators
    const startLoading = (postfix = '') =>
        loadingKey && setLoading ? setLoading(loadingKey + postfix, true) : (_loading.value = true);
    const stopLoading = (postfix = '') =>
        loadingKey && setLoading
            ? setLoading(loadingKey + postfix, false)
            : (_loading.value = false);
    // Check if it's loading
    const _loading = ref(false);
    const loading = computed(() => (getLoading ? getLoading(loadingKey) : _loading.value));

    /**
     *
     */
    const lastUpdate = {
        [ELastUpdateKeywords.ALL]: 0,
        [ELastUpdateKeywords.TARGET]: createSafeDictionary<number>() as Record<K, number>,
        [ELastUpdateKeywords.PARENT]: createSafeDictionary<number>() as Record<P, number>,
        [ELastUpdateKeywords.ONLINE]: createSafeDictionary<number>(),
        [ELastUpdateKeywords.GENERIC]: createSafeDictionary<number>()
    };

    /**
     * Reset cache age
     * @param branch
     */
    const resetLastUpdate = (branch?: ELastUpdateKeywords) => {
        if (branch === ELastUpdateKeywords.ALL) {
            lastUpdate[branch] = 0;
        } else if (branch) {
            // @ts-expect-error would be a pain to fully type and it's not needed
            lastUpdate[branch] = createSafeDictionary<number>();
        } else {
            lastUpdate[ELastUpdateKeywords.ALL] = 0;
            lastUpdate[ELastUpdateKeywords.TARGET] = createSafeDictionary<number>() as Record<
                K,
                number
            >;
            lastUpdate[ELastUpdateKeywords.PARENT] = createSafeDictionary<number>() as Record<
                P,
                number
            >;
            lastUpdate[ELastUpdateKeywords.ONLINE] = createSafeDictionary<number>();
            lastUpdate[ELastUpdateKeywords.GENERIC] = createSafeDictionary<number>();
        }
    };

    /**
     * Check if the last update was within the TTL
     * True = still valid
     *
     * @param key
     * @param branch
     */
    const getLastUpdate = (
        key: number | string = '',
        branch: ELastUpdateKeywords = ELastUpdateKeywords.GENERIC
    ) =>
        Date.now() -
            // if ELastUpdateKeywords.ALL I ignore the key
            (branch === ELastUpdateKeywords.ALL
                ? lastUpdate[ELastUpdateKeywords.ALL]
                : // @ts-expect-error too intricate to typesafe. It is safe.
                  lastUpdate[branch][key]) <
        TTL;

    /**
     * Check if the last update was within the TTL
     * True = still valid
     *
     * @param value
     * @param key
     * @param branch
     */
    const editLastUpdate = (
        value = 0,
        key: number | string = '',
        branch: ELastUpdateKeywords = ELastUpdateKeywords.GENERIC
    ) => {
        if (!isSafeObjectKey(key)) return;
        // if ELastUpdateKeywords.ALL I ignore the key
        if (branch === ELastUpdateKeywords.ALL) {
            lastUpdate[ELastUpdateKeywords.ALL] = value;
        } else {
            // @ts-expect-error too intricate to typesafe. It is safe.
            lastUpdate[branch][key] = value;
        }
    };

    /**
     * Same as getLastUpdate, but I update lastUpdate too
     * If it was invalid, I update it because I know I will update the data right after this check and return false.
     *
     * @param key
     * @param branch
     */
    const checkAndEditLastUpdate = (
        key: number | string = '',
        branch: ELastUpdateKeywords = ELastUpdateKeywords.GENERIC
    ) => {
        if (getLastUpdate(key, branch)) {
            return true;
        }
        editLastUpdate(Date.now(), key, branch);
        return false;
    };

    /**
     * Common save items routine on various fetches
     *
     * @param items
     * @param merge
     * @param onSave - customized single item operations
     */
    function saveRecords(items: (T | undefined)[] = [], merge = false, onSave?: (item: T) => void) {
        for (let i = 0, len = items.length; i < len; i++) {
            if (!items[i]) continue;
            if (merge) editRecord(items[i]);
            else addRecord(items[i]!);
            if (onSave) onSave(items[i]!);
        }
        return items;
    }

    /**
     * Generic fetch for all types of requests,
     * Just for loading management and generic TTL check.
     * WARNING: If a fetch request is cached, the promise chain WILL NOT BE APPLIED
     * WARNING: TTL fast response doesn't return anything since it's a generic fetch and doesn't know what to return
     *
     *
     * @key F - type of the response, that can be anything
     * @param asyncCall  - call that we are going to make
     * @param forced
     * @param loading
     * @param lastUpdateKey
     * @param loadingKey
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchAny = <F = any>(
        asyncCall: () => Promise<F>,
        {
            forced,
            loading = true,
            lastUpdateKey = '',
            loadingKey
        }: Omit<IFetchSettings, 'merge'> = {}
    ): Promise<F | undefined> => {
        // If TTL is not expired, the current stored data is still valid
        // If no TTL name is provided, we ignore the TTL altogether
        if (!forced && lastUpdateKey && checkAndEditLastUpdate(lastUpdateKey))
            // WARNING: We don't know what kind of data was about to be fetched, so it will be empty
            // eslint-disable-next-line unicorn/no-useless-undefined
            return Promise.resolve(undefined);

        //
        if (loading) startLoading(loadingKey);

        // actual request
        return asyncCall()
            .catch((error) => {
                // Reset TTL in case of error
                if (lastUpdateKey) editLastUpdate(0, lastUpdateKey);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    /**
     * Get ALL items from server
     * Example: fetchAll retrieve a list of items and fetchTarget retrieve a single item WITH DETAILS
     * WARNING: If a fetch request is cached, the promise chain WILL NOT BE APPLIED
     *
     * @param apiCall
     * @param forced
     * @param loading
     * @param merge
     * @param lastUpdateKey
     * @param loadingKey
     * @param mismatch - see IFetchSettings
     */
    const fetchAll = (
        apiCall: () => Promise<(T | undefined)[]>,
        {
            forced,
            loading = true,
            merge,
            lastUpdateKey = '',
            loadingKey,
            mismatch = false
        }: IFetchSettings = {}
    ): Promise<(T | undefined)[]> => {
        // If TTL is not expired, the current stored data is still valid
        // If the TTL name is provided: it becomes a GENERIC TTL check
        if (
            !forced &&
            (lastUpdateKey
                ? checkAndEditLastUpdate(lastUpdateKey)
                : checkAndEditLastUpdate('', ELastUpdateKeywords.ALL))
        )
            return Promise.resolve(itemList.value);

        if (loading) startLoading(loadingKey);

        // request
        return apiCall()
            .then((items = [] as (T | undefined)[]) => {
                return saveRecords(items, merge, (item) => {
                    if (!mismatch)
                        editLastUpdate(
                            Date.now(),
                            createIdentifier(item),
                            ELastUpdateKeywords.TARGET
                        );
                });
            })
            .catch((error: unknown) => {
                // Reset TTL in case of error
                editLastUpdate(0, lastUpdateKey, ELastUpdateKeywords.ALL);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    /**
     * Same as fetchAll, but with a parent identifier (belongsTo relationship)
     * WARNING: If a fetch request is cached, the promise chain WILL NOT BE APPLIED
     *
     * @param apiCall
     * @param parentId - identifier of parent
     *                   WARNING: in case of multiple identifiers, createIdentifier(id) must be used!
     * @param forced
     * @param loading
     * @param merge
     * @param lastUpdateKey
     * @param loadingKey
     * @param mismatch - see IFetchSettings
     */
    const fetchByParent = (
        apiCall: () => Promise<(T | undefined)[]>,
        parentId: P,
        {
            forced,
            loading = true,
            merge,
            lastUpdateKey = '',
            loadingKey,
            mismatch = false
        }: IFetchSettings = {}
    ): Promise<(T | undefined)[]> => {
        // If TTL is not expired, the current stored data is still valid
        if (!forced && checkAndEditLastUpdate(lastUpdateKey + parentId, ELastUpdateKeywords.PARENT))
            return Promise.resolve(getListByParent(parentId));

        if (loading) startLoading(loadingKey);

        // request
        return apiCall()
            .then((items = [] as (T | undefined)[]) => {
                for (let i = 0, len = items.length; i < len; i++) {
                    if (!items[i]) continue;
                    addToParent(parentId, createIdentifier(items[i]!) as string);

                    // if mismatch, we don't want to overwrite the fetchTarget's item so we merge
                    if (merge || mismatch) editRecord(items[i]);
                    else addRecord(items[i]!);

                    // If no mismatch, we can update the target's lastUpdate too
                    if (!mismatch)
                        editLastUpdate(
                            Date.now(),
                            createIdentifier(items[i]!),
                            ELastUpdateKeywords.TARGET
                        );
                }
                removeDuplicateChildren(parentId);
                return items;
            })
            .catch((error: unknown) => {
                // Reset TTL in case of error
                editLastUpdate(0, lastUpdateKey + parentId, ELastUpdateKeywords.PARENT);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    /**
     * Get target item from server
     * WARNING: If a fetch request is cached, the promise chain WILL NOT BE APPLIED
     *
     * @param apiCall
     * @param id - can be undefined if we don't know yet the id, no TTL check will be done thought
     *             WARNING: in case of multiple identifiers, createIdentifier(id) must be used!
     * @param forced
     * @param loading
     * @param merge
     * @param lastUpdateKey
     * @param loadingKey
     */
    const fetchTarget = (
        apiCall: () => Promise<T | undefined>,
        id?: K,
        { forced, loading = true, merge, lastUpdateKey = '', loadingKey }: IFetchSettings = {}
    ): Promise<T | undefined> => {
        // If TTL is not expired, the current stored data is still valid
        // (if id is not provided, we must force through the request)
        if (id && !forced && checkAndEditLastUpdate(lastUpdateKey + id, ELastUpdateKeywords.TARGET))
            return Promise.resolve(getRecord(id));

        if (loading) startLoading(loadingKey);

        // request
        return apiCall()
            .then(
                (item: T | undefined) =>
                    saveRecords([item], merge, (item) => {
                        // in case it wasn't provided the id, we must update the lastUpdate now
                        editLastUpdate(
                            Date.now(),
                            lastUpdateKey + createIdentifier(item),
                            ELastUpdateKeywords.TARGET
                        );
                    })[0]
            )
            .catch((error: unknown) => {
                // Reset TTL in case of error
                if (id) editLastUpdate(0, lastUpdateKey + id, ELastUpdateKeywords.TARGET);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    /**
     * Fetch target but with multiple ids
     * WARNING: If a fetch request is cached, the promise chain WILL NOT BE APPLIED
     *
     * @param apiCall
     * @param ids - Array of ids - WARNING: in case of multiple identifiers, createIdentifier(id) must be used!     * @param forced
     * @param forced
     * @param loading
     * @param merge
     * @param loadingKey
     * @param lastUpdateKey
     */
    const fetchMultiple = (
        apiCall: () => Promise<(T | undefined)[]>,
        ids?: K[],
        { forced, loading = true, merge, loadingKey, lastUpdateKey = '' }: IFetchSettings = {}
    ): Promise<(T | undefined)[]> => {
        // nothing to search
        if (!ids || ids.length === 0) return Promise.resolve([]);

        let i: number;

        /**
         * expiredIds are Ids with TTL NOT expired, they will be fetched,
         * cachedIds will just get the already cached data
         */
        const expiredIds: K[] = [];
        const cachedIds: K[] = [];

        // Check which ids are expired and in need of fetch
        // REMEMBER: checkAndEditLastUpdate will set Date.now() to lastUpdate if "false",
        //  because all expired Ids will be renew just after this
        for (const id of ids) {
            if (forced || !checkAndEditLastUpdate(lastUpdateKey + id, ELastUpdateKeywords.TARGET))
                expiredIds.push(id);
            else cachedIds.push(id);
        }

        // items that I already have
        const cachedItems = cachedIds.map((id) => getRecord(id));

        // If no ids are expired, no need to make a fetch
        if (expiredIds.length === 0) return Promise.resolve(cachedItems);

        if (loading) startLoading(loadingKey);

        // request
        return apiCall()
            .then((items = [] as (T | undefined)[]) => {
                // return all requested items, even the already cached ones
                return [
                    ...saveRecords(items, merge, (item) => {
                        editLastUpdate(
                            Date.now(),
                            createIdentifier(item),
                            ELastUpdateKeywords.TARGET
                        );
                    }),
                    ...cachedItems
                ];
            })
            .catch((error: unknown) => {
                // Reset TTL in case of error
                for (i = expiredIds.length; i--; )
                    if (expiredIds[i]) editLastUpdate(0, expiredIds[i], ELastUpdateKeywords.TARGET);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    /**
     * Cached items ID divided per page, itemDictionary will hold the item data.
     * Stringified query => page => array if ids of the found products
     */
    const searchCached = ref<ISearchCache<K>>(createSafeDictionary());

    /**
     * Server-reported total count of matching items, keyed by cacheKey (same key as searchCached).
     * A value is only present when the apiCall returned the enriched { items, total } shape.
     */
    const searchTotals = ref<Record<string, number>>(createSafeDictionary());

    /**
     * Create a stable and always-the-same key from an object
     * @param object
     */
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const searchKeyGen = (object: object = {}) =>
        JSON.stringify(object, Object.keys(object).toSorted());

    /**
     * Get search page based on key, pageSize and page number
     * @param key - stringified search parameters
     * @param page - page
     * @param pageSize - page size (must match the value used in fetchSearch)
     */
    const searchGet = (key: string | object, page = 1, pageSize = 10) => {
        const searchKey = typeof key === 'string' ? key : searchKeyGen(key);
        return getRecords(searchCached.value[searchKey + ':' + pageSize]?.[page]);
    };

    /**
     * Return the server-reported total for a given search, or undefined if never received.
     * Pass the same filters and pageSize used in fetchSearch.
     */
    const searchGetTotal = (key: string | object, pageSize = 10): number | undefined => {
        const searchKey = typeof key === 'string' ? key : searchKeyGen(key);
        return searchTotals.value[searchKey + ':' + pageSize];
    };

    /**
     * Manually set the total for a given search (e.g. when the total comes from a separate API call).
     * fetchSearch sets this automatically when apiCall returns the { items, total } shape.
     */
    const searchSetTotal = (key: string | object, total: number, pageSize = 10): void => {
        const searchKey = typeof key === 'string' ? key : searchKeyGen(key);
        searchTotals.value[searchKey + ':' + pageSize] = total;
    };

    /**
     * I clean up all expired searches OR, if they are {MAX_SEARCHES}+, the old ones (too many resources on a minor feature)
     * Also prunes the searchCached entries whose keys are no longer referenced by any active TTL key.
     * TTL keys have the format: lastUpdateKey + cacheKey + ":" + page, where cacheKey = searchKey + ":" + pageSize.
     * We detect active cache keys by checking if any TTL key contains `cacheKey + ":"` as a substring.
     * This is safe because cacheKey ends with ":N" (a number) and we look for ":N:", which cannot match ":N0:" etc.
     * Assumes lastUpdateKey does not itself contain the cacheKey pattern (it's normally a plain string identifier).
     */
    const searchCleanup = () => {
        const MAX_SEARCHES = 50;

        // Remove expired data entries
        const validEntries = Object.entries(lastUpdate[ELastUpdateKeywords.ONLINE]).filter(
            ([_, ttl]) => ttl + TTL > Date.now()
        );

        // If there are too many valid entries, sort descending (newest first) so later the oldest will be trimmed
        if (validEntries.length > MAX_SEARCHES) validEntries.sort((a, b) => b[1] - a[1]);

        // rebuild lastUpdate. Remove the oldest entries if there are too many for resources reason
        lastUpdate[ELastUpdateKeywords.ONLINE] = Object.fromEntries(
            validEntries.slice(0, MAX_SEARCHES)
        );

        // Prune searchCached and searchTotals: remove entries no longer referenced by any active TTL key
        const activeTTLKeys = Object.keys(lastUpdate[ELastUpdateKeywords.ONLINE]);
        for (const cacheKey of Object.keys(searchCached.value)) {
            if (!activeTTLKeys.some((ttlKey) => ttlKey.includes(cacheKey + ':'))) {
                delete searchCached.value[cacheKey];
                delete searchTotals.value[cacheKey];
            }
        }
    };

    /**
     * Fetch items as a search.
     * Since we can't have a full picture of what the server has in terms of items and search parameters,
     * caching and optimizing need many extra steps.
     *
     * We will cache the items like normal BUT the TTL will be checked on the stringified search parameters.
     * In searchCached we will store the search divided in pages, where every page contains an array of item ids.
     *
     * Cache key structure: searchKey of filters + ":" + pageSize  (e.g. '{"q":"test"}:20')
     * TTL key structure: lastUpdateKey + cacheKey + ":" + page
     * Both page and pageSize must be part of the cache key because changing either one returns different items.
     * pageSize defaults to 0 (unknown/irrelevant) — pass it explicitly if the API accepts it.
     *
     * WARNING: If a fetch request is cached, the promise chain WILL NOT BE APPLIED
     *
     * @param apiCall
     * @param filters - search parameters
     * @param page - page number (used as cache dimension, not injected into apiCall automatically)
     * @param pageSize - page size used ONLY for caching purposes (if pageSize change, the cache is invalid)
     * @param forced
     * @param loading
     * @param merge
     * @param lastUpdateKey
     * @param loadingKey
     * @param mismatch
     */
    const fetchSearch = <F = object>(
        apiCall: () => Promise<SearchApiResult<T>>,
        filters: F = {} as F,
        page = 1,
        // Could be set in the filters directly but it could be forgotten so it's better to say it explicitly
        pageSize = 10,
        {
            forced,
            loading = true,
            merge,
            lastUpdateKey = '',
            loadingKey,
            mismatch = false
        }: IFetchSettings = {}
    ): Promise<(T | undefined)[]> => {
        // cacheKey groups all pages for the same (filters, pageSize) combination
        const searchKey = searchKeyGen(filters as object) + ':' + pageSize;
        const searchTTLkey = lastUpdateKey + searchKey + ':' + page;
        // Instead of regular checkAndEditLastUpdate, I clean up all expired searches and check if the ID is still present
        searchCleanup();
        // TTL is monodimensional so page and pageSize are added to the key (TTL ONLY)
        if (!forced && searchTTLkey in lastUpdate[ELastUpdateKeywords.ONLINE])
            return Promise.resolve(getRecords(searchCached.value[searchKey]?.[page]));
        // Then I manually save the TTL (since I'm not using checkAndEditLastUpdate shortcut)
        lastUpdate[ELastUpdateKeywords.ONLINE][searchTTLkey] = Date.now();

        if (loading) startLoading(loadingKey);

        // request
        return apiCall()
            .then((result) => {
                // Support both plain T[] and [T[], total] tuple shapes
                const isTuple = Array.isArray(result[0]);
                const items = (isTuple ? result[0] : result) as (T | undefined)[];
                if (isTuple)
                    searchSetTotal(
                        filters as object,
                        (result as [(T | undefined)[], number?])[1] ?? 0,
                        pageSize
                    );

                // Empty array to be filled with items ids
                if (!(searchKey in searchCached.value)) searchCached.value[searchKey] = [];
                searchCached.value[searchKey]![page] = [];

                saveRecords(items, merge, (item) => {
                    searchCached.value[searchKey]![page]!.push(createIdentifier(item));

                    if (!mismatch)
                        editLastUpdate(
                            Date.now(),
                            createIdentifier(item),
                            ELastUpdateKeywords.TARGET
                        );
                });

                return items;
            })
            .catch((error: unknown) => {
                // Reset TTL in case of error
                editLastUpdate(0, searchTTLkey, ELastUpdateKeywords.ONLINE);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    /**
     * fetchAll with pagination.
     * It works exactly as a fetchSearch without filters
     *
     * @param apiCall
     * @param page
     * @param pageSize
     * @param settings
     */
    const fetchPaginate = <F = object>(
        apiCall: () => Promise<SearchApiResult<T>>,
        page = 1,
        pageSize = 10,
        settings: IFetchSettings = {}
    ) => fetchSearch(apiCall, {}, page, pageSize, settings);

    /**
     * dummyData: Create data immediately and then update it later
     * when the server returns the real data
     *
     * @param apiCall
     * @param dummyData
     * @param loading
     * @param lastUpdateKey
     * @param loadingKey
     * @param fetchLike - data of the created item will be considered fetched like in fetchTarget
     */
    const createTarget = (
        apiCall: () => Promise<T | undefined>,
        dummyData?: T,
        {
            loading = true,
            lastUpdateKey = '',
            loadingKey
        }: Omit<IFetchSettings, 'forced' | 'merge'> = {},
        fetchLike = true
    ): Promise<T | undefined> => {
        const temporaryId = crypto.randomUUID();
        // Create temporary item with temporary id for instantaneity
        if (dummyData) editRecord(dummyData, temporaryId as K, true);
        if (loading) startLoading(loadingKey);
        // request
        return apiCall()
            .then((item: T | undefined) => {
                if (!item) return;
                const id = createIdentifier(item);

                // Remove the temporary item and add the real one
                if (dummyData) deleteRecord(temporaryId as K);

                addRecord(item);

                // If it can be treated as a fetchTarget
                if (fetchLike)
                    editLastUpdate(Date.now(), lastUpdateKey + id, ELastUpdateKeywords.TARGET);
                return getRecord(id);
            })
            .catch((error: unknown) => {
                // rollback
                deleteRecord(temporaryId as K);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    /**
     * Update an existing record
     *
     * @key F - type of the response, that can be something else than T
     * @param apiCall
     * @param itemData
     * @param id - if undefined it will be inferred
     *          WARNING: in case of multiple identifiers, createIdentifier(id) must be used!
     * @param loading
     * @param merge
     * @param lastUpdateKey
     * @param loadingKey
     * @param fetchLike - data will be considered fetched like in fetchTarget
     * @param fetchAgain - after the update, the call can return the updated item, update in this case (for consistency)
     */
    const updateTarget = <F = T>(
        apiCall: () => Promise<F | (T | undefined)[]>,
        itemData: Partial<T>,
        id?: K,
        {
            loading = true,
            merge,
            lastUpdateKey = '',
            loadingKey
        }: Omit<IFetchSettings, 'forced'> = {},
        fetchLike = true,
        fetchAgain = true
    ): Promise<F | (T | undefined)[]> => {
        // to be used in case of error and revert is needed
        const oldItemData = getRecord(id);

        // for instantaneity, but can be inconsistent
        editRecord(itemData, id, true);

        if (loading) startLoading(loadingKey);

        return (
            apiCall()
                // If the apiCall returns the updated item, editRecord will be called again to ensure data consistency
                .then((data) => {
                    if (fetchAgain) {
                        if (merge) editRecord(data as T, id);
                        else addRecord(data as T);
                    }

                    // If it can be treated as a fetchTarget
                    if (fetchLike || fetchAgain)
                        editLastUpdate(Date.now(), lastUpdateKey + id, ELastUpdateKeywords.TARGET);

                    return data;
                })
                .catch((error: unknown) => {
                    // Rollback in case of error
                    if (oldItemData) editRecord(oldItemData, id);
                    throw error;
                })
                .finally(() => loading && stopLoading(loadingKey))
        );
    };

    /**
     *
     * @key F - type of the response
     * @param apiCall
     * @param id - WARNING: in case of multiple identifiers, createIdentifier(id) must be used!
     * @param loading
     * @param loadingKey - custom loading key
     */
    const deleteTarget = <F = unknown>(
        apiCall: () => Promise<F>,
        id: K,
        { loading = true, loadingKey }: Pick<IFetchSettings, 'loading' | 'loadingKey'> = {}
    ): Promise<F> => {
        // in case revert is needed
        const oldItemData = getRecord(id);
        deleteRecord(id);
        if (loading) startLoading(loadingKey);
        return apiCall()
            .catch((error: unknown) => {
                // Rollback in case of error
                if (oldItemData) addRecord(oldItemData);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    return {
        // settings (default value could be necessary)
        createIdentifier,
        identifierKey,
        loadingKey,

        // core structure
        itemDictionary,
        itemList,

        setRecords,
        resetRecords,
        getRecord,
        getRecords,
        addRecord,
        addRecords,
        editRecord,
        deleteRecord,
        selectedIdentifier,
        selectedRecord,

        // Pagination
        pageCurrent,
        pageSize,
        pageTotal,
        pageOffset,
        pageItemList,

        // belongsTo relationship
        parentHasMany,
        addToParent,
        removeFromParent,
        removeDuplicateChildren,
        getRecordsByParent,
        getListByParent,

        // api calls
        startLoading,
        stopLoading,
        loading,
        lastUpdate,
        resetLastUpdate,
        getLastUpdate,
        editLastUpdate,
        checkAndEditLastUpdate,
        saveRecords,
        fetchAny,
        fetchAll,
        fetchByParent,
        fetchTarget,
        fetchMultiple,
        searchCached,
        searchTotals,
        searchKeyGen,
        searchGet,
        searchGetTotal,
        searchSetTotal,
        searchCleanup,
        fetchSearch,
        fetchPaginate,
        createTarget,
        updateTarget,
        deleteTarget
    };
};
