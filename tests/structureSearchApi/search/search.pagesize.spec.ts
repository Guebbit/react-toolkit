/**
 * SEARCH — pageSize is part of the cache key.
 *   - the same filters+page at different pageSizes are separate buckets
 *   - the same (filters, page, pageSize) is a cache hit
 *   - searchGet must be queried with the matching pageSize
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeSearchHook<IArticle, number>();
const TECH = buildArticles(5, 'tech', 1);
const SPORT = buildArticles(3, 'sport', 100);
const filters = { category: 'tech' };

describe('SEARCH · pageSize dimension', () => {
    it('different pageSizes are separate buckets', async () => {
        const { searchApi } = make();
        const size10 = apiResolve(TECH);
        const size20 = apiResolve(TECH);
        await searchApi.fetchSearch(size10, filters, 1, 10);
        await searchApi.fetchSearch(size20, filters, 1, 20);
        expect(size10).toHaveBeenCalledTimes(1);
        expect(size20).toHaveBeenCalledTimes(1);
    });

    it('default pageSize (10) differs from an explicit 20', async () => {
        const { searchApi } = make();
        const def = apiResolve(TECH);
        const size20 = apiResolve(TECH);
        await searchApi.fetchSearch(def, filters, 1);
        await searchApi.fetchSearch(size20, filters, 1, 20);
        expect(def).toHaveBeenCalledTimes(1);
        expect(size20).toHaveBeenCalledTimes(1);
    });

    it('same (filters, page, pageSize) is a cache hit', async () => {
        const { searchApi } = make();
        const first = apiResolve(TECH);
        const second = apiResolve(TECH);
        await searchApi.fetchSearch(first, filters, 1, 10);
        await searchApi.fetchSearch(second, filters, 1, 10);
        expect(second).not.toHaveBeenCalled();
    });

    it('searchGet returns the results matching the queried pageSize', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(apiResolve(TECH), filters, 1, 10);
        await searchApi.fetchSearch(apiResolve(SPORT), filters, 1, 20);
        expect(searchApi.searchGet(filters, 1, 10).map((a) => a.id)).toEqual(TECH.map((a) => a.id));
        expect(searchApi.searchGet(filters, 1, 20).map((a) => a.id)).toEqual(
            SPORT.map((a) => a.id)
        );
    });

    it('searchGet with a mismatched pageSize returns []', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(apiResolve(TECH), filters, 1, 10);
        expect(searchApi.searchGet(filters, 1, 99)).toEqual([]);
    });
});
