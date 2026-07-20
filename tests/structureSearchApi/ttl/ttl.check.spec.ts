/**
 * TTL — checkSearch must agree with fetchSearch about the stale boundary:
 *   - VALID: just UNDER the TTL → check reports true (fetchSearch would reuse the cache)
 *   - STALE: just PAST the TTL → check reports false (fetchSearch would hit the network)
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { type IUser } from '../../structureRestApi/_helpers/fixtures';
import { useFakeClock, advance, restoreClock } from '../../structureRestApi/_helpers/time';

const TTL = 10_000;
const make = (ttl = TTL) => makeSearchHook<IUser, number>({ TTL: ttl });

beforeEach(() => useFakeClock());
afterEach(() => {
    clearAllInstances();
    restoreClock();
});

describe('TTL · checkSearch', () => {
    it('VALID just under TTL → true', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(apiResolve([{ id: 1 } as IUser]), { role: 'admin' }, 1, 10);
        await advance(TTL - 1);
        expect(searchApi.checkSearch({ role: 'admin' }, 1, 10)).toBe(true);
    });

    it('STALE past TTL → false', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(apiResolve([{ id: 1 } as IUser]), { role: 'admin' }, 1, 10);
        await advance(TTL + 1);
        expect(searchApi.checkSearch({ role: 'admin' }, 1, 10)).toBe(false);
    });
});
