/**
 * TTL — GET-like freshness for fetchAll / fetchTarget / fetchByParent.
 *
 * For every method we assert BOTH sides of the stale boundary using a fake clock:
 *   - VALID: advancing to just UNDER the TTL → the cached value is reused (no API call)
 *   - STALE: advancing PAST the TTL → the API is called again
 * Plus the per-call TTL override, which can shorten or extend that window.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { USERS, buildUsers, type IUser } from '../_helpers/fixtures';
import { useFakeClock, advance, restoreClock } from '../_helpers/time';

const TTL = 10_000;
const make = (ttl = TTL) => makeHook<IUser, number>({ TTL: ttl });

beforeEach(() => useFakeClock());
afterEach(() => {
    clearAllInstances();
    restoreClock();
});

describe('TTL · fetchAll', () => {
    it('VALID just under TTL → served from cache', async () => {
        const c = make();
        const first = apiResolve([...USERS]);
        const second = apiResolve([...USERS]);
        await c.fetchAll(first);
        await advance(TTL - 1);
        await c.fetchAll(second);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
    });

    it('STALE past TTL → API called again', async () => {
        const c = make();
        const first = apiResolve([...USERS]);
        const second = apiResolve([...USERS]);
        await c.fetchAll(first);
        await advance(TTL + 1);
        await c.fetchAll(second);
        expect(second).toHaveBeenCalledTimes(1);
    });
});

describe('TTL · fetchTarget', () => {
    it('VALID just under TTL → served from cache', async () => {
        const c = make();
        const first = apiResolve(USERS[0]);
        const second = apiResolve(USERS[0]);
        await c.fetchTarget(first, 1);
        await advance(TTL - 1);
        await c.fetchTarget(second, 1);
        expect(second).not.toHaveBeenCalled();
    });

    it('STALE past TTL → API called again', async () => {
        const c = make();
        const first = apiResolve(USERS[0]);
        const second = apiResolve(USERS[0]);
        await c.fetchTarget(first, 1);
        await advance(TTL + 1);
        await c.fetchTarget(second, 1);
        expect(second).toHaveBeenCalledTimes(1);
    });
});

describe('TTL · fetchByParent', () => {
    it('VALID just under TTL → served from cache', async () => {
        const c = make();
        const first = apiResolve(buildUsers(3, 1));
        const second = apiResolve(buildUsers(3, 1));
        await c.fetchByParent(first, 'team-1');
        await advance(TTL - 1);
        await c.fetchByParent(second, 'team-1');
        expect(second).not.toHaveBeenCalled();
    });

    it('STALE past TTL → API called again', async () => {
        const c = make();
        const first = apiResolve(buildUsers(3, 1));
        const second = apiResolve(buildUsers(3, 1));
        await c.fetchByParent(first, 'team-1');
        await advance(TTL + 1);
        await c.fetchByParent(second, 'team-1');
        expect(second).toHaveBeenCalledTimes(1);
    });
});

describe('TTL · per-call override', () => {
    it('a SHORT per-call TTL makes data stale sooner than the composable TTL', async () => {
        const c = make(3_600_000); // composable: 1 hour
        const first = apiResolve([...USERS]);
        const second = apiResolve([...USERS]);
        await c.fetchAll(first, { TTL: 5000 });
        await advance(5001);
        await c.fetchAll(second, { TTL: 5000 });
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('a LONG per-call TTL keeps data valid past the composable TTL', async () => {
        const c = make(1000); // composable: 1 second
        const first = apiResolve([...USERS]);
        const second = apiResolve([...USERS]);
        await c.fetchAll(first, { TTL: 60_000 });
        await advance(30_000);
        await c.fetchAll(second, { TTL: 60_000 });
        expect(second).not.toHaveBeenCalled();
    });
});
