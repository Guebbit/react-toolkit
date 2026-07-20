/**
 * UNIT — pre-flight freshness checks: checkTarget / checkAll / checkByParent /
 * checkAny / checkPaginate / checkMultiple.
 * (checkSearch lives in useStructureSearchApi — see tests/structureSearchApi/unit/checkSearch.spec.ts)
 *
 * Each check mirrors its fetch* counterpart's query key. Contract asserted here:
 *   - cold cache → false (nothing cached yet)
 *   - after a matching fetch* call → true (would be served from cache)
 *   - a call with a DIFFERENT key (different id / parentId / filters / page / lastUpdateKey)
 *     stays false — checks must not cross-report unrelated cache slots
 *
 * (The TTL boundary itself — true just under TTL, false just past it — lives in
 * ttl/ttl.check.spec.ts, alongside the rest of the freshness suite.)
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { USERS, buildUsers, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

describe('UNIT · checkTarget', () => {
    it('false on a cold cache', () => {
        const c = make();
        expect(c.checkTarget(1)).toBe(false);
    });

    it('true after fetchTarget(id) primed it', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1);
        expect(c.checkTarget(1)).toBe(true);
    });

    it('stays false for a different id', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1);
        expect(c.checkTarget(2)).toBe(false);
    });

    it('respects lastUpdateKey as a separate bucket', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1, { lastUpdateKey: 'v2' });
        expect(c.checkTarget(1)).toBe(false);
        expect(c.checkTarget(1, { lastUpdateKey: 'v2' })).toBe(true);
    });
});

describe('UNIT · checkAll', () => {
    it('false on a cold cache, true after fetchAll', async () => {
        const c = make();
        expect(c.checkAll()).toBe(false);
        await c.fetchAll(apiResolve([...USERS]));
        expect(c.checkAll()).toBe(true);
    });
});

describe('UNIT · checkByParent', () => {
    it('false on a cold cache, true after fetchByParent for that parent only', async () => {
        const c = make();
        expect(c.checkByParent('team-1')).toBe(false);
        await c.fetchByParent(apiResolve(buildUsers(3, 1)), 'team-1');
        expect(c.checkByParent('team-1')).toBe(true);
        expect(c.checkByParent('team-2')).toBe(false);
    });
});

describe('UNIT · checkAny', () => {
    it('always false without a lastUpdateKey (fetchAny never caches that call)', async () => {
        const c = make();
        await c.fetchAny(() => Promise.resolve('ok'));
        expect(c.checkAny()).toBe(false);
    });

    it('true after fetchAny primed the given lastUpdateKey', async () => {
        const c = make();
        expect(c.checkAny('report-1')).toBe(false);
        await c.fetchAny(() => Promise.resolve('ok'), { lastUpdateKey: 'report-1' });
        expect(c.checkAny('report-1')).toBe(true);
    });
});

describe('UNIT · checkPaginate', () => {
    it('false on a cold cache, true after fetchPaginate for the same page/pageSize', async () => {
        const c = make();
        expect(c.checkPaginate(1, 10)).toBe(false);
        await c.fetchPaginate(apiResolve([USERS[0]]), 1, 10);
        expect(c.checkPaginate(1, 10)).toBe(true);
        // a different page is a different bucket
        expect(c.checkPaginate(2, 10)).toBe(false);
    });
});

describe('UNIT · checkMultiple', () => {
    it('reports every id as expired on a cold cache', () => {
        const c = make();
        expect(c.checkMultiple([1, 2, 3])).toEqual({ cachedIds: [], expiredIds: [1, 2, 3] });
    });

    it('splits into cachedIds/expiredIds once some ids are primed', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1);
        const { cachedIds, expiredIds } = c.checkMultiple([1, 2]);
        expect(cachedIds).toEqual([1]);
        expect(expiredIds).toEqual([2]);
    });

    it('empty ids → both lists empty', () => {
        const c = make();
        expect(c.checkMultiple([])).toEqual({ cachedIds: [], expiredIds: [] });
    });
});
