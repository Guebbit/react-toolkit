/**
 * INTENTION — belongsTo / hasMany relationships.
 * Children fetched per parent are tracked separately, de-duplicated on refetch,
 * and can be unlinked or moved between parents without touching the records
 * themselves.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { buildUsers, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

describe('INTENTION · parent relations', () => {
    it('keeps separate child lists per parent', async () => {
        const c = make();
        await c.fetchByParent(apiResolve(buildUsers(3, 1)), 'team-1');
        await c.fetchByParent(apiResolve(buildUsers(2, 10)), 'team-2');
        expect(c.getListByParent('team-1')).toHaveLength(3);
        expect(c.getListByParent('team-2')).toHaveLength(2);
    });

    it('does not duplicate children when the same parent is re-fetched', async () => {
        const c = make();
        await c.fetchByParent(apiResolve(buildUsers(2, 1)), 'team-1');
        await c.fetchByParent(apiResolve(buildUsers(2, 1)), 'team-1', { forced: true });
        expect(c.getListByParent('team-1')).toHaveLength(2);
        expect(c.parentHasMany['team-1']).toHaveLength(2);
    });

    it('removeFromParent unlinks a child but keeps the record', async () => {
        const c = make();
        await c.fetchByParent(apiResolve(buildUsers(3, 1)), 'team-1');
        c.removeFromParent('team-1', 1 as never);
        expect(c.getListByParent('team-1')).toHaveLength(2);
        expect(c.getRecord(1)).toBeDefined();
    });

    it('getRecordsByParent returns a dictionary keyed by id', async () => {
        const c = make();
        await c.fetchByParent(apiResolve(buildUsers(2, 1)), 'team-1');
        expect(Object.keys(c.getRecordsByParent('team-1'))).toHaveLength(2);
    });

    it('moves a child from one parent to another', async () => {
        const c = make();
        await c.fetchByParent(apiResolve(buildUsers(2, 1)), 'team-1');
        c.removeFromParent('team-1', 1 as never);
        c.addToParent('team-2', 1 as never);
        expect(c.getListByParent('team-1').map((u) => u.id)).not.toContain(1);
        expect(c.getListByParent('team-2').map((u) => u.id)).toContain(1);
    });
});
