/**
 * UNIT — fetchByParent: direct contract of the "list for a parent" fetch.
 *   - resolves with items, stores them, links each to the parent
 *   - keeps different parents separate
 *   - skips undefined entries
 *   - re-throws on error
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve, apiReject } from '../_helpers/fakeApi';
import { buildUsers, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

describe('UNIT · fetchByParent', () => {
    it('resolves with the items and links them to the parent', async () => {
        const c = make();
        const children = buildUsers(3, 1);
        const result = await c.fetchByParent(apiResolve(children), 'team-1');
        expect(result).toHaveLength(3);
        expect(c.getListByParent('team-1')).toHaveLength(3);
    });

    it('stores the items in the dictionary', async () => {
        const c = make();
        await c.fetchByParent(apiResolve(buildUsers(2, 1)), 'team-1');
        expect(c.getRecord(1)).toBeDefined();
        expect(c.getRecord(2)).toBeDefined();
    });

    it('keeps children of different parents separate', async () => {
        const c = make();
        await c.fetchByParent(apiResolve(buildUsers(3, 1)), 'team-1');
        await c.fetchByParent(apiResolve(buildUsers(4, 10)), 'team-2');
        expect(c.getListByParent('team-1')).toHaveLength(3);
        expect(c.getListByParent('team-2')).toHaveLength(4);
    });

    it('skips undefined entries', async () => {
        const c = make();
        const children = buildUsers(2, 1);
        await c.fetchByParent(apiResolve([children[0], undefined, children[1]]), 'team-1');
        expect(c.getListByParent('team-1')).toHaveLength(2);
    });

    it('re-throws on error', async () => {
        const c = make();
        await expect(c.fetchByParent(apiReject(), 'team-1')).rejects.toThrow('network error');
    });
});
