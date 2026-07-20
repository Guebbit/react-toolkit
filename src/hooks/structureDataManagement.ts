import { useCallback, useMemo, useRef } from 'react';
import { generateFallbackValue } from '../utils/generateFallbackValue';
import { useLiveState } from '../utils/useLiveState';

export const useStructureDataManagement = <
    // type of item
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends Record<string | number | symbol, any> = Record<string, any>,
    // type of item[identifier]
    K extends string | number | symbol = keyof T,
    // type of parent[parent_identifier], where the current item is in a relation "belogsTo" with an unknown parent data
    // WARNING: Typescript is not inferring correctly between different hooks and uses the default type
    P extends string | number | symbol = string | number | symbol
>(
    //  The identification parameter of the item (READONLY and not exported)
    identifiers: string | string[] = 'id',
    // Delimiter for multiple identifiers
    delimiter = '|'
) => {
    /**
     * Identifier configuration is captured once, on the first render, and treated
     * as construction-time config from then on. Repointing a populated dictionary
     * at a different identifier field mid-life is not a supported operation, and
     * capturing keeps every callback below referentially stable even when the
     * caller passes an inline array literal.
     */
    const configurationRef = useRef({ identifiers, delimiter });
    const { identifiers: identifierFields, delimiter: identifierDelimiter } =
        configurationRef.current;

    /**
     * True identifier, become a string if it is an array
     * (no need to be reactive)
     */
    const identifier = Array.isArray(identifierFields)
        ? identifierFields.join(identifierDelimiter)
        : identifierFields;

    /**
     * Fills the given (missing) identifier field(s) directly on itemData with a random fallback
     * value, so the generated id is:
     *  - readable back from the item itself (e.g. item.id) after insertion
     *  - stable across repeated calls (createIdentifier is called more than once per item, e.g.
     *    once by the caller and again internally by addRecord/editRecord)
     *
     * @param itemData
     * @param missingKeys - identifier field name(s) to fill in
     */
    const fillMissingIdentifiers = useCallback(<C>(itemData: C, missingKeys: string[]): void => {
        if (typeof itemData !== 'object' || itemData === undefined || itemData === null) return;
        const fallback = generateFallbackValue();
        for (const key of missingKeys) (itemData as Record<string, unknown>)[key] = fallback;
        // eslint-disable-next-line no-console
        console.warn(
            'structureDataManagement - item is missing its identifier, generating a temporary fallback id',
            fallback,
            itemData
        );
    }, []);

    /**
     *
     * @param itemData
     * @param customIdentifiers - if specified, it will create a key using these identifiers instead of the default ones
     */
    const createIdentifier = useCallback(
        <C = T>(itemData: C, customIdentifiers?: string | string[]): K => {
            const _identifiers = customIdentifiers ?? identifierFields;
            if (Array.isArray(_identifiers)) {
                const values = _identifiers.map((key) => itemData[key as keyof C]);
                const missingKeys = _identifiers.filter(
                    (_key, index) => values[index] == undefined
                );
                if (missingKeys.length > 0) {
                    fillMissingIdentifiers(itemData, missingKeys);
                    return _identifiers
                        .map((key) => itemData[key as keyof C])
                        .join(identifierDelimiter) as K;
                }
                return values.join(identifierDelimiter) as K;
            }
            const value = itemData[identifier as keyof C];
            if (value === undefined || value === null) {
                fillMissingIdentifiers(itemData, [identifier]);
                return itemData[identifier as keyof C] as K;
            }
            return value as K;
        },
        [identifierFields, identifierDelimiter, identifier, fillMissingIdentifiers]
    );

    /**
     * Dictionary of items (to be filled)
     *
     * Items are NEVER evicted by age. Stale data is not garbage data: it is what keeps
     * the UI rendered while a fresher copy is being downloaded. An item is only garbage
     * once nothing points at it, which has nothing to do with how old it is.
     *
     * So nothing here prunes on a timer or on cache expiry. The dictionary is emptied
     * only on teardown (resetRecords / resetAll / destroy) or, in useStructureRestApi,
     * on critical mass — see `maxRecords`.
     */
    const [itemDictionaryRef, setItemDictionary] = useLiveState<Record<K, T>>(
        () => ({}) as Record<K, T>
    );

    /**
     * The dictionary as of this render. Every mutator below writes through
     * `itemDictionaryRef`, so within a single tick this snapshot can trail the
     * live value by one or more writes — read it for rendering, and
     * {@link getRecordDictionary} when a write must be read back immediately.
     */
    const itemDictionary = itemDictionaryRef.current;

    /**
     * The dictionary as it is RIGHT NOW, including writes made earlier in this
     * same tick that React has not re-rendered for yet.
     */
    const getRecordDictionary = useCallback(
        (): Record<K, T> => itemDictionaryRef.current,
        [itemDictionaryRef]
    );

    /**
     * List of items
     */
    const itemList = useMemo<T[]>(() => Object.values(itemDictionary), [itemDictionary]);

    /**
     * Set records directly to the dictionary
     *
     * @param items
     */
    const setRecords = useCallback(
        (items: Record<K, T>) => {
            setItemDictionary(items);
            return items;
        },
        [setItemDictionary]
    );

    /**
     * Empty the items dictionary
     */
    const resetRecords = useCallback(() => {
        setItemDictionary({} as Record<K, T>);
    }, [setItemDictionary]);

    /**
     * Get record from object dictionary using identifier
     *
     * @param _arguments
     */
    const getRecord = useCallback(
        (..._arguments: (K | undefined)[]): T | undefined =>
            // Important to directly access the dictionary to avoid reactivity issues
            itemDictionaryRef.current[_arguments.join(identifierDelimiter) as K],
        [itemDictionaryRef, identifierDelimiter]
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

    /**
     * Id of the most recently inserted (newly created, not merely updated) record.
     * Mirrors e.g. Laravel's lastInsertId() — read this right after an add/create
     * call when the id isn't available any other way (auto-generated fallback ids, deep call chains, ...).
     */
    const [lastInsertedIdentifierRef, setLastInsertedIdentifier] = useLiveState<K | undefined>();
    const lastInsertedIdentifier = lastInsertedIdentifierRef.current;

    /**
     * Ids inserted by the most recent batch call (addRecords/editRecords).
     * Reset at the start of each batch call.
     */
    const [lastInsertedIdentifiersRef, setLastInsertedIdentifiers] = useLiveState<K[]>(() => []);
    const lastInsertedIdentifiers = lastInsertedIdentifiersRef.current;

    /**
     * Record for @{lastInsertedIdentifier}
     */
    const lastInsertedRecord = useMemo<T | undefined>(
        () =>
            lastInsertedIdentifier === undefined
                ? undefined
                : itemDictionary[lastInsertedIdentifier],
        [itemDictionary, lastInsertedIdentifier]
    );

    /**
     * Add item to the dictionary.
     * If item already present, it will be overwritten
     *
     * @param itemData
     */
    const addRecord = useCallback(
        (itemData: T) => {
            const id = createIdentifier(itemData);
            setLastInsertedIdentifier(id);
            setItemDictionary({ ...itemDictionaryRef.current, [id]: itemData });
            return itemData;
        },
        [createIdentifier, setLastInsertedIdentifier, setItemDictionary, itemDictionaryRef]
    );

    /**
     * Add a list of items to the dictionary.
     *
     * Built as ONE dictionary replacement rather than a loop of addRecord calls, so a
     * large batch costs a single copy instead of one per item.
     *
     * @param itemsArray
     */
    const addRecords = useCallback(
        (itemsArray: (T | undefined)[]) => {
            const ids: K[] = [];
            const next = { ...itemDictionaryRef.current };
            for (const item of itemsArray) {
                if (!item) continue;
                const id = createIdentifier(item);
                next[id] = item;
                ids.push(id);
            }
            setItemDictionary(next);
            if (ids.length > 0) setLastInsertedIdentifier(ids.at(-1));
            setLastInsertedIdentifiers(ids);
        },
        [
            createIdentifier,
            setItemDictionary,
            setLastInsertedIdentifier,
            setLastInsertedIdentifiers,
            itemDictionaryRef
        ]
    );

    /**
     * Edit item,
     * If item not present, it will be ignored
     * If it is present, it will be merged with the new partial data
     * WARNING: If identifier change, it does NOT automatically update the dictionary id.
     *
     * @param data
     * @param id - WARNING: needed createIdentifier if identifiers is array
     * @param create - if true it will be added if not present
     * @returns the record's id if this call created a new record, undefined if it only updated an existing one
     */
    const editRecord = useCallback(
        (data: Partial<T> = {}, id?: K | K[], create = true): K | undefined => {
            // if NOT forced to create and NOT given an id: error (avoid inferring/generating a fallback id for nothing)
            if (!create && !id) {
                // eslint-disable-next-line no-console
                console.error('storeDataStructure - data not found', data);
                return;
            }

            // If not specified, it will be inferred (using the same fallback-id logic as createIdentifier)
            // if multiple identifiers, then they need to be joined\translated
            const _id =
                (Array.isArray(id) ? (id.join(identifierDelimiter) as K) : id) ??
                createIdentifier(data);

            const current = itemDictionaryRef.current;
            const isNew = !Object.prototype.hasOwnProperty.call(current, _id);

            // if NOT forced to create and NOT found: error
            if (!create && isNew) {
                // eslint-disable-next-line no-console
                console.error('storeDataStructure - data not found', data);
                return;
            }

            // Replace data if already present
            setItemDictionary({
                ...current,
                [_id]: {
                    ...current[_id],
                    ...data
                }
            });

            if (!isNew) return;
            setLastInsertedIdentifier(_id);
            return _id;
        },
        [
            createIdentifier,
            identifierDelimiter,
            setItemDictionary,
            setLastInsertedIdentifier,
            itemDictionaryRef
        ]
    );

    /**
     * Same as addRecords but merging into (instead of replacing) existing records.
     *
     * @param itemsArray
     */
    const editRecords = useCallback(
        (itemsArray: (T | undefined)[]) => {
            const ids: K[] = [];
            const next = { ...itemDictionaryRef.current };
            for (const item of itemsArray) {
                if (!item) continue;
                const id = createIdentifier(item);
                if (!Object.prototype.hasOwnProperty.call(next, id)) ids.push(id);
                next[id] = { ...next[id], ...item };
            }
            setItemDictionary(next);
            if (ids.length > 0) setLastInsertedIdentifier(ids.at(-1));
            setLastInsertedIdentifiers(ids);
        },
        [
            createIdentifier,
            setItemDictionary,
            setLastInsertedIdentifier,
            setLastInsertedIdentifiers,
            itemDictionaryRef
        ]
    );

    /**
     * Delete record
     *
     * @param id
     * @returns true if a record was actually removed
     */
    const deleteRecord = useCallback(
        (id: K): boolean => {
            const current = itemDictionaryRef.current;
            if (!Object.prototype.hasOwnProperty.call(current, id)) return false;
            const next = { ...current };
            delete next[id];
            setItemDictionary(next);
            return true;
        },
        [setItemDictionary, itemDictionaryRef]
    );

    /**
     * Selected ID
     */
    const [selectedIdentifierRef, setSelectedIdentifier] = useLiveState<K | undefined>();
    const selectedIdentifier = selectedIdentifierRef.current;

    /**
     * Selected item (by @{selectedIdentifier})
     * Can have 2 uses:
     *  - List mode: Show in modal or operations that require the details (example items in a table)
     *  - Target mode: a detail page or a form to edit the selected item (example item in a dedicated detail page)
     */
    const selectedRecord = useMemo<T | undefined>(
        () => (selectedIdentifier === undefined ? undefined : itemDictionary[selectedIdentifier]),
        [itemDictionary, selectedIdentifier]
    );

    /**
     * ---------------------------------- OFFLINE PAGINATION ------------------------------------
     */

    /**
     * Current selected page (start with 1)
     */
    const [pageCurrentRef, setPageCurrent] = useLiveState(1);
    const pageCurrent = pageCurrentRef.current;

    /**
     * How many items in page
     */
    const [pageSizeRef, setPageSize] = useLiveState(10);
    const pageSize = pageSizeRef.current;

    /**
     * How many pages exist
     */
    const pageTotal = useMemo(() => Math.ceil(itemList.length / pageSize), [itemList, pageSize]);

    /**
     * First item of the current page
     */
    const pageOffset = useMemo(() => pageSize * (pageCurrent - 1), [pageSize, pageCurrent]);

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

    /**
     * If the item has a parent, here will be stored a "parent hasMany" relation
     */
    const [parentHasManyRef, setParentHasMany] = useLiveState<Record<P, K[]>>(
        () => ({}) as Record<P, K[]>
    );
    const parentHasMany = parentHasManyRef.current;

    /**
     *
     * @param parentId
     * @param childId
     */
    const addToParent = useCallback(
        (parentId: P, childId: K) => {
            const current = parentHasManyRef.current;
            setParentHasMany({
                ...current,
                [parentId]: [...(current[parentId] ?? []), childId]
            });
        },
        [setParentHasMany, parentHasManyRef]
    );

    /**
     *
     * @param parentId
     * @param childId
     */
    const removeFromParent = useCallback(
        (parentId: P, childId: K) => {
            const current = parentHasManyRef.current;
            setParentHasMany({
                ...current,
                [parentId]: (current[parentId] ?? []).filter((id: K) => id !== childId)
            });
        },
        [setParentHasMany, parentHasManyRef]
    );

    /**
     *
     * @param parentId
     */
    const removeDuplicateChildren = useCallback(
        (parentId: P) => {
            const current = parentHasManyRef.current;
            setParentHasMany({
                ...current,
                [parentId]: [...new Set(current[parentId])]
            });
        },
        [setParentHasMany, parentHasManyRef]
    );

    /**
     * Get all records ID by parent and use them to retrieve the complete dictionary
     * @param parentId
     */
    const getRecordsByParent = useCallback(
        (parentId?: P): Record<K, T> => {
            const result = {} as Record<K, T>;
            const children =
                parentId === undefined ? undefined : parentHasManyRef.current[parentId];
            if (!children) return result;
            for (const key of children) {
                const record = getRecord(key);
                if (record) result[key] = record;
            }
            return result;
        },
        [getRecord, parentHasManyRef]
    );

    /**
     * Same as above but with array result
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
        getRecordDictionary,
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
        lastInsertedIdentifier,
        lastInsertedIdentifiers,
        lastInsertedRecord,

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
