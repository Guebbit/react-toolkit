/**
 * TTL — freshness of fetchSearch over time.
 *   - VALID: repeating the same (filters, page, pageSize) just under TTL → cache hit
 *   - STALE: repeating it past TTL → API called again
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';
import { useFakeClock, advance, restoreClock } from '../../structureRestApi/_helpers/time';

const TTL = 10_000;
const make = () => makeSearchHook<IArticle, number>({ TTL });

beforeEach(() => useFakeClock());
afterEach(() => {
    clearAllInstances();
    restoreClock();
});

describe('TTL · fetchSearch', () => {
    const TECH = buildArticles(5, 'tech', 1);

    it('VALID just under TTL → served from cache', async () => {
        const { searchApi } = make();
        const first = apiResolve(TECH);
        const second = apiResolve(TECH);
        await searchApi.fetchSearch(first, { category: 'tech' }, 1, 10);
        await advance(TTL - 1);
        await searchApi.fetchSearch(second, { category: 'tech' }, 1, 10);
        expect(second).not.toHaveBeenCalled();
    });

    it('STALE past TTL → API called again', async () => {
        const { searchApi } = make();
        const first = apiResolve(TECH);
        const second = apiResolve(TECH);
        await searchApi.fetchSearch(first, { category: 'tech' }, 1, 10);
        await advance(TTL + 1);
        await searchApi.fetchSearch(second, { category: 'tech' }, 1, 10);
        expect(second).toHaveBeenCalledTimes(1);
    });
});
