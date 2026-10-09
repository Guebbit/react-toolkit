/**
 * TTL — a zero (or negative) staleTime means "never fresh": every call refetches,
 * and every pre-flight check reports a miss. This pins the `staleTime <= 0` guard
 * in isFresh, which the default 1-hour-TTL suite never exercises.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

describe('TTL · zero / non-positive staleTime is never fresh', () => {
    it('fetchAll with TTL 0 refetches every time', async () => {
        const c = makeHook<IUser, number>({ TTL: 0 });
        const first = apiResolve([...USERS]);
        const second = apiResolve([...USERS]);
        await c.fetchAll(first);
        await c.fetchAll(second);
        expect(second).toHaveBeenCalledTimes(1); // not served from cache
    });

    it('checkAll / checkTarget report a miss when TTL is 0', async () => {
        const c = makeHook<IUser, number>({ TTL: 0 });
        await c.fetchAll(apiResolve([...USERS]));
        await c.fetchTarget(apiResolve(USERS[0]), 1);

        expect(c.checkAll()).toBe(false);
        expect(c.checkTarget(1)).toBe(false);
    });

    it('a per-call TTL of 0 overrides a fresh default TTL and forces a refetch', async () => {
        const c = makeHook<IUser, number>(); // default 1h TTL
        const first = apiResolve([...USERS]);
        const second = apiResolve([...USERS]);
        await c.fetchAll(first, { lastUpdateKey: 'k' });
        await c.fetchAll(second, { lastUpdateKey: 'k', TTL: 0 });
        expect(second).toHaveBeenCalledTimes(1);
        expect(c.checkAll({ lastUpdateKey: 'k', TTL: 0 })).toBe(false);
    });

    it('a negative TTL is treated the same as zero', async () => {
        const c = makeHook<IUser, number>({ TTL: -1 });
        const first = apiResolve([...USERS]);
        const second = apiResolve([...USERS]);
        await c.fetchAll(first);
        await c.fetchAll(second);
        expect(second).toHaveBeenCalledTimes(1);
        expect(c.checkAll()).toBe(false);
    });
});
