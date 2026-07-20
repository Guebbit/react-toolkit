/**
 * SEARCH — pages of the same query are cached independently.
 *   - page 1 and page 2 of one query each trigger their own API call
 *   - each page is retrievable via searchGet
 *   - re-requesting a cached page within TTL is a cache hit
 *   - navigating forward then back to a cached page does not refetch
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeSearchHook<IArticle, number>();
const PAGE1 = buildArticles(5, 'tech', 1);
const PAGE2 = buildArticles(5, 'tech', 6);
const PAGE3 = buildArticles(2, 'tech', 11);
const filters = { category: 'tech' };

describe('SEARCH · pages', () => {
    it('different pages of the same query each call the API', async () => {
        const { searchApi } = make();
        const p1 = apiResolve(PAGE1);
        const p2 = apiResolve(PAGE2);
        await searchApi.fetchSearch(p1, filters, 1);
        await searchApi.fetchSearch(p2, filters, 2);
        expect(p1).toHaveBeenCalledTimes(1);
        expect(p2).toHaveBeenCalledTimes(1);
    });

    it('each page is retrievable via searchGet', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(apiResolve(PAGE1), filters, 1);
        await searchApi.fetchSearch(apiResolve(PAGE2), filters, 2);
        await searchApi.fetchSearch(apiResolve(PAGE3), filters, 3);
        expect(searchApi.searchGet(filters, 1).map((a) => a.id)).toEqual(PAGE1.map((a) => a.id));
        expect(searchApi.searchGet(filters, 2).map((a) => a.id)).toEqual(PAGE2.map((a) => a.id));
        expect(searchApi.searchGet(filters, 3).map((a) => a.id)).toEqual(PAGE3.map((a) => a.id));
    });

    it('re-requesting a cached page within TTL is a cache hit', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(apiResolve(PAGE1), filters, 1);
        const again = apiResolve(PAGE1);
        await searchApi.fetchSearch(again, filters, 1);
        expect(again).not.toHaveBeenCalled();
    });

    it('navigating forward then back to page 1 does not refetch page 1', async () => {
        const { searchApi } = make();
        const p1 = apiResolve(PAGE1);
        await searchApi.fetchSearch(p1, filters, 1);
        await searchApi.fetchSearch(apiResolve(PAGE2), filters, 2);
        const p1Again = apiResolve(PAGE1);
        await searchApi.fetchSearch(p1Again, filters, 1);
        expect(p1).toHaveBeenCalledTimes(1);
        expect(p1Again).not.toHaveBeenCalled();
    });

    it('all pages accumulate in the dictionary', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(apiResolve(PAGE1), filters, 1);
        await searchApi.fetchSearch(apiResolve(PAGE2), filters, 2);
        await searchApi.fetchSearch(apiResolve(PAGE3), filters, 3);
        expect(searchApi.itemList).toHaveLength(12);
    });
});
