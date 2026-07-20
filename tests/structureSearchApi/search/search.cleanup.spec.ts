/**
 * SEARCH — searchCleanup keeps memory bounded.
 *   - entries whose backing TanStack query was evicted are pruned
 *   - the number of retained (filters, pageSize) buckets stays bounded (MAX_SEARCHES)
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeSearchHook<IArticle, number>();
const TECH = buildArticles(3, 'tech', 1);
const SPORT = buildArticles(3, 'sport', 100);

describe('SEARCH · cleanup', () => {
    it('prunes an orphaned entry when its query is evicted', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(apiResolve(TECH), { category: 'tech' }, 1, 10);
        expect(searchApi.searchGet({ category: 'tech' }, 1)).toHaveLength(3);

        searchApi.queryClient.clear(); // evict all TanStack entries → tech is now orphaned
        await searchApi.fetchSearch(apiResolve(SPORT), { category: 'sport' }, 1); // triggers cleanup

        expect(searchApi.searchGet({ category: 'tech' }, 1)).toEqual([]);
        expect(searchApi.searchGet({ category: 'sport' }, 1)).toHaveLength(3);
    });

    it('does not prune a live search cached under a lastUpdateKey', async () => {
        const { searchApi } = make();
        // this search lives in a namespaced bucket, not the default '' one
        await searchApi.fetchSearch(apiResolve(TECH), { category: 'tech' }, 1, 10, {
            lastUpdateKey: 'v1'
        });

        // a second, unrelated search triggers cleanup — the tech search is still live
        await searchApi.fetchSearch(apiResolve(SPORT), { category: 'sport' }, 1);

        expect(searchApi.searchGet({ category: 'tech' }, 1, 10)).toHaveLength(3);
    });

    it('keeps the number of retained search buckets bounded (MAX_SEARCHES = 50)', async () => {
        const { searchApi } = make();
        // 60 distinct searches; cleanup runs on each and caps growth
        for (let i = 0; i < 60; i++) {
            await searchApi.fetchSearch(apiResolve(TECH), { bucket: i }, 1, 10);
        }
        // After pruning-to-50 then adding the current one, at most 51 remain.
        expect(Object.keys(searchApi.searchCached).length).toBeLessThanOrEqual(51);
    });
});
