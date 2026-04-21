import { useCallback, useMemo, useRef, useState } from 'react';

export const useStructureDataManagement = <
    // type of item
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number | symbol, any> = Record<string, any>,
    // type of item[identifier]
    K extends string | number | symbol = keyof T,
    // type of parent[parent_identifier], where the current item is in a relation "belongsTo" with an unknown parent data
    P extends string | number | symbol = string | number | symbol
>(
    identifiers: string | string[] = 'id',
    delimiter = '|'
) => {
    const identifier = Array.isArray(identifiers) ? identifiers.join(delimiter) : identifiers;

    const [itemDictionary, setItemDictionary] = useState<Record<K, T>>({} as Record<K, T>);
    const itemDictionaryRef = useRef(itemDictionary);
    itemDictionaryRef.current = itemDictionary;

    const [selectedIdentifier, setSelectedIdentifier] = useState<K | undefined>(undefined);
    const [pageCurrent, setPageCurrent] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [parentHasMany, setParentHasMany] = useState<Record<P, (typeof identifier)[]>>(
        {} as Record<P, (typeof identifier)[]>
    );
    const parentHasManyRef = useRef(parentHasMany);
    parentHasManyRef.current = parentHasMany;

    const createIdentifier = useCallback(
        <C = T>(itemData: C, customIdentifiers?: string | string[]): K => {
            const _identifiers = customIdentifiers ?? identifiers;
            if (Array.isArray(_identifiers))
                return _identifiers.map((key) => itemData[key as keyof C]).join(delimiter) as K;
            return itemData[identifier as keyof C] as K;
        },
        [delimiter, identifier, identifiers]
    );

    const itemList = useMemo<T[]>(() => Object.values(itemDictionary as Record<K, T>), [itemDictionary]);

    const setRecords = useCallback((items: Record<K, T>): Record<K, T> => {
        setItemDictionary(items);
        return items;
    }, []);

    const resetRecords = useCallback(() => {
        setItemDictionary({} as Record<K, T>);
    }, []);

    const getRecord = useCallback(
        (..._arguments: (K | undefined)[]): T | undefined => {
            const id = _arguments.join(delimiter);
            return itemDictionaryRef.current[id as K];
        },
        [delimiter]
    );

    const getRecords = useCallback(
        (idsArray: (K | (K | undefined)[])[] = []) =>
            idsArray
                .map((id) => (Array.isArray(id) ? getRecord(...id) : getRecord(id)))
                .filter(Boolean) as T[],
        [getRecord]
    );

    const addRecord = useCallback(
        (itemData: T) => {
            const key = createIdentifier(itemData);
            setItemDictionary((previous) => ({ ...previous, [key]: itemData }));
            return itemData;
        },
        [createIdentifier]
    );

    const addRecords = useCallback(
        (itemsArray: (T | undefined)[]) => {
            setItemDictionary((previous) => {
                const next = { ...previous } as Record<K, T>;
                for (let i = 0, len = itemsArray.length; i < len; i++) {
                    const item = itemsArray[i];
                    if (!item) continue;
                    next[createIdentifier(item)] = item;
                }
                return next;
            });
        },
        [createIdentifier]
    );

    const editRecord = useCallback(
        (data: Partial<T> = {}, id?: K | K[], create = true) => {
            const _inferredId = id ?? (data[identifier as keyof T] as K | K[]);
            const _id = Array.isArray(_inferredId) ? (_inferredId.join(delimiter) as K) : _inferredId;

            if (!create && (!id || !Object.prototype.hasOwnProperty.call(itemDictionaryRef.current, _id))) {
                // eslint-disable-next-line no-console
                console.error('storeDataStructure - data not found', data);
                return;
            }

            setItemDictionary((previous) => ({
                ...previous,
                [_id]: {
                    ...(previous as Record<K, T>)[_id],
                    ...data
                }
            }));
        },
        [delimiter, identifier]
    );

    const editRecords = useCallback(
        (itemsArray: (T | undefined)[]) => {
            setItemDictionary((previous) => {
                const next = { ...previous } as Record<K, T>;
                for (let i = 0, len = itemsArray.length; i < len; i++) {
                    const item = itemsArray[i];
                    if (!item) continue;
                    const _id = dataIdentifier(item, identifier, delimiter) as K;
                    next[_id] = {
                        ...next[_id],
                        ...item
                    };
                }
                return next;
            });
        },
        [delimiter, identifier]
    );

    const deleteRecord = useCallback((id: K) => {
        setItemDictionary((previous) => {
            if (!(id in previous)) return previous;
            const { [id]: _deleted, ...rest } = previous;
            return rest as Record<K, T>;
        });
        return true;
    }, []);

    const selectedRecord = useMemo<T | undefined>(
        () => (selectedIdentifier === undefined ? undefined : getRecord(selectedIdentifier)),
        [getRecord, selectedIdentifier, itemDictionary]
    );

    const pageTotal = useMemo(() => Math.ceil(itemList.length / pageSize), [itemList.length, pageSize]);
    const pageOffset = useMemo(() => pageSize * (pageCurrent - 1), [pageCurrent, pageSize]);
    const pageItemList = useMemo(
        () => itemList.slice(pageOffset, pageOffset + pageSize),
        [itemList, pageOffset, pageSize]
    );

    const addToParent = useCallback((parentId: P, childId: typeof identifier) => {
        setParentHasMany((previous) => {
            const current = previous[parentId] ?? [];
            return {
                ...previous,
                [parentId]: [...current, childId]
            };
        });
    }, []);

    const removeFromParent = useCallback((parentId: P, childId: typeof identifier) => {
        setParentHasMany((previous) => ({
            ...previous,
            [parentId]: (previous[parentId] ?? []).filter((id) => id !== childId)
        }));
    }, []);

    const removeDuplicateChildren = useCallback((parentId: P) => {
        setParentHasMany((previous) => ({
            ...previous,
            [parentId]: [...new Set(previous[parentId] ?? [])]
        }));
    }, []);

    const getRecordsByParent = useCallback(
        (parentId?: P): Record<K, T> => {
            const result = {} as Record<K, T>;
            if (!parentId || !parentHasManyRef.current[parentId]) return result;
            for (const key of parentHasManyRef.current[parentId]) {
                const record = getRecord(key as K);
                if (record) result[key as K] = record;
            }
            return result;
        },
        [getRecord]
    );

    const getListByParent = useCallback(
        (parentId?: P): T[] => Object.values(getRecordsByParent(parentId)),
        [getRecordsByParent]
    );

    return {
        createIdentifier,
        identifier,
        itemDictionary,
        itemList,
        setRecords,
        resetRecords,
        getRecord,
        getRecords,
        addRecord,
        addRecords,
        editRecord,
        editRecords,
        deleteRecord,
        selectedIdentifier,
        setSelectedIdentifier,
        selectedRecord,

        // Pagination
        pageCurrent,
        setPageCurrent,
        pageSize,
        setPageSize,
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
    };
};

const dataIdentifier = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number | symbol, any>
>(
    data: T,
    identifier: string,
    delimiter: string
): string => {
    if (identifier.includes(delimiter)) {
        return identifier
            .split(delimiter)
            .map((key) => data[key as keyof T])
            .join(delimiter);
    }
    return String(data[identifier as keyof T]);
};
