/**
 * UNIT — isPageCached / isPaginateCached: would the current filters/pageCurrent/
 * pageSize be served from cache right now, without actually fetching?
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

describe('UNIT · isPageCached / isPaginateCached', () => {
    it('isPageCached reflects whether fetchSearch would be served from cache', async () => {
        const { searchApi, filters } = makeSearchHook<IArticle, number>({}, { category: 'tech' });

        expect(searchApi.isPageCached()).toBe(false);
        await searchApi.fetchSearch(() => Promise.resolve(buildArticles(3)), filters.current, 1, 10);
        expect(searchApi.isPageCached()).toBe(true);
    });

    it('isPaginateCached reflects whether fetchPaginate would be served from cache', async () => {
        const { searchApi } = makeSearchHook<IArticle, number>();

        expect(searchApi.isPaginateCached()).toBe(false);
        await searchApi.fetchPaginate(() => Promise.resolve(buildArticles(3)), 1, 10);
        expect(searchApi.isPaginateCached()).toBe(true);
    });
});
