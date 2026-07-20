/**
 * TTL — fetchMultiple batches ONLY the stale ids.
 *
 * Per-id freshness means a single fetchMultiple can mix "near in time" (still
 * fresh, served locally) and "far in time" (stale, refetched) ids. We prime two
 * ids at different moments so their stale windows expire at different times.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';
import { useFakeClock, advance, restoreClock } from '../_helpers/time';

const TTL = 10_000;
const make = () => makeHook<IUser, number>({ TTL });

beforeEach(() => useFakeClock());
afterEach(() => {
    clearAllInstances();
    restoreClock();
});

describe('TTL · fetchMultiple', () => {
    it('ALL fresh (near in time) → no network call', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1);
        await c.fetchTarget(apiResolve(USERS[1]), 2);
        await advance(TTL - 1);
        const batch = apiResolve([USERS[0], USERS[1]]);
        const result = await c.fetchMultiple(batch, [1, 2]);
        expect(batch).not.toHaveBeenCalled();
        expect(result).toHaveLength(2);
    });

    it('ALL stale (far in time) → one batch call', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1);
        await c.fetchTarget(apiResolve(USERS[1]), 2);
        await advance(TTL + 1);
        const batch = apiResolve([USERS[0], USERS[1]]);
        await c.fetchMultiple(batch, [1, 2]);
        expect(batch).toHaveBeenCalledTimes(1);
    });

    it('MIXED: id primed early is stale, id primed late is still fresh → batch runs, fresh one served locally', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1); // primed at t0
        await advance(6000);
        await c.fetchTarget(apiResolve(USERS[1]), 2); // primed at t6000
        await advance(6000); // now t12000: id1 age 12000 (stale), id2 age 6000 (fresh)

        // the caller's batch call fetches the stale id(s); id2 comes from the local cache
        const batch = apiResolve([USERS[0]]);
        const result = await c.fetchMultiple(batch, [1, 2]);
        expect(batch).toHaveBeenCalledTimes(1);
        expect(result.some((u) => u?.id === 1)).toBe(true);
        expect(result.some((u) => u?.id === 2)).toBe(true);
    });
});
