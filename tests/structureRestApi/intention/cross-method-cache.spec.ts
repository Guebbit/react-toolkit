/**
 * INTENTION — one shared freshness map across every method.
 *
 * Any method that produces items (list/search/parent fetches, create, update)
 * SEEDS the per-item target cache, so a subsequent fetchTarget / fetchMultiple
 * for those ids is served without touching the network. This is the payoff of
 * "TanStack Query as the single source of truth".
 *
 * The last test locks the return-value contract: producers seed the item as
 * `{ data }` via seedTarget and fetchTarget unwraps it, so a warm fetchTarget both
 * skips the network and resolves the item (this was the `{ data }` wrapping bug).
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

describe('INTENTION · cross-method cache seeding', () => {
    it('fetchAll → fetchTarget(id) is served from cache', async () => {
        const c = makeHook<IUser, number>();
        await c.fetchAll(apiResolve([...USERS]));
        const get = apiResolve(USERS[0]);
        await c.fetchTarget(get, 1);
        expect(get).not.toHaveBeenCalled();
        expect(c.getRecord(1)).toEqual(USERS[0]);
    });

    it('fetchAll → fetchMultiple(ids) serves every id from cache', async () => {
        const c = makeHook<IUser, number>();
        await c.fetchAll(apiResolve([...USERS]));
        const batch = apiResolve([...USERS]);
        const result = await c.fetchMultiple(batch, [1, 2, 3]);
        expect(batch).not.toHaveBeenCalled();
        expect(result).toHaveLength(3);
    });

    it('fetchByParent → fetchTarget(id) is served from cache', async () => {
        const c = makeHook<IUser, number>();
        await c.fetchByParent(apiResolve([...USERS]), 'team-1');
        const get = apiResolve(USERS[0]);
        await c.fetchTarget(get, 1);
        expect(get).not.toHaveBeenCalled();
    });

    it('createTarget → fetchTarget(id) is served from cache', async () => {
        const c = makeHook<IUser, number>();
        const created: IUser = { id: 4, name: 'Dave', email: 'dave@example.com' };
        await c.createTarget(apiResolve(created));
        const get = apiResolve(created);
        await c.fetchTarget(get, 4);
        expect(get).not.toHaveBeenCalled();
    });

    it('updateTarget → fetchTarget(id) is served from cache', async () => {
        const c = makeHook<IUser, number>();
        await c.fetchTarget(apiResolve(USERS[0]), 1);
        await c.updateTarget(apiResolve(USERS[0]), { name: 'Alice 2' }, 1);
        const get = apiResolve(USERS[0]);
        await c.fetchTarget(get, 1);
        expect(get).not.toHaveBeenCalled();
    });

    // ---------------------------------------------------------------------
    // Return-value contract: a warm fetchTarget skips the network AND resolves
    // the seeded item (producers seed { data } via seedTarget, fetchTarget unwraps).
    // ---------------------------------------------------------------------
    it('fetchTarget RETURNS the item seeded by a prior list fetch (network skipped)', async () => {
        const c = makeHook<IUser, number>();
        await c.fetchAll(apiResolve([...USERS]));
        const get = apiResolve(USERS[0]);
        const result = await c.fetchTarget(get, 1);
        expect(get).not.toHaveBeenCalled();
        expect(result).toEqual(USERS[0]);
    });
});
