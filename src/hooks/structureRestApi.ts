import { useMemo, useRef, useState } from 'react';
import { useStructureDataManagement } from './structureDataManagement';

export type SearchApiResult<T> = (T | undefined)[] | [(T | undefined)[], number];

export interface IFetchSettings {
    forced?: boolean;
    loading?: boolean;
    merge?: boolean;
    TTL?: number;
    lastUpdateKey?: string;
    loadingKey?: string;
    mismatch?: boolean;
}

export enum ELastUpdateKeywords {
    ALL = '_all',
    TARGET = '_target',
    PARENT = '_parent',
    ONLINE = '_online',
    GENERIC = '_generic'
}

export type ISearchCache<K = string | number> = Record<string, Record<number, K[]>>;

export interface IStructureRestApi {
    identifiers?: string | string[];
    loadingKey?: string;
    TTL?: number;
    delimiter?: string;
    getLoading?: (key?: string) => boolean;
    setLoading?: (key?: string, value?: boolean) => void;
}

type CacheMap<Key extends string | number = string | number> = Map<Key, number>;

const isSafeObjectKey = (key: number | string) =>
    key !== '__proto__' && key !== 'constructor' && key !== 'prototype';

const createSafeDictionary = <V>() => Object.create(null) as Record<string, V>;

export const useStructureRestApi = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number, any> = Record<string, any>,
    K extends string | number = Extract<keyof T, string | number>,
    P extends string | number = string | number
