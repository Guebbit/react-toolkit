/**
 * UNIT — pageItemList: correcting the inherited useStructureRestApi
 * pageItemList (a whole-dictionary slice) to be search-scoped instead
 * (searchGet(filters, pageCurrent, pageSize)).
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

describe('UNIT · pageItemList', () => {
    it('reflects the current search page, not the whole dictionary', async () => {
        const { searchApi, filters } = makeSearchHook<IArticle, number>({}, { category: 'tech' });

        const TECH = buildArticles(3, 'tech', 1);
        await searchApi.fetchSearch(() => Promise.resolve(TECH), filters.current, 1, 10);

        expect(searchApi.pageItemList).toEqual(TECH);
    });

    it('stays correct after a DIFFERENT search populates the dictionary too', async () => {
        const { searchApi } = makeSearchHook<IArticle, number, { category: string }>(
            {},
            { category: 'tech' }
        );

        const TECH = buildArticles(3, 'tech', 1);
        const DESIGN = buildArticles(3, 'design', 101);

        await searchApi.fetchSearch(() => Promise.resolve(TECH), { category: 'tech' }, 1, 10);
        // A second, unrelated search adds more records to the same local dictionary
        await searchApi.fetchSearch(() => Promise.resolve(DESIGN), { category: 'design' }, 1, 10);

        // pageItemList is still scoped to { category: 'tech' }, unaffected by the design
        // search sharing the same dictionary — this is the bug the inherited restApi
        // pageItemList (whole-dictionary slice) would NOT protect against.
        expect(searchApi.pageItemList).toEqual(TECH);
    });

    it('updates when pageCurrent changes', async () => {
        const { searchApi, filters } = makeSearchHook<IArticle, number>({}, { category: 'tech' });

        const PAGE1 = buildArticles(10, 'tech', 1);
        const PAGE2 = buildArticles(10, 'tech', 11);
        await searchApi.fetchSearch(() => Promise.resolve(PAGE1), filters.current, 1, 10);
        await searchApi.fetchSearch(() => Promise.resolve(PAGE2), filters.current, 2, 10);

        expect(searchApi.pageItemList).toEqual(PAGE1);
        searchApi.setPageCurrent(2);
        expect(searchApi.pageItemList).toEqual(PAGE2);
    });

    it('updates when filtersSource changes', async () => {
        const { searchApi, filters } = makeSearchHook<IArticle, number, { category: string }>(
            {},
            { category: 'tech' }
        );

        const TECH = buildArticles(3, 'tech', 1);
        const DESIGN = buildArticles(3, 'design', 101);
        await searchApi.fetchSearch(() => Promise.resolve(TECH), { category: 'tech' }, 1, 10);
        await searchApi.fetchSearch(() => Promise.resolve(DESIGN), { category: 'design' }, 1, 10);

        expect(searchApi.pageItemList).toEqual(TECH);
        filters.current = { category: 'design' };
        expect(searchApi.pageItemList).toEqual(DESIGN);
    });
});
