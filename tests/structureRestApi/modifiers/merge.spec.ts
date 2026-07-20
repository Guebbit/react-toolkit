/**
 * MODIFIER — merge: enrich the stored item instead of replacing it.
 *   - default (no merge) → addRecord → fields absent from the response are dropped
 *   - merge: true        → editRecord → absent fields are preserved
 * Verified across fetchAll, fetchTarget, fetchByParent and updateTarget.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { FULL_USER, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

describe('MODIFIER · merge', () => {
    describe('fetchAll', () => {
        it('default replaces (drops absent fields)', async () => {
            const c = make();
            await c.fetchAll(apiResolve([FULL_USER]));
            await c.fetchAll(apiResolve([{ id: 1, name: 'Alice R' } as IUser]), { forced: true });
            expect(c.getRecord(1)).toEqual({ id: 1, name: 'Alice R' });
        });

        it('merge preserves absent fields', async () => {
            const c = make();
            await c.fetchAll(apiResolve([FULL_USER]));
            await c.fetchAll(apiResolve([{ id: 1, name: 'Alice M' } as IUser]), {
                forced: true,
                merge: true
            });
            expect(c.getRecord(1)).toEqual({ ...FULL_USER, name: 'Alice M' });
        });
    });

    describe('fetchTarget', () => {
        it('merge enriches a summary record into a full one', async () => {
            const c = make();
            await c.fetchAll(apiResolve([{ id: 1, name: 'Alice' } as IUser]));
            await c.fetchTarget(apiResolve(FULL_USER), 1, { merge: true, forced: true });
            expect(c.getRecord(1)).toEqual(FULL_USER);
        });
    });

    describe('fetchByParent', () => {
        it('merge keeps existing fields while linking to the parent', async () => {
            const c = make();
            await c.fetchTarget(apiResolve(FULL_USER), 1);
            await c.fetchByParent(apiResolve([{ id: 1, name: 'Alice P' } as IUser]), 'team-1', {
                merge: true
            });
            expect(c.getRecord(1)).toEqual({ ...FULL_USER, name: 'Alice P' });
            expect(c.getListByParent('team-1')).toHaveLength(1);
        });
    });

    describe('updateTarget', () => {
        it('merge merges the server response into the record', async () => {
            const c = make();
            await c.fetchTarget(apiResolve(FULL_USER), 1);
            await c.updateTarget(apiResolve({ name: 'Alice U' } as IUser), { name: 'Alice U' }, 1, {
                merge: true
            });
            expect(c.getRecord(1)).toEqual({ ...FULL_USER, name: 'Alice U' });
        });

        it('default replaces the record with the server response', async () => {
            const c = make();
            await c.fetchTarget(apiResolve(FULL_USER), 1);
            await c.updateTarget(
                apiResolve({ id: 1, name: 'Alice U' } as IUser),
                { name: 'Alice U' },
                1
            );
            expect(c.getRecord(1)).toEqual({ id: 1, name: 'Alice U' });
        });
    });
});
