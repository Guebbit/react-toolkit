/**
 * MODIFIER — forced: bypass a still-fresh cache entry and re-hit the API.
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

describe('MODIFIER · forced', () => {
    it('fetchSearch: forced re-hits the API', async () => {
        const { searchApi } = makeSearchHook<IArticle, number>();
        const first = apiResolve(buildArticles(5, 'tech', 1));
        const second = apiResolve(buildArticles(5, 'tech', 1));
        await searchApi.fetchSearch(first, { category: 'tech' }, 1);
        await searchApi.fetchSearch(second, { category: 'tech' }, 1, 10, { forced: true });
        expect(second).toHaveBeenCalledTimes(1);
    });
});
