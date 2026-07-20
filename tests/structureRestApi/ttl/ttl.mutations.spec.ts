/**
 * TTL — how mutations interact with per-item freshness.
 *   - createTarget SEEDS a fresh entry → a follow-up fetchTarget is a cache hit
 *     within TTL and a refetch past TTL.
 *   - updateTarget REFRESHES the entry → it resets the stale clock.
 *   - deleteTarget INVALIDATES the entry → the very next fetchTarget refetches.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';
import { useFakeClock, advance, restoreClock } from '../_helpers/time';

const TTL = 10_000;
const make = () => makeHook<IUser, number>({ TTL });
const DAVE: IUser = { id: 4, name: 'Dave', email: 'dave@example.com' };

beforeEach(() => useFakeClock());
afterEach(() => {
    clearAllInstances();
    restoreClock();
});

describe('TTL · createTarget seeds freshness', () => {
    it('VALID: fetchTarget within TTL after create → cache hit', async () => {
        const c = make();
        await c.createTarget(apiResolve(DAVE));
        await advance(TTL - 1);
        const get = apiResolve(DAVE);
        await c.fetchTarget(get, 4);
        expect(get).not.toHaveBeenCalled();
    });

    it('STALE: fetchTarget past TTL after create → refetch', async () => {
        const c = make();
        await c.createTarget(apiResolve(DAVE));
        await advance(TTL + 1);
        const get = apiResolve(DAVE);
        await c.fetchTarget(get, 4);
        expect(get).toHaveBeenCalledTimes(1);
    });
});

describe('TTL · updateTarget resets the stale clock', () => {
    it('an update midway keeps the item fresh past the original TTL', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1); // primed at t0
        await advance(8000);
        await c.updateTarget(apiResolve(USERS[0]), { name: 'Alice 2' }, 1); // refreshes at t8000
        await advance(8000); // t16000: without the refresh this would be stale (age 16000)

        const get = apiResolve(USERS[0]);
        await c.fetchTarget(get, 1);
        expect(get).not.toHaveBeenCalled(); // age since refresh is 8000 < TTL
    });
});

describe('TTL · deleteTarget invalidates immediately', () => {
    it('the next fetchTarget after a delete refetches even within the original TTL', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1);
        await c.deleteTarget(apiResolve({ ok: true }), 1);
        const get = apiResolve(USERS[0]);
        await c.fetchTarget(get, 1); // no time advanced, but the entry is gone
        expect(get).toHaveBeenCalledTimes(1);
    });
});
