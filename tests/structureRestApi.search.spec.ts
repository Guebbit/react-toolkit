/**
 * structureRestApi — search / filter usage
 *
 * Simulates a page with a search bar (and optional filters) above a results
 * table:
 *   - fetchSearch returns items matching given filter parameters
 *   - Results are cached per (filters + page) combination
 *   - A repeated identical search within TTL does not call the API again
 *   - Different filter objects produce separate cache entries
 *   - Page parameter is independent: page 1 and page 2 of the same query
 *     are cached separately
 *   - searchGet retrieves already-cached results without a new API call
 *   - searchKeyGen produces the same key regardless of property order
 *   - Error handling: a failed search does not pollute the cache
 *
 * All API calls use local in-memory mock functions — no network access needed.
 */

import { act, renderHook } from '@testing-library/react';
import { useStructureRestApi } from '../src/hooks/structureRestApi';

interface IArticle {
    id: number;
    title: string;
    category: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComposable(TTL = 3_600_000) {
    const rendered = renderHook(() => useStructureRestApi<IArticle, number>({ identifiers: 'id', TTL }));
    const current = () => rendered.result.current;
    const valueRef = <T>(getter: () => T, setter?: (value: T) => void) =>
        Object.defineProperty({}, 'value', {
            get: getter,
            set: (value: T) => setter?.(value),
            enumerable: true
        }) as { value: T };

    return {
        fetchSearch: async (...args: any[]) => {
            let result: any;
            await act(async () => {
                result = await (current() as any).fetchSearch(...args);
            });
            return result;
        },
        searchGet: (...args: any[]) => (current() as any).searchGet(...args),
        searchGetTotal: (...args: any[]) => (current() as any).searchGetTotal(...args),
        searchSetTotal: (...args: any[]) => act(() => (current() as any).searchSetTotal(...args)),
        searchKeyGen: (...args: any[]) => (current() as any).searchKeyGen(...args),
        getRecord: (...args: any[]) => (current() as any).getRecord(...args),
        itemList: valueRef(() => current().itemList),
        searchCached: valueRef(() => current().searchCached),
        searchTotals: valueRef(() => current().searchTotals)
    };
}

function apiResolve<T = undefined>(data?: T): () => Promise<T> {
    return jest.fn().mockResolvedValue(data);
}

function apiReject(message = 'server error'): () => Promise<never> {
    return jest.fn().mockRejectedValue(new Error(message));
}

/** Factory to build article fixtures. */
function buildArticles(count: number, category = 'tech', startId = 1): IArticle[] {
    return Array.from({ length: count }, (_, i) => ({
        id: startId + i,
        title: `Article ${startId + i}`,
        category
    }));
}

const TECH_ARTICLES = buildArticles(5, 'tech', 1);
const SPORT_ARTICLES = buildArticles(3, 'sport', 100);
const TECH_PAGE2 = buildArticles(5, 'tech', 6);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('useStructureRestApi — search', () => {
    // -----------------------------------------------------------------------
    // Basic search
    // -----------------------------------------------------------------------
    describe('fetchSearch — basic results', () => {
        it('returns items matching the filter', async () => {
            const c = makeComposable();
            const result = await c.fetchSearch(apiResolve(TECH_ARTICLES), { category: 'tech' });
            expect(result).toHaveLength(5);
        });

        it('stores returned items in itemDictionary', async () => {
            const c = makeComposable();
            await c.fetchSearch(apiResolve(TECH_ARTICLES), { category: 'tech' });
            expect(c.getRecord(1)).toEqual(TECH_ARTICLES[0]);
        });

        it('handles an empty result set without error', async () => {
            const c = makeComposable();
            const result = await c.fetchSearch(apiResolve([]), { category: 'unknown' });
            expect(result).toEqual([]);
        });

        it('returns items for different filter values independently', async () => {
            const c = makeComposable();
            await c.fetchSearch(apiResolve(TECH_ARTICLES), { category: 'tech' });
            await c.fetchSearch(apiResolve(SPORT_ARTICLES), { category: 'sport' });
            expect(c.getRecord(1)).toEqual(TECH_ARTICLES[0]);
            expect(c.getRecord(100)).toEqual(SPORT_ARTICLES[0]);
        });
    });

    // -----------------------------------------------------------------------
    // searchKeyGen
    // -----------------------------------------------------------------------
    describe('searchKeyGen — stable cache key generation', () => {
        it('produces the same key for the same object', () => {
            const c = makeComposable();
            const key1 = c.searchKeyGen({ category: 'tech', page: 1 });
            const key2 = c.searchKeyGen({ category: 'tech', page: 1 });
            expect(key1).toBe(key2);
        });

        it('produces the same key regardless of property insertion order', () => {
            const c = makeComposable();
            const key1 = c.searchKeyGen({ category: 'tech', status: 'active' });
            const key2 = c.searchKeyGen({ status: 'active', category: 'tech' });
            expect(key1).toBe(key2);
        });

        it('produces different keys for different filter values', () => {
            const c = makeComposable();
            const key1 = c.searchKeyGen({ category: 'tech' });
            const key2 = c.searchKeyGen({ category: 'sport' });
            expect(key1).not.toBe(key2);
        });

        it('produces different keys for different filter properties', () => {
            const c = makeComposable();
            const key1 = c.searchKeyGen({ category: 'tech' });
            const key2 = c.searchKeyGen({ tag: 'tech' });
            expect(key1).not.toBe(key2);
        });
    });

    // -----------------------------------------------------------------------
    // TTL / caching
    // -----------------------------------------------------------------------
    describe('fetchSearch — TTL caching', () => {
        it('does NOT call the API again for the same query within TTL', async () => {
            const c = makeComposable();
            const firstCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            const secondCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            await c.fetchSearch(firstCall, { category: 'tech' }, 1);
            await c.fetchSearch(secondCall, { category: 'tech' }, 1);
            expect(firstCall).toHaveBeenCalledTimes(1);
            expect(secondCall).not.toHaveBeenCalled();
        });

        it('calls the API again when the TTL has expired', async () => {
            const c = makeComposable(0); // TTL = 0 ⇒ always expired
            const firstCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            const secondCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            await c.fetchSearch(firstCall, { category: 'tech' }, 1);
            await c.fetchSearch(secondCall, { category: 'tech' }, 1);
            expect(firstCall).toHaveBeenCalledTimes(1);
            expect(secondCall).toHaveBeenCalledTimes(1);
        });

        it('calls the API again when forced: true', async () => {
            const c = makeComposable();
            const firstCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            const secondCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            await c.fetchSearch(firstCall, { category: 'tech' }, 1);
            await c.fetchSearch(secondCall, { category: 'tech' }, 1, 0, { forced: true });
            expect(secondCall).toHaveBeenCalledTimes(1);
        });

        it('caches different filter queries separately', async () => {
            const c = makeComposable();
            const techCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            const sportCall = jest.fn().mockResolvedValue(SPORT_ARTICLES);
            // First search
            await c.fetchSearch(techCall, { category: 'tech' }, 1);
            // Different filter → should NOT be served from cache
            await c.fetchSearch(sportCall, { category: 'sport' }, 1);
            expect(techCall).toHaveBeenCalledTimes(1);
            expect(sportCall).toHaveBeenCalledTimes(1);
        });

        it('caches different pages of the same query separately', async () => {
            const c = makeComposable();
            const page1Call = jest.fn().mockResolvedValue(TECH_ARTICLES);
            const page2Call = jest.fn().mockResolvedValue(TECH_PAGE2);
            await c.fetchSearch(page1Call, { category: 'tech' }, 1);
            await c.fetchSearch(page2Call, { category: 'tech' }, 2);
            expect(page1Call).toHaveBeenCalledTimes(1);
            expect(page2Call).toHaveBeenCalledTimes(1);
        });

        it('returns cached items for a subsequent page-1 call within TTL', async () => {
            const c = makeComposable();
            await c.fetchSearch(
                jest.fn().mockResolvedValue(TECH_ARTICLES),
                { category: 'tech' },
                1
            );
            const cachedCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            await c.fetchSearch(cachedCall, { category: 'tech' }, 1);
            expect(cachedCall).not.toHaveBeenCalled();
        });
    });

    // -----------------------------------------------------------------------
    // searchGet
    // -----------------------------------------------------------------------
    describe('searchGet — retrieve cached search results', () => {
        it('returns the cached items for a previously executed search', async () => {
            const c = makeComposable();
            await c.fetchSearch(apiResolve(TECH_ARTICLES), { category: 'tech' }, 1);
            const cached = c.searchGet({ category: 'tech' }, 1);
            expect(cached).toHaveLength(5);
            expect(cached[0]).toEqual(TECH_ARTICLES[0]);
        });

        it('returns an empty array when there is no cached result for the query', () => {
            const c = makeComposable();
            const result = c.searchGet({ category: 'missing' }, 1);
            expect(result).toEqual([]);
        });

        it('returns the correct page from a multi-page search', async () => {
            const c = makeComposable();
            await c.fetchSearch(apiResolve(TECH_ARTICLES), { category: 'tech' }, 1);
            await c.fetchSearch(apiResolve(TECH_PAGE2), { category: 'tech' }, 2);

            const page1 = c.searchGet({ category: 'tech' }, 1);
            const page2 = c.searchGet({ category: 'tech' }, 2);

            expect(page1.map((a: IArticle) => a.id)).toEqual(TECH_ARTICLES.map((a) => a.id));
            expect(page2.map((a: IArticle) => a.id)).toEqual(TECH_PAGE2.map((a) => a.id));
        });

        it('accepts a pre-serialised string key', async () => {
            const c = makeComposable();
            const filters = { category: 'tech' };
            await c.fetchSearch(apiResolve(TECH_ARTICLES), filters, 1);
            const key = c.searchKeyGen(filters);
            const cached = c.searchGet(key, 1);
            expect(cached).toHaveLength(5);
        });
    });

    // -----------------------------------------------------------------------
    // searchCached state
    // -----------------------------------------------------------------------
    describe('searchCached — internal cache structure', () => {
        it('is empty before any search', () => {
            const c = makeComposable();
            expect(Object.keys(c.searchCached.value)).toHaveLength(0);
        });

        it('contains an entry for each unique query after searches', async () => {
            const c = makeComposable();
            await c.fetchSearch(apiResolve(TECH_ARTICLES), { category: 'tech' }, 1);
            await c.fetchSearch(apiResolve(SPORT_ARTICLES), { category: 'sport' }, 1);
            expect(Object.keys(c.searchCached.value)).toHaveLength(2);
        });

        it('stores the correct item ids under the right page', async () => {
            const c = makeComposable();
            await c.fetchSearch(apiResolve(TECH_ARTICLES), { category: 'tech' }, 1);
            // cacheKey = searchKey + ':' + pageSize; pageSize defaults to 10
            const cacheKey = c.searchKeyGen({ category: 'tech' }) + ':10';
            const page1Ids = c.searchCached.value[cacheKey]?.[1] ?? [];
            expect(page1Ids).toEqual(TECH_ARTICLES.map((a) => a.id));
        });
    });

    // -----------------------------------------------------------------------
    // Error handling
    // -----------------------------------------------------------------------
    describe('fetchSearch — error handling', () => {
        it('re-throws API errors', async () => {
            const c = makeComposable();
            await expect(c.fetchSearch(apiReject(), { category: 'tech' }, 1)).rejects.toThrow(
                'server error'
            );
        });

        it('allows a retry after a failed search (TTL is reset on error)', async () => {
            const c = makeComposable();
            // First call fails
            await expect(c.fetchSearch(apiReject(), { category: 'tech' }, 1)).rejects.toThrow();

            // Second call should succeed (error must have cleared the TTL entry)
            const retryCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            await c.fetchSearch(retryCall, { category: 'tech' }, 1);
            expect(retryCall).toHaveBeenCalledTimes(1);
        });

        it('does not cache results from a failed search', async () => {
            const c = makeComposable();
            await expect(c.fetchSearch(apiReject(), { category: 'tech' }, 1)).rejects.toThrow();
            const cached = c.searchGet({ category: 'tech' }, 1);
            expect(cached).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // pageSize as a cache dimension
    // -----------------------------------------------------------------------
    describe('fetchSearch — pageSize cache dimension', () => {
        it('different pageSize values produce separate cache entries', async () => {
            const c = makeComposable();
            const call10 = jest.fn().mockResolvedValue(TECH_ARTICLES);
            const call20 = jest.fn().mockResolvedValue(TECH_ARTICLES);
            await c.fetchSearch(call10, { category: 'tech' }, 1, 10);
            await c.fetchSearch(call20, { category: 'tech' }, 1, 20);
            expect(call10).toHaveBeenCalledTimes(1);
            expect(call20).toHaveBeenCalledTimes(1);
        });

        it('same (filters, page, pageSize) hits cache within TTL', async () => {
            const c = makeComposable();
            const firstCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            const secondCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            await c.fetchSearch(firstCall, { category: 'tech' }, 1, 10);
            await c.fetchSearch(secondCall, { category: 'tech' }, 1, 10);
            expect(firstCall).toHaveBeenCalledTimes(1);
            expect(secondCall).not.toHaveBeenCalled();
        });

        it('pageSize=10 (default) and pageSize=20 are independent cache entries', async () => {
            const c = makeComposable();
            const defaultCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            const sized20Call = jest.fn().mockResolvedValue(TECH_ARTICLES);
            await c.fetchSearch(defaultCall, { category: 'tech' }, 1);
            await c.fetchSearch(sized20Call, { category: 'tech' }, 1, 20);
            expect(defaultCall).toHaveBeenCalledTimes(1);
            expect(sized20Call).toHaveBeenCalledTimes(1);
        });

        it('searchGet with matching pageSize returns the correct items', async () => {
            const c = makeComposable();
            await c.fetchSearch(apiResolve(TECH_ARTICLES), { category: 'tech' }, 1, 10);
            await c.fetchSearch(apiResolve(SPORT_ARTICLES), { category: 'tech' }, 1, 20);
            const result10 = c.searchGet({ category: 'tech' }, 1, 10);
            const result20 = c.searchGet({ category: 'tech' }, 1, 20);
            expect(result10.map((a: IArticle) => a.id)).toEqual(TECH_ARTICLES.map((a) => a.id));
            expect(result20.map((a: IArticle) => a.id)).toEqual(SPORT_ARTICLES.map((a) => a.id));
        });

        it('searchGet with mismatched pageSize returns empty', async () => {
            const c = makeComposable();
            await c.fetchSearch(apiResolve(TECH_ARTICLES), { category: 'tech' }, 1, 10);
            expect(c.searchGet({ category: 'tech' }, 1, 99)).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // searchTotals — server-reported total count
    // -----------------------------------------------------------------------
    describe('searchTotals — server-reported total count', () => {
        it('searchGetTotal returns undefined when apiCall returned a plain array', async () => {
            const c = makeComposable();
            await c.fetchSearch(apiResolve(TECH_ARTICLES), { category: 'tech' }, 1, 10);
            expect(c.searchGetTotal({ category: 'tech' }, 10)).toBeUndefined();
        });

        it('stores the total when apiCall returns a [items, total] tuple', async () => {
            const c = makeComposable();
            await c.fetchSearch(
                apiResolve([TECH_ARTICLES, 42] as [typeof TECH_ARTICLES, number]),
                { category: 'tech' },
                1,
                10
            );
            expect(c.searchGetTotal({ category: 'tech' }, 10)).toBe(42);
        });

        it('different (filters, pageSize) pairs have independent totals', async () => {
            const c = makeComposable();
            await c.fetchSearch(
                apiResolve([TECH_ARTICLES, 42] as [typeof TECH_ARTICLES, number]),
                { category: 'tech' },
                1,
                10
            );
            await c.fetchSearch(
                apiResolve([SPORT_ARTICLES, 7] as [typeof SPORT_ARTICLES, number]),
                { category: 'sport' },
                1,
                10
            );
            expect(c.searchGetTotal({ category: 'tech' }, 10)).toBe(42);
            expect(c.searchGetTotal({ category: 'sport' }, 10)).toBe(7);
        });

        it('searchSetTotal stores a value that searchGetTotal retrieves', () => {
            const c = makeComposable();
            c.searchSetTotal({ category: 'tech' }, 99, 10);
            expect(c.searchGetTotal({ category: 'tech' }, 10)).toBe(99);
        });

        it('searchSetTotal is scoped to pageSize — different pageSize is independent', () => {
            const c = makeComposable();
            c.searchSetTotal({ category: 'tech' }, 99, 10);
            expect(c.searchGetTotal({ category: 'tech' }, 20)).toBeUndefined();
        });

        it('plain-array response does not overwrite a manually set total', async () => {
            const c = makeComposable();
            c.searchSetTotal({ category: 'tech' }, 99, 10);
            await c.fetchSearch(apiResolve(TECH_ARTICLES), { category: 'tech' }, 1, 10, {
                forced: true
            });
            expect(c.searchGetTotal({ category: 'tech' }, 10)).toBe(99);
        });
    });

    // -----------------------------------------------------------------------
    // Typical "search-as-you-type" usage flow
    // -----------------------------------------------------------------------
    describe('end-to-end search flow', () => {
        it('simulates a user typing and refining a search query', async () => {
            const c = makeComposable();

            // User types "t" → broad search
            const broadCall = jest.fn().mockResolvedValue([...TECH_ARTICLES, ...SPORT_ARTICLES]);
            await c.fetchSearch(broadCall, { q: 't' }, 1);
            expect(c.itemList.value.length).toBeGreaterThanOrEqual(8);

            // User types "te" → narrower search (different cache key)
            const narrowCall = jest.fn().mockResolvedValue(TECH_ARTICLES);
            await c.fetchSearch(narrowCall, { q: 'te' }, 1);
            expect(narrowCall).toHaveBeenCalledTimes(1);

            // User clears and re-types "t" → served from cache
            const cachedBroadCall = jest
                .fn()
                .mockResolvedValue([...TECH_ARTICLES, ...SPORT_ARTICLES]);
            await c.fetchSearch(cachedBroadCall, { q: 't' }, 1);
            expect(cachedBroadCall).not.toHaveBeenCalled();
        });

        it('simulates paginating through search results', async () => {
            const c = makeComposable();
            const filters = { category: 'tech' };

            // Fetch pages 1 through 3
            await c.fetchSearch(apiResolve(TECH_ARTICLES), filters, 1);
            await c.fetchSearch(apiResolve(TECH_PAGE2), filters, 2);
            await c.fetchSearch(apiResolve(buildArticles(2, 'tech', 11)), filters, 3);

            // All items should be in the dictionary
            expect(c.itemList.value.length).toBe(12);

            // Each page should be independently cached
            expect(c.searchGet(filters, 1)).toHaveLength(5);
            expect(c.searchGet(filters, 2)).toHaveLength(5);
            expect(c.searchGet(filters, 3)).toHaveLength(2);
        });
    });
});
