/**
 * INTENTION — fetchSearch seeds the shared per-item target cache, same as every
 * other producer (see tests/structureRestApi/intention/cross-method-cache.spec.ts).
 * fetchSearch is built on top of fetchPaginate, which does the actual seeding.
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

describe('INTENTION · cross-method cache seeding (search)', () => {
    it('fetchSearch → fetchTarget(id) is served from cache', async () => {
        const { searchApi } = makeSearchHook<IArticle, number>();
        await searchApi.fetchSearch(
            apiResolve(buildArticles(3, 'tech', 1)),
            { category: 'tech' },
            1
        );
        const get = apiResolve(buildArticles(1, 'tech', 1)[0]);
        await searchApi.fetchTarget(get, 1);
        expect(get).not.toHaveBeenCalled();
    });
});
