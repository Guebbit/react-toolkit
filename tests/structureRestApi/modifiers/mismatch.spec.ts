/**
 * MODIFIER — mismatch (IMPORTANT): the list I just fetched carries only PARTIAL
 * fields, so it must NOT be treated as the authoritative per-item value.
 *
 * Effects of mismatch:true:
 *   - fetchAll / fetchPaginate (and useStructureSearchApi's fetchSearch, built on
 *     top of it — see tests/structureSearchApi/modifiers/mismatch.spec.ts): skip
 *     seeding the per-item target cache, so a later fetchTarget(id) still hits
 *     the API (it can't trust the partial list).
 *   - fetchByParent: additionally merge (editRecord) rather than replace, so the
 *     partial payload does not wipe fields already known for the item.
 *
 * Contrasted against the default (no mismatch) behaviour in each case.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { USERS, FULL_USER, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

describe('MODIFIER · mismatch', () => {
    describe('fetchAll seeding', () => {
        it('default: seeds target cache → later fetchTarget is a cache hit', async () => {
            const c = makeHook<IUser, number>();
            await c.fetchAll(apiResolve([USERS[0]]));
            const get = apiResolve(USERS[0]);
            await c.fetchTarget(get, 1);
            expect(get).not.toHaveBeenCalled();
        });

        it('mismatch: skips seeding → later fetchTarget hits the API', async () => {
            const c = makeHook<IUser, number>();
            await c.fetchAll(apiResolve([USERS[0]]), { mismatch: true });
            const get = apiResolve(USERS[0]);
            await c.fetchTarget(get, 1);
            expect(get).toHaveBeenCalledTimes(1);
        });
    });

    describe('fetchByParent merge + seeding', () => {
        it('mismatch: merges the partial payload, preserving existing fields', async () => {
            const c = makeHook<IUser, number>();
            await c.fetchTarget(apiResolve(FULL_USER), 1); // full item known
            await c.fetchByParent(apiResolve([{ id: 1, name: 'Alice P' } as IUser]), 'team-1', {
                mismatch: true
            });
            expect(c.getRecord(1)).toEqual({ ...FULL_USER, name: 'Alice P' });
        });

        it('default: replaces the item with the parent payload (drops fields)', async () => {
            const c = makeHook<IUser, number>();
            await c.fetchTarget(apiResolve(FULL_USER), 1);
            await c.fetchByParent(apiResolve([{ id: 1, name: 'Alice P' } as IUser]), 'team-1');
            expect(c.getRecord(1)).toEqual({ id: 1, name: 'Alice P' });
        });

        it('mismatch: skips target seeding → later fetchTarget hits the API', async () => {
            const c = makeHook<IUser, number>();
            await c.fetchByParent(apiResolve([USERS[0]]), 'team-1', { mismatch: true });
            const get = apiResolve(USERS[0]);
            await c.fetchTarget(get, 1);
            expect(get).toHaveBeenCalledTimes(1);
        });

        it('default: seeds target cache → later fetchTarget is a cache hit', async () => {
            const c = makeHook<IUser, number>();
            await c.fetchByParent(apiResolve([USERS[0]]), 'team-1');
            const get = apiResolve(USERS[0]);
            await c.fetchTarget(get, 1);
            expect(get).not.toHaveBeenCalled();
        });
    });
});
