/**
 * INTENTION — a full entity lifecycle against a stateful fake REST server,
 * asserting BOTH the local store and the number of server round-trips at each
 * step (the cache should eliminate redundant GETs).
 *
 * list → open detail (from cache) → edit → create → delete → confirm gone.
 * Plus an optimistic-rollback branch when the server errors.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiReject } from '../_helpers/fakeApi';
import { createServer } from '../_helpers/fakeServer';
import { buildUsers, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

describe('INTENTION · CRUD lifecycle', () => {
    it('walks list → detail → update → create → delete with minimal server hits', async () => {
        const server = createServer<IUser>(buildUsers(3, 1));
        const c = makeHook<IUser, number>();

        // 1. Load the table
        await c.fetchAll(server.list());
        expect(server.calls.list).toBe(1);
        expect(c.itemList).toHaveLength(3);

        // 2. Open a row's detail — seeded by the list fetch, so NO extra GET
        await c.fetchTarget(server.get(1), 1);
        expect(server.calls.get).toBe(0);

        // 3. Edit it — one PUT, optimistic + confirmed
        await c.updateTarget(
            server.update(1, { name: 'User 1 edited' }),
            { name: 'User 1 edited' },
            1
        );
        expect(server.calls.update).toBe(1);
        expect(c.getRecord(1)?.name).toBe('User 1 edited');

        // 3b. Re-opening the detail is still a cache hit (update reseeded it)
        await c.fetchTarget(server.get(1), 1);
        expect(server.calls.get).toBe(0);

        // 4. Create a new one — one POST, appears locally
        const created = await c.createTarget(
            server.create({ name: 'User 4', email: 'user4@example.com' })
        );
        expect(server.calls.create).toBe(1);
        expect(created?.id).toBe(4);
        expect(c.itemList).toHaveLength(4);

        // 5. Delete it — one DELETE, gone locally
        await c.deleteTarget(server.remove(4), 4);
        expect(server.calls.remove).toBe(1);
        expect(c.getRecord(4)).toBeUndefined();

        // 6. Fetching the deleted id now goes to the server (cache invalidated) and returns nothing
        const gone = await c.fetchTarget(server.get(4), 4);
        expect(server.calls.get).toBe(1);
        expect(gone).toBeUndefined();
    });

    it('rolls an optimistic update back when the server rejects', async () => {
        const server = createServer<IUser>(buildUsers(3, 1));
        const c = makeHook<IUser, number>();
        await c.fetchAll(server.list());
        const before = c.getRecord(2);

        await expect(c.updateTarget(apiReject(), { name: 'nope' }, 2)).rejects.toThrow();
        expect(c.getRecord(2)).toEqual(before);
    });

    it('rolls an optimistic delete back when the server rejects', async () => {
        const server = createServer<IUser>(buildUsers(3, 1));
        const c = makeHook<IUser, number>();
        await c.fetchAll(server.list());
        const before = c.getRecord(3);

        await expect(c.deleteTarget(apiReject(), 3)).rejects.toThrow();
        expect(c.getRecord(3)).toEqual(before);
    });
});
