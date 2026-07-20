/**
 * UNIT — search helper functions (pure-ish, cache-adjacent).
 *   - searchKeyGen: stable, order-independent, value/property sensitive
 *   - searchGet: empty when nothing cached; accepts object or pre-serialised key
 *   - searchCleanup: keeps live entries, prunes orphaned ones
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeSearchHook<IArticle, number>();

describe('UNIT · searchKeyGen', () => {
    it('is stable for identical objects', () => {
        const { searchApi } = make();
        expect(searchApi.searchKeyGen({ category: 'tech', page: 1 })).toBe(
            searchApi.searchKeyGen({ category: 'tech', page: 1 })
        );
    });

    it('is independent of property insertion order', () => {
        const { searchApi } = make();
        expect(searchApi.searchKeyGen({ category: 'tech', status: 'active' })).toBe(
            searchApi.searchKeyGen({ status: 'active', category: 'tech' })
        );
    });

    it('differs for different values', () => {
        const { searchApi } = make();
        expect(searchApi.searchKeyGen({ category: 'tech' })).not.toBe(
            searchApi.searchKeyGen({ category: 'sport' })
        );
    });

    it('differs for different properties', () => {
        const { searchApi } = make();
        expect(searchApi.searchKeyGen({ category: 'tech' })).not.toBe(
            searchApi.searchKeyGen({ tag: 'tech' })
        );
    });
});

describe('UNIT · searchGet', () => {
    it('returns [] when nothing is cached', () => {
        const { searchApi } = make();
        expect(searchApi.searchGet({ category: 'missing' }, 1)).toEqual([]);
    });

    it('accepts a pre-serialised string key', async () => {
        const { searchApi } = make();
        const filters = { category: 'tech' };
        await searchApi.fetchSearch(apiResolve(buildArticles(5, 'tech', 1)), filters, 1);
        expect(searchApi.searchGet(searchApi.searchKeyGen(filters), 1)).toHaveLength(5);
    });
});

describe('UNIT · searchCleanup', () => {
    it('keeps entries whose backing query is still live', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(
            apiResolve(buildArticles(3, 'tech', 1)),
            { category: 'tech' },
            1
        );
        searchApi.searchCleanup();
        expect(searchApi.searchGet({ category: 'tech' }, 1)).toHaveLength(3);
    });

    it('prunes entries whose backing query has been evicted', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(
            apiResolve(buildArticles(3, 'tech', 1)),
            { category: 'tech' },
            1
        );
        searchApi.queryClient.clear(); // evict all TanStack entries → orphaned
        searchApi.searchCleanup();
        expect(searchApi.searchGet({ category: 'tech' }, 1)).toEqual([]);
        expect(Object.keys(searchApi.searchCached)).toHaveLength(0);
    });
});
