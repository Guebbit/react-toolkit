/**
 * UNIT — fetchSearch: direct contract of the "search with filters" fetch.
 *   - resolves with matching items and stores them
 *   - records the page→ids mapping (readable via searchGet)
 *   - handles an empty result set
 *   - re-throws on error without polluting the cache
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve, apiReject } from '../../structureRestApi/_helpers/fakeApi';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeSearchHook<IArticle, number>();
const TECH = buildArticles(5, 'tech', 1);

describe('UNIT · fetchSearch', () => {
    it('resolves with the matching items', async () => {
        const { searchApi } = make();
        await expect(
            searchApi.fetchSearch(apiResolve(TECH), { category: 'tech' })
        ).resolves.toHaveLength(5);
    });

    it('stores the items in the dictionary', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(apiResolve(TECH), { category: 'tech' });
        expect(searchApi.getRecord(1)).toEqual(TECH[0]);
    });

    it('records the page→ids mapping for searchGet', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(apiResolve(TECH), { category: 'tech' }, 1);
        expect(searchApi.searchGet({ category: 'tech' }, 1).map((a) => a.id)).toEqual(
            TECH.map((a) => a.id)
        );
    });

    it('handles an empty result set', async () => {
        const { searchApi } = make();
        await expect(searchApi.fetchSearch(apiResolve([]), { category: 'none' })).resolves.toEqual(
            []
        );
    });

    it('re-throws on error and does not cache the failed page', async () => {
        const { searchApi } = make();
        await expect(
            searchApi.fetchSearch(apiReject('server error'), { category: 'tech' }, 1)
        ).rejects.toThrow('server error');
        expect(searchApi.searchGet({ category: 'tech' }, 1)).toEqual([]);
    });
});