>({
    identifiers = 'id',
    loadingKey = crypto.randomUUID(),
    TTL = 3_600_000,
    delimiter = '|',
    getLoading,
    setLoading
}: IStructureRestApi = {}) => {
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
        setSelectedIdentifier,
        selectedRecord,
        pageCurrent,
        setPageCurrent,
        pageSize,
        setPageSize,
        pageTotal,
        pageOffset,
        pageItemList,
        parentHasMany,
        addToParent,
        removeFromParent,
        removeDuplicateChildren,
        getRecordsByParent,
        getListByParent
    } = useStructureDataManagement<T, K, P>(identifiers, delimiter);

    const [localLoading, setLocalLoading] = useState(false);
    const loading = useMemo(
        () => (getLoading ? getLoading(loadingKey) : localLoading),
        [getLoading, loadingKey, localLoading]
    );

    const startLoading = (postfix = '') =>
        loadingKey && setLoading ? setLoading(loadingKey + postfix, true) : setLocalLoading(true);

    const stopLoading = (postfix = '') =>
        loadingKey && setLoading ? setLoading(loadingKey + postfix, false) : setLocalLoading(false);

    const lastUpdateRef = useRef({
        [ELastUpdateKeywords.ALL]: 0,
        [ELastUpdateKeywords.TARGET]: new Map<K, number>(),
        [ELastUpdateKeywords.PARENT]: new Map<P, number>(),
        [ELastUpdateKeywords.ONLINE]: new Map<string, number>(),
        [ELastUpdateKeywords.GENERIC]: new Map<string, number>()
    });

    const [searchCached, setSearchCached] = useState<ISearchCache<K>>(createSafeDictionary());
    const [searchTotals, setSearchTotals] = useState<Record<string, number>>(createSafeDictionary());
    const searchCachedRef = useRef(searchCached);
    searchCachedRef.current = searchCached;

    const resetLastUpdate = (branch?: ELastUpdateKeywords) => {
        const lastUpdate = lastUpdateRef.current;
        if (branch === ELastUpdateKeywords.ALL) {
            lastUpdate[branch] = 0;
        } else if (branch) {
            lastUpdate[branch] = new Map();
        } else {
            lastUpdate[ELastUpdateKeywords.ALL] = 0;
            lastUpdate[ELastUpdateKeywords.TARGET] = new Map<K, number>();
            lastUpdate[ELastUpdateKeywords.PARENT] = new Map<P, number>();
            lastUpdate[ELastUpdateKeywords.ONLINE] = new Map<string, number>();
            lastUpdate[ELastUpdateKeywords.GENERIC] = new Map<string, number>();
        }
    };

    const getLastUpdate = (
        key: number | string = '',
        branch: ELastUpdateKeywords = ELastUpdateKeywords.GENERIC
    ) => {
        const lastUpdate = lastUpdateRef.current;
        return (
            Date.now() -
                (branch === ELastUpdateKeywords.ALL
                    ? lastUpdate[ELastUpdateKeywords.ALL]
                    : ((lastUpdate[branch] as CacheMap).get(key) ?? 0)) <
            TTL
        );
    };

    const editLastUpdate = (
        value = 0,
        key: number | string = '',
        branch: ELastUpdateKeywords = ELastUpdateKeywords.GENERIC
    ) => {
        if (!isSafeObjectKey(key)) return;
        const lastUpdate = lastUpdateRef.current;
        if (branch === ELastUpdateKeywords.ALL) {
            lastUpdate[ELastUpdateKeywords.ALL] = value;
        } else {
            (lastUpdate[branch] as CacheMap).set(key, value);
        }
    };

    const checkAndEditLastUpdate = (
        key: number | string = '',
        branch: ELastUpdateKeywords = ELastUpdateKeywords.GENERIC
    ) => {
        if (getLastUpdate(key, branch)) return true;
        editLastUpdate(Date.now(), key, branch);
        return false;
    };

    function saveRecords(items: (T | undefined)[] = [], merge = false, onSave?: (item: T) => void) {
        for (let i = 0, len = items.length; i < len; i++) {
            const item = items[i];
            if (!item) continue;
            if (merge) editRecord(item);
            else addRecord(item);
            if (onSave) onSave(item);
        }
        return items;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchAny = <F = any>(
        asyncCall: () => Promise<F>,
        { forced, loading = true, lastUpdateKey = '', loadingKey }: Omit<IFetchSettings, 'merge'> = {}
    ): Promise<F | undefined> => {
        if (!forced && lastUpdateKey && checkAndEditLastUpdate(lastUpdateKey)) return Promise.resolve(undefined);
        if (loading) startLoading(loadingKey);
        return asyncCall()
            .catch((error) => {
                if (lastUpdateKey) editLastUpdate(0, lastUpdateKey);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

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
        if (
            !forced &&
            (lastUpdateKey
                ? checkAndEditLastUpdate(lastUpdateKey)
                : checkAndEditLastUpdate('', ELastUpdateKeywords.ALL))
        )
            return Promise.resolve(itemList);

        if (loading) startLoading(loadingKey);

        return apiCall()
            .then((items = [] as (T | undefined)[]) =>
                saveRecords(items, merge, (item) => {
                    if (!mismatch)
                        editLastUpdate(Date.now(), createIdentifier(item), ELastUpdateKeywords.TARGET);
                })
            )
            .catch((error: unknown) => {
                editLastUpdate(0, lastUpdateKey, ELastUpdateKeywords.ALL);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

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
        if (!forced && checkAndEditLastUpdate(lastUpdateKey + parentId, ELastUpdateKeywords.PARENT))
            return Promise.resolve(getListByParent(parentId));

        if (loading) startLoading(loadingKey);

        return apiCall()
            .then((items = [] as (T | undefined)[]) => {
                for (let i = 0, len = items.length; i < len; i++) {
                    const item = items[i];
                    if (!item) continue;
                    addToParent(parentId, createIdentifier(item) as string);
                    if (merge || mismatch) editRecord(item);
                    else addRecord(item);
                    if (!mismatch)
                        editLastUpdate(Date.now(), createIdentifier(item), ELastUpdateKeywords.TARGET);
                }
                removeDuplicateChildren(parentId);
                return items;
            })
            .catch((error: unknown) => {
                editLastUpdate(0, lastUpdateKey + parentId, ELastUpdateKeywords.PARENT);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    const fetchTarget = (
        apiCall: () => Promise<T | undefined>,
        id?: K,
        { forced, loading = true, merge, lastUpdateKey = '', loadingKey }: IFetchSettings = {}
    ): Promise<T | undefined> => {
        if (id && !forced && checkAndEditLastUpdate(lastUpdateKey + id, ELastUpdateKeywords.TARGET))
            return Promise.resolve(getRecord(id));

        if (loading) startLoading(loadingKey);

        return apiCall()
            .then(
                (item: T | undefined) =>
                    saveRecords([item], merge, (value) => {
                        editLastUpdate(
                            Date.now(),
                            lastUpdateKey + createIdentifier(value),
                            ELastUpdateKeywords.TARGET
                        );
                    })[0]
            )
            .catch((error: unknown) => {
                if (id) editLastUpdate(0, lastUpdateKey + id, ELastUpdateKeywords.TARGET);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    const fetchMultiple = (
        apiCall: () => Promise<(T | undefined)[]>,
        ids?: K[],
        { forced, loading = true, merge, loadingKey, lastUpdateKey = '' }: IFetchSettings = {}
    ): Promise<(T | undefined)[]> => {
        if (!ids || ids.length === 0) return Promise.resolve([]);

        const expiredIds: K[] = [];
        const cachedIds: K[] = [];

        for (const id of ids) {
            if (forced || !checkAndEditLastUpdate(lastUpdateKey + id, ELastUpdateKeywords.TARGET))
                expiredIds.push(id);
            else cachedIds.push(id);
        }

        const cachedItems = cachedIds.map((id) => getRecord(id));
        if (expiredIds.length === 0) return Promise.resolve(cachedItems);

        if (loading) startLoading(loadingKey);

        return apiCall()
            .then((items = [] as (T | undefined)[]) => [
                ...saveRecords(items, merge, (item) => {
                    editLastUpdate(Date.now(), createIdentifier(item), ELastUpdateKeywords.TARGET);
                }),
                ...cachedItems
            ])
            .catch((error: unknown) => {
                for (let i = expiredIds.length; i--; ) {
                    const id = expiredIds[i];
                    if (id) editLastUpdate(0, id, ELastUpdateKeywords.TARGET);
                }
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    const searchKeyGen = (object: object = {}) =>
        JSON.stringify(object, Object.keys(object).toSorted());

    const searchGet = (key: string | object, page = 1, pageSize = 10) => {
        const searchKey = typeof key === 'string' ? key : searchKeyGen(key);
        return getRecords(searchCachedRef.current[searchKey + ':' + pageSize]?.[page]);
    };

    const searchGetTotal = (key: string | object, pageSize = 10): number | undefined => {
        const searchKey = typeof key === 'string' ? key : searchKeyGen(key);
        return searchTotals[searchKey + ':' + pageSize];
    };

    const searchSetTotal = (key: string | object, total: number, pageSize = 10): void => {
        const searchKey = typeof key === 'string' ? key : searchKeyGen(key);
        setSearchTotals((previous) => ({ ...previous, [searchKey + ':' + pageSize]: total }));
    };

    const searchCleanup = () => {
        const MAX_SEARCHES = 50;
        const lastUpdate = lastUpdateRef.current;

        const validEntries = Array.from(lastUpdate[ELastUpdateKeywords.ONLINE].entries()).filter(
            ([, ttl]) => ttl + TTL > Date.now()
        );

        if (validEntries.length > MAX_SEARCHES) validEntries.sort((a, b) => b[1] - a[1]);

        lastUpdate[ELastUpdateKeywords.ONLINE] = new Map(validEntries.slice(0, MAX_SEARCHES));

        const activeTTLKeys = Array.from(lastUpdate[ELastUpdateKeywords.ONLINE].keys());

        setSearchCached((previous) => {
            const next = { ...previous };
            for (const cacheKey of Object.keys(next)) {
                if (!activeTTLKeys.some((ttlKey) => ttlKey.includes(cacheKey + ':'))) delete next[cacheKey];
            }
            return next;
        });

        // Keep manually set totals even when no cached page ids are present.
    };

    const fetchSearch = <F = object>(
        apiCall: () => Promise<SearchApiResult<T>>,
        filters: F = {} as F,
        page = 1,
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
        const searchKey = searchKeyGen(filters as object) + ':' + pageSize;
        const searchTTLkey = lastUpdateKey + searchKey + ':' + page;
        const lastUpdate = lastUpdateRef.current;

        searchCleanup();

        if (!forced && lastUpdate[ELastUpdateKeywords.ONLINE].has(searchTTLkey))
            return Promise.resolve(getRecords(searchCachedRef.current[searchKey]?.[page]));

        lastUpdate[ELastUpdateKeywords.ONLINE].set(searchTTLkey, Date.now());

        if (loading) startLoading(loadingKey);

        return apiCall()
            .then((result) => {
                const isTuple = Array.isArray(result[0]);
                const items = (isTuple ? result[0] : result) as (T | undefined)[];
                if (isTuple)
                    searchSetTotal(
                        filters as object,
                        (result as [(T | undefined)[], number?])[1] ?? 0,
                        pageSize
                    );

                const pageIds: K[] = [];
                saveRecords(items, merge, (item) => {
                    const id = createIdentifier(item);
                    pageIds.push(id);
                    if (!mismatch) editLastUpdate(Date.now(), id, ELastUpdateKeywords.TARGET);
                });

                setSearchCached((previous) => {
                    const next = { ...previous };
                    const pages = { ...(next[searchKey] ?? {}) };
                    pages[page] = pageIds;
                    next[searchKey] = pages;
                    return next;
                });

                return items;
            })
            .catch((error: unknown) => {
                editLastUpdate(0, searchTTLkey, ELastUpdateKeywords.ONLINE);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    const fetchPaginate = <F = object>(
        apiCall: () => Promise<SearchApiResult<T>>,
        page = 1,
        pageSize = 10,
        settings: IFetchSettings = {}
    ) => fetchSearch(apiCall, {} as F, page, pageSize, settings);

    const createTarget = (
        apiCall: () => Promise<T | undefined>,
        dummyData?: T,
        { loading = true, lastUpdateKey = '', loadingKey }: Omit<IFetchSettings, 'forced' | 'merge'> = {},
        fetchLike = true
    ): Promise<T | undefined> => {
        const temporaryId = crypto.randomUUID();
        if (dummyData) editRecord(dummyData, temporaryId as K, true);
        if (loading) startLoading(loadingKey);
        return apiCall()
            .then((item: T | undefined) => {
                if (!item) return;
                const id = createIdentifier(item);
                if (dummyData) deleteRecord(temporaryId as K);
                addRecord(item);
                if (fetchLike) editLastUpdate(Date.now(), lastUpdateKey + id, ELastUpdateKeywords.TARGET);
                return getRecord(id);
            })
            .catch((error: unknown) => {
                deleteRecord(temporaryId as K);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    const updateTarget = <F = T>(
        apiCall: () => Promise<F | (T | undefined)[]>,
        itemData: Partial<T>,
        id?: K,
        { loading = true, merge, lastUpdateKey = '', loadingKey }: Omit<IFetchSettings, 'forced'> = {},
        fetchLike = true,
        fetchAgain = true
    ): Promise<F | (T | undefined)[]> => {
        const oldItemData = getRecord(id);
        editRecord(itemData, id, true);

        if (loading) startLoading(loadingKey);

        return apiCall()
            .then((data) => {
                if (fetchAgain) {
                    if (merge) editRecord(data as T, id);
                    else addRecord(data as T);
                }

                if (fetchLike || fetchAgain)
                    editLastUpdate(Date.now(), lastUpdateKey + id, ELastUpdateKeywords.TARGET);

                return data;
            })
            .catch((error: unknown) => {
                if (oldItemData) editRecord(oldItemData, id);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    const deleteTarget = <F = unknown>(
        apiCall: () => Promise<F>,
        id: K,
        { loading = true, loadingKey }: Pick<IFetchSettings, 'loading' | 'loadingKey'> = {}
    ): Promise<F> => {
        const oldItemData = getRecord(id);
        deleteRecord(id);
        if (loading) startLoading(loadingKey);
        return apiCall()
            .catch((error: unknown) => {
                if (oldItemData) addRecord(oldItemData);
                throw error;
            })
            .finally(() => loading && stopLoading(loadingKey));
    };

    return {
        createIdentifier,
        identifierKey,
        loadingKey,

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
        setSelectedIdentifier,
        selectedRecord,

        pageCurrent,
        setPageCurrent,
        pageSize,
        setPageSize,
        pageTotal,
        pageOffset,
        pageItemList,

        parentHasMany,
        addToParent,
        removeFromParent,
        removeDuplicateChildren,
        getRecordsByParent,
        getListByParent,

        startLoading,
        stopLoading,
        loading,
        lastUpdate: lastUpdateRef.current,
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
