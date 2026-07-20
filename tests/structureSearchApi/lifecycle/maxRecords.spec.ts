/**
 * LIFECYCLE — maxRecords wipes the internal restApi's item dictionary from
 * inside its own fetch machinery, bypassing searchApi's public resetAll()/
 * destroy() overrides entirely — so searchCached is left holding dangling ids.
 * Unlike an explicit destroy()/resetAll() call (which resets both halves, see
 * tests/structureSearchApi/lifecycle/destroy.spec.ts), this internal wipe only
 * ever touches the item dictionary. searchGet degrades gracefully (dangling ids
 * are filtered out, not crashed on) rather than crashing, but a caller relying
 * on maxRecords should call resetSearches() too if it matters.
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

describe('LIFECYCLE · maxRecords and searchApi', () => {
    it('a maxRecords wipe leaves searchCached ids dangling — searchGet degrades to a short array', async () => {
        const { searchApi } = makeSearchHook<IArticle, number>({ maxRecords: 10 });
        await searchApi.fetchSearch(
            apiResolve(buildArticles(8, 'tech', 1)),
            { category: 'tech' },
            1
        );
        expect(searchApi.searchGet({ category: 'tech' }, 1)).toHaveLength(8);

        // trip the cap via an unrelated fetch
        await searchApi.fetchAll(apiResolve(buildArticles(5, 'sport', 100)));

        // the ids are still recorded in searchCached, but none resolve anymore
        expect(searchApi.searchGet({ category: 'tech' }, 1)).toEqual([]);
        expect(Object.keys(searchApi.searchCached)).not.toHaveLength(0);

        // resetSearches() clears the dangling entry explicitly
        searchApi.resetSearches();
        expect(searchApi.searchCached).toEqual({});
    });
});
