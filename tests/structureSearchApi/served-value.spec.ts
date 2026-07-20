/**
 * VALUE — assert the VALUE that is served, not merely that the network was skipped.
 * See tests/structureRestApi/served-value.spec.ts for the underlying rationale.
 */

import { makeSearchHook, clearAllInstances } from './_helpers/harness';
import { apiResolve } from '../structureRestApi/_helpers/fakeApi';
import { USERS, type IUser } from '../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

describe('VALUE · served on a cache hit (search)', () => {
    it('searchGet: returns items in order with full fields', async () => {
        const { searchApi } = makeSearchHook<IUser, number>();
        await searchApi.fetchSearch(apiResolve([USERS[0], USERS[1], USERS[2]]), { q: 'a' }, 1);
        expect(searchApi.searchGet({ q: 'a' }, 1)).toEqual([USERS[0], USERS[1], USERS[2]]);
    });
});
