/**
 * structureRestApi — paginated listing
 *
 * Simulates a page that shows items in a table with pagination controls:
 *   - loading all items at once and then navigating pages client-side
 *   - server-driven pagination where each page is fetched individually
 *     (using fetchAll with a custom lastUpdateKey per page)
 *   - TTL caching per page (a second request for the same page within TTL
 *     does not trigger a new API call)
 *   - page-size changes
 *   - edge-cases: empty results, last page has fewer items than pageSize
 *
 * All API calls use local in-memory mock functions — no network access needed.
 */

import { act, renderHook } from '@testing-library/react';
import { useStructureRestApi } from '../src/hooks/structureRestApi';

interface IProduct {
    id: number;
    title: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComposable(TTL = 3_600_000) {
    const rendered = renderHook(() => useStructureRestApi<IProduct, number>({ identifiers: 'id', TTL }));
    const current = () => rendered.result.current;
    const valueRef = <T>(getter: () => T, setter?: (value: T) => void) =>
        Object.defineProperty({}, 'value', {
            get: getter,
            set: (value: T) => setter?.(value),
            enumerable: true
        }) as { value: T };

    return {
        fetchAll: async (...args: any[]) => {
            let result: any;
            await act(async () => {
                result = await (current() as any).fetchAll(...args);
            });
            return result;
        },
        fetchPaginate: async (...args: any[]) => {
            let result: any;
            await act(async () => {
                result = await (current() as any).fetchPaginate(...args);
            });
            return result;
        },
        fetchByParent: async (...args: any[]) => {
            let result: any;
            await act(async () => {
                result = await (current() as any).fetchByParent(...args);
            });
            return result;
        },
        getRecord: (...args: any[]) => (current() as any).getRecord(...args),
        getListByParent: (...args: any[]) => (current() as any).getListByParent(...args),
        searchGet: (...args: any[]) => (current() as any).searchGet(...args),
        searchGetTotal: (...args: any[]) => (current() as any).searchGetTotal(...args),
        itemList: valueRef(() => current().itemList),
        pageCurrent: valueRef(() => current().pageCurrent, (value) =>
            act(() => current().setPageCurrent(value))
        ),
        pageSize: valueRef(() => current().pageSize, (value) => act(() => current().setPageSize(value))),
        pageTotal: valueRef(() => current().pageTotal),
        pageOffset: valueRef(() => current().pageOffset),
        pageItemList: valueRef(() => current().pageItemList)
    };
}

/** Minimal API stub: resolves with the provided data. */
function apiResolve<T = undefined>(data?: T): () => Promise<T> {
    return jest.fn().mockResolvedValue(data);
}

/** Builds a list of N products starting at startId. */
function buildProducts(count: number, startId = 1): IProduct[] {
    return Array.from({ length: count }, (_, i) => ({
        id: startId + i,
        title: `Product ${startId + i}`
    }));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('useStructureRestApi — pagination', () => {
    // -----------------------------------------------------------------------
    // Client-side (offline) pagination
    // -----------------------------------------------------------------------
    describe('client-side pagination (all items loaded at once)', () => {
        it('pageTotal is 1 when items fit in a single page', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve(buildProducts(5)));
            c.pageSize.value = 10;
            expect(c.pageTotal.value).toBe(1);
        });

        it('calculates the correct number of pages', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve(buildProducts(25)));
            c.pageSize.value = 10;
            expect(c.pageTotal.value).toBe(3);
        });

        it('returns the correct items for the first page', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve(buildProducts(25)));
            c.pageSize.value = 10;
            c.pageCurrent.value = 1;
            expect(c.pageItemList.value).toHaveLength(10);
            expect(c.pageItemList.value[0]!.id).toBe(1);
        });

        it('returns the correct items for the second page', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve(buildProducts(25)));
            c.pageSize.value = 10;
            c.pageCurrent.value = 2;
            const ids = c.pageItemList.value.map((p) => p.id);
            expect(ids[0]).toBe(11);
            expect(ids.at(-1)).toBe(20);
        });

        it('returns remaining items on the last page', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve(buildProducts(25)));
            c.pageSize.value = 10;
            c.pageCurrent.value = 3;
            expect(c.pageItemList.value).toHaveLength(5);
        });

        it('pageItemList is empty when there are no items', async () => {
            const c = makeComposable();
            c.pageSize.value = 10;
            c.pageCurrent.value = 1;
            expect(c.pageItemList.value).toHaveLength(0);
        });

        it('pageOffset is 0 on the first page', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve(buildProducts(25)));
            c.pageSize.value = 10;
            c.pageCurrent.value = 1;
            expect(c.pageOffset.value).toBe(0);
        });

        it('pageOffset advances correctly on subsequent pages', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve(buildProducts(25)));
            c.pageSize.value = 10;
            c.pageCurrent.value = 3;
            expect(c.pageOffset.value).toBe(20);
        });

        it('recalculates pages when pageSize changes', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve(buildProducts(25)));
            c.pageSize.value = 10;
            expect(c.pageTotal.value).toBe(3);
            c.pageSize.value = 5;
            expect(c.pageTotal.value).toBe(5);
        });

        it('navigating across all pages yields every item exactly once', async () => {
            const products = buildProducts(25);
            const c = makeComposable();
            await c.fetchAll(apiResolve(products));
            c.pageSize.value = 10;

            const collected: IProduct[] = [];
            for (let p = 1; p <= c.pageTotal.value; p++) {
                c.pageCurrent.value = p;
                collected.push(...c.pageItemList.value);
            }
            expect(collected).toHaveLength(products.length);
            const ids = collected.map((i) => i.id).toSorted((a, b) => a - b);
            expect(ids).toEqual(products.map((p) => p.id).toSorted((a, b) => a - b));
        });
    });

    // -----------------------------------------------------------------------
    // Server-side pagination (one API call per page)
    // -----------------------------------------------------------------------
    describe('server-side pagination (one fetch per page)', () => {
        /**
         * Pattern: the component calls fetchAll for every page, passing a unique
         * lastUpdateKey so the TTL is tracked independently per page.
         * Items accumulate in itemDictionary across pages.
         */
        // eslint-disable-next-line unicorn/consistent-function-scoping
        function pageKey(page: number) {
            return `products-page-${page}`;
        }

        it('fetches the first page and stores its items', async () => {
            const c = makeComposable();
            const page1 = buildProducts(10, 1);
            await c.fetchAll(apiResolve(page1), { lastUpdateKey: pageKey(1) });
            expect(c.itemList.value).toHaveLength(10);
        });

        it('accumulates items from multiple pages', async () => {
            const c = makeComposable();
            const page1 = buildProducts(10, 1);
            const page2 = buildProducts(10, 11);
            await c.fetchAll(apiResolve(page1), { lastUpdateKey: pageKey(1) });
            await c.fetchAll(apiResolve(page2), { lastUpdateKey: pageKey(2) });
            expect(c.itemList.value).toHaveLength(20);
        });

        it('does not re-fetch the same page within TTL', async () => {
            const c = makeComposable();
            const page1 = buildProducts(10, 1);
            const firstCall = jest.fn().mockResolvedValue(page1);
            const secondCall = jest.fn().mockResolvedValue(page1);
            await c.fetchAll(firstCall, { lastUpdateKey: pageKey(1) });
            await c.fetchAll(secondCall, { lastUpdateKey: pageKey(1) });
            expect(firstCall).toHaveBeenCalledTimes(1);
            expect(secondCall).not.toHaveBeenCalled();
        });

        it('re-fetches the same page when TTL has expired', async () => {
            const c = makeComposable(0);
            const page1 = buildProducts(10, 1);
            const firstCall = jest.fn().mockResolvedValue(page1);
            const secondCall = jest.fn().mockResolvedValue(page1);
            await c.fetchAll(firstCall, { lastUpdateKey: pageKey(1) });
            await c.fetchAll(secondCall, { lastUpdateKey: pageKey(1) });
            expect(firstCall).toHaveBeenCalledTimes(1);
            expect(secondCall).toHaveBeenCalledTimes(1);
        });

        it('forced:true always re-fetches the page', async () => {
            const c = makeComposable();
            const page1 = buildProducts(10, 1);
            const firstCall = jest.fn().mockResolvedValue(page1);
            const secondCall = jest.fn().mockResolvedValue(page1);
            await c.fetchAll(firstCall, { lastUpdateKey: pageKey(1) });
            await c.fetchAll(secondCall, { lastUpdateKey: pageKey(1), forced: true });
            expect(secondCall).toHaveBeenCalledTimes(1);
        });

        it('handles an empty last page gracefully', async () => {
            const c = makeComposable();
            await c.fetchAll(apiResolve(buildProducts(10, 1)), { lastUpdateKey: pageKey(1) });
            // server signals end-of-data with an empty array
            await c.fetchAll(apiResolve([]), { lastUpdateKey: pageKey(2), forced: true });
            expect(c.itemList.value).toHaveLength(10);
        });
    });

    // -----------------------------------------------------------------------
    // fetchPaginate — server-driven pagination without filters
    // -----------------------------------------------------------------------
    describe('fetchPaginate — server-driven pagination', () => {
        it('returns items for the requested page', async () => {
            const c = makeComposable();
            const result = await c.fetchPaginate(apiResolve(buildProducts(10, 1)), 1, 10);
            expect(result).toHaveLength(10);
        });

        it('stores returned items in the dictionary', async () => {
            const c = makeComposable();
            await c.fetchPaginate(apiResolve(buildProducts(10, 1)), 1, 10);
            expect(c.getRecord(1)).toBeDefined();
            expect(c.getRecord(10)).toBeDefined();
        });

        it('caches page 1 and page 2 independently', async () => {
            const c = makeComposable();
            const page1Call = jest.fn().mockResolvedValue(buildProducts(10, 1));
            const page2Call = jest.fn().mockResolvedValue(buildProducts(10, 11));
            await c.fetchPaginate(page1Call, 1, 10);
            await c.fetchPaginate(page2Call, 2, 10);
            expect(page1Call).toHaveBeenCalledTimes(1);
            expect(page2Call).toHaveBeenCalledTimes(1);
        });

        it('does not re-fetch the same page within TTL', async () => {
            const c = makeComposable();
            const firstCall = jest.fn().mockResolvedValue(buildProducts(10, 1));
            const secondCall = jest.fn().mockResolvedValue(buildProducts(10, 1));
            await c.fetchPaginate(firstCall, 1, 10);
            await c.fetchPaginate(secondCall, 1, 10);
            expect(firstCall).toHaveBeenCalledTimes(1);
            expect(secondCall).not.toHaveBeenCalled();
        });

        it('re-fetches after TTL has expired', async () => {
            const c = makeComposable(0);
            const firstCall = jest.fn().mockResolvedValue(buildProducts(10, 1));
            const secondCall = jest.fn().mockResolvedValue(buildProducts(10, 1));
            await c.fetchPaginate(firstCall, 1, 10);
            await c.fetchPaginate(secondCall, 1, 10);
            expect(firstCall).toHaveBeenCalledTimes(1);
            expect(secondCall).toHaveBeenCalledTimes(1);
        });

        it('forced:true bypasses the cache', async () => {
            const c = makeComposable();
            const firstCall = jest.fn().mockResolvedValue(buildProducts(10, 1));
            const secondCall = jest.fn().mockResolvedValue(buildProducts(10, 1));
            await c.fetchPaginate(firstCall, 1, 10);
            await c.fetchPaginate(secondCall, 1, 10, { forced: true });
            expect(secondCall).toHaveBeenCalledTimes(1);
        });

        it('different pageSize values produce separate cache entries', async () => {
            const c = makeComposable();
            const call10 = jest.fn().mockResolvedValue(buildProducts(10, 1));
            const call20 = jest.fn().mockResolvedValue(buildProducts(20, 1));
            await c.fetchPaginate(call10, 1, 10);
            await c.fetchPaginate(call20, 1, 20);
            expect(call10).toHaveBeenCalledTimes(1);
            expect(call20).toHaveBeenCalledTimes(1);
        });

        it('handles an empty page without error', async () => {
            const c = makeComposable();
            const result = await c.fetchPaginate(apiResolve([]), 1, 10);
            expect(result).toEqual([]);
        });

        it('accumulates items from multiple pages in the dictionary', async () => {
            const c = makeComposable();
            await c.fetchPaginate(apiResolve(buildProducts(10, 1)), 1, 10);
            await c.fetchPaginate(apiResolve(buildProducts(10, 11)), 2, 10);
            expect(c.itemList.value).toHaveLength(20);
        });

        it('stores the total when apiCall returns a [items, total] tuple', async () => {
            const c = makeComposable();
            const products = buildProducts(10, 1);
            await c.fetchPaginate(apiResolve([products, 150] as [IProduct[], number]), 1, 10);
            // fetchPaginate delegates to fetchSearch with empty filters
            expect(c.searchGetTotal({}, 10)).toBe(150);
        });

        it('searchGet with empty filters retrieves the cached page', async () => {
            const c = makeComposable();
            const products = buildProducts(10, 1);
            await c.fetchPaginate(apiResolve(products), 1, 10);
            const cached = c.searchGet({}, 1, 10);
            expect(cached).toHaveLength(10);
            expect(cached[0]?.id).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // fetchByParent with pagination-like patterns
    // -----------------------------------------------------------------------
    describe('fetchByParent — parent-scoped item listing', () => {
        it('returns items belonging to the given parent', async () => {
            const c = makeComposable();
            const children = buildProducts(5, 1);
            await c.fetchByParent(apiResolve(children), 'category-1' as never);
            const list = c.getListByParent('category-1' as never);
            expect(list).toHaveLength(5);
        });

        it('keeps items for different parents separate', async () => {
            const c = makeComposable();
            await c.fetchByParent(apiResolve(buildProducts(3, 1)), 'category-1' as never);
            await c.fetchByParent(apiResolve(buildProducts(4, 10)), 'category-2' as never);
            expect(c.getListByParent('category-1' as never)).toHaveLength(3);
            expect(c.getListByParent('category-2' as never)).toHaveLength(4);
        });

        it('does not re-fetch within TTL for the same parent', async () => {
            const c = makeComposable();
            const firstCall = jest.fn().mockResolvedValue(buildProducts(3, 1));
            const secondCall = jest.fn().mockResolvedValue(buildProducts(3, 1));
            await c.fetchByParent(firstCall, 'category-1' as never);
            await c.fetchByParent(secondCall, 'category-1' as never);
            expect(secondCall).not.toHaveBeenCalled();
        });
    });
});
