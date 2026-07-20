/**
 * MODIFIER — mismatch (IMPORTANT): the search page I just fetched carries only
 * PARTIAL fields, so it must NOT be treated as the authoritative per-item value.
 *
 * fetchSearch forwards mismatch straight through to fetchPaginate, which is what
 * actually skips seeding — see tests/structureRestApi/modifiers/mismatch.spec.ts
 * for the underlying fetchAll/fetchPaginate contract this mirrors.
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

describe('MODIFIER · mismatch', () => {
    describe('fetchSearch seeding', () => {
        it('default: seeds target cache → later fetchTarget is a cache hit', async () => {
            const { searchApi } = makeSearchHook<IArticle, number>();
            await searchApi.fetchSearch(
                apiResolve(buildArticles(2, 'tech', 1)),
                { category: 'tech' },
                1
            );
            const get = apiResolve(buildArticles(1, 'tech', 1)[0]);
            await searchApi.fetchTarget(get, 1);
            expect(get).not.toHaveBeenCalled();
        });

        it('mismatch: skips seeding → later fetchTarget hits the API', async () => {
            const { searchApi } = makeSearchHook<IArticle, number>();
            await searchApi.fetchSearch(
                apiResolve(buildArticles(2, 'tech', 1)),
                { category: 'tech' },
                1,
                10,
                {
                    mismatch: true
                }
            );
            const get = apiResolve(buildArticles(1, 'tech', 1)[0]);
            await searchApi.fetchTarget(get, 1);
            expect(get).toHaveBeenCalledTimes(1);
        });
    });
});
