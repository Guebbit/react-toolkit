/**
 * TTL — the pre-flight checks (checkTarget/checkAll/checkByParent/checkMultiple)
 * must agree with their fetch* counterpart about the stale boundary:
 *   - VALID: just UNDER the TTL → check reports true (fetch* would reuse the cache)
 *   - STALE: just PAST the TTL → check reports false (fetch* would hit the network)
 * Plus the per-call TTL override, same as ttl/ttl.get.spec.ts.
 *
 * (checkSearch's TTL behaviour lives in tests/structureSearchApi/ttl/ttl.check.spec.ts)
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

describe('TTL · checkTarget', () => {
    it('VALID just under TTL → true', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1);
        await advance(TTL - 1);
        expect(c.checkTarget(1)).toBe(true);
    });

    it('STALE past TTL → false', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1);
        await advance(TTL + 1);
        expect(c.checkTarget(1)).toBe(false);
    });
});

describe('TTL · checkAll', () => {
    it('VALID just under TTL → true', async () => {
        const c = make();
        await c.fetchAll(apiResolve([...USERS]));
        await advance(TTL - 1);
        expect(c.checkAll()).toBe(true);
    });

    it('STALE past TTL → false', async () => {
        const c = make();
        await c.fetchAll(apiResolve([...USERS]));
        await advance(TTL + 1);
        expect(c.checkAll()).toBe(false);
    });
});

describe('TTL · checkByParent', () => {
    it('VALID just under TTL → true', async () => {
        const c = make();
        await c.fetchByParent(apiResolve(buildUsers(3, 1)), 'team-1');
        await advance(TTL - 1);
        expect(c.checkByParent('team-1')).toBe(true);
    });

    it('STALE past TTL → false', async () => {
        const c = make();
        await c.fetchByParent(apiResolve(buildUsers(3, 1)), 'team-1');
        await advance(TTL + 1);
        expect(c.checkByParent('team-1')).toBe(false);
    });
});

describe('TTL · checkMultiple', () => {
    it('MIXED: id primed early is stale, id primed late is still fresh', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1); // primed at t0
        await advance(6000);
        await c.fetchTarget(apiResolve(USERS[1]), 2); // primed at t6000
        await advance(6000); // now t12000: id1 age 12000 (stale), id2 age 6000 (fresh)

        expect(c.checkMultiple([1, 2])).toEqual({ cachedIds: [2], expiredIds: [1] });
    });
});

describe('TTL · check per-call override', () => {
    it('a SHORT per-call TTL makes checkAll report stale sooner than the composable TTL', async () => {
        const c = make(3_600_000); // composable: 1 hour
        await c.fetchAll(apiResolve([...USERS]), { TTL: 5000 });
        await advance(5001);
        expect(c.checkAll({ TTL: 5000 })).toBe(false);
    });

    it('a LONG per-call TTL keeps checkAll true past the composable TTL', async () => {
        const c = make(1000); // composable: 1 second
        await c.fetchAll(apiResolve([...USERS]), { TTL: 60_000 });
        await advance(30_000);
        expect(c.checkAll({ TTL: 60_000 })).toBe(true);
    });
});
