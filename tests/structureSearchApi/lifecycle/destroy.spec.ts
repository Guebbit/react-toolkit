/**
 * LIFECYCLE — teardown contract for searchApi's own destroy()/resetAll().
 *
 * useStructureSearchApi owns its internal restApi, so its destroy()/resetAll()
 * are overridden to reset BOTH halves of the combined store in one call: the
 * item dictionary (restApi) and the search index — searchCached (this
 * composable's own).
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { USERS, type IUser } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

describe('LIFECYCLE · destroy() / resetAll()', () => {
    it('destroy() resets both the item dictionary and the search indexes', async () => {
        const { searchApi } = makeSearchHook<IUser, number>();
        await searchApi.fetchSearch(apiResolve([...USERS]), { role: 'admin' }, 1);
        expect(searchApi.itemList.length).toBeGreaterThan(0);
        expect(Object.keys(searchApi.searchCached)).not.toHaveLength(0);

        searchApi.destroy();

        expect(searchApi.itemList).toHaveLength(0);
        expect(searchApi.searchCached).toEqual({});
        expect(searchApi.searchGet({ role: 'admin' }, 1)).toEqual([]);
    });

    it('resetAll() resets both without touching the TanStack cache', async () => {
        const { searchApi } = makeSearchHook<IUser, number>();
        await searchApi.fetchSearch(apiResolve([...USERS]), { role: 'admin' }, 1);

        searchApi.resetAll();

        expect(searchApi.itemList).toHaveLength(0);
        expect(searchApi.searchCached).toEqual({});
    });

    it('resetSearches() alone clears only the search indexes, not the item dictionary', async () => {
        const { searchApi } = makeSearchHook<IUser, number>();
        await searchApi.fetchSearch(apiResolve([...USERS]), { role: 'admin' }, 1);

        searchApi.resetSearches();

        expect(searchApi.searchCached).toEqual({});
        expect(searchApi.itemList.length).toBeGreaterThan(0);
    });
});
