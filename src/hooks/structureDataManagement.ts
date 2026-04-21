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
    // The identification parameter of the item (READONLY and not exported)
    identifiers: string | string[] = 'id',
    // Delimiter for multiple identifiers
    delimiter = '|'
) => {
    /**
     * True identifier, becomes a string if it is an array
     */
    const identifier = Array.isArray(identifiers) ? identifiers.join(delimiter) : identifiers;

    /**
     * Dictionary of items
     */
    const [itemDictionary, setItemDictionary] = useState<Record<K, T>>({} as Record<K, T>);
    const itemDictionaryRef = useRef(itemDictionary);
    itemDictionaryRef.current = itemDictionary;

    const [selectedIdentifier, setSelectedIdentifier] = useState<K | undefined>(undefined);
    const [pageCurrent, setPageCurrent] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    /**
     * If the item has a parent, here is stored a "parent hasMany" relation
     */
    const [parentHasMany, setParentHasMany] = useState<Record<P, (typeof identifier)[]>>(
        {} as Record<P, (typeof identifier)[]>
    );
    const parentHasManyRef = useRef(parentHasMany);
    parentHasManyRef.current = parentHasMany;

    /**
     * Creates a unique identifier for an item using configured identifier fields.
     *
     * @param itemData
     * @param customIdentifiers - if specified, uses these identifiers instead of default ones
     */
    const createIdentifier = useCallback(
        <C = T>(itemData: C, customIdentifiers?: string | string[]): K => {
            const _identifiers = customIdentifiers ?? identifiers;
            if (Array.isArray(_identifiers))
                return _identifiers.map((key) => itemData[key as keyof C]).join(delimiter) as K;
            return itemData[identifier as keyof C] as K;
        },
        [delimiter, identifier, identifiers]
    );

    /**
     * List of items
     */
    const itemList = useMemo<T[]>(() => Object.values(itemDictionary as Record<K, T>), [itemDictionary]);

    /**
     * Set records directly to the dictionary
     *
     * @param items
     */
    const setRecords = useCallback((items: Record<K, T>): Record<K, T> => {
        setItemDictionary(items);
        return items;
    }, []);

    /**
     * Empty the items dictionary
     */
    const resetRecords = useCallback(() => {
        setItemDictionary({} as Record<K, T>);
    }, []);

    /**
     * Get record from object dictionary using identifier
     *
     * @param _arguments
     */
    const getRecord = useCallback(
        (..._arguments: (K | undefined)[]): T | undefined => {
            const id = _arguments.join(delimiter);
            return itemDictionaryRef.current[id as K];
        },
        [delimiter]
    );

    /**
     * Multiple getRecord
     *
     * @param idsArray
     */
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

    /**
     * Add a list of items to the dictionary.
     *
     * @param itemsArray
     */
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

    /**
     * Edit item.
     * If item is not present, it can be ignored depending on `create`.
     *
     * @param data
     * @param id - WARNING: needs createIdentifier format when identifiers is array
     * @param create - if true item can be created if not present
     */
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

    /**
     * Same as addRecords but with edit/merge behavior
     *
     * @param itemsArray
     */
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

    /**
     * Delete record
     *
     * @param id
     */
    const deleteRecord = useCallback((id: K) => {
        setItemDictionary((previous) => {
            if (!(id in previous)) return previous;
            const { [id]: _deleted, ...rest } = previous;
            return rest as Record<K, T>;
        });
        return true;
    }, []);

    /**
     * Selected item (by selectedIdentifier)
     */
    const selectedRecord = useMemo<T | undefined>(
        () => (selectedIdentifier === undefined ? undefined : getRecord(selectedIdentifier)),
        [getRecord, selectedIdentifier, itemDictionary]
    );

    /**
     * ---------------------------------- OFFLINE PAGINATION ------------------------------------
     */

    /**
     * How many pages exist
     */
    const pageTotal = useMemo(() => Math.ceil(itemList.length / pageSize), [itemList.length, pageSize]);
    /**
     * First item of current page
     */
    const pageOffset = useMemo(() => pageSize * (pageCurrent - 1), [pageCurrent, pageSize]);
    /**
     * Items shown in current page
     */
    const pageItemList = useMemo(
        () => itemList.slice(pageOffset, pageOffset + pageSize),
        [itemList, pageOffset, pageSize]
    );

    /**
     * ----------------------------- hasMany & belongsTo relationships -----------------------------
     */

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

    /**
     * Get all records by parent and return complete dictionary
     *
     * @param parentId
     */
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

    /**
     * Same as above but with array result
     *
     * @param parentId
     */
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
