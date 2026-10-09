/**
 * INTENTION — a created or deleted record invalidates the cached LIST-shaped
 * queries (all / paginate / parent), so the next list fetch re-hits the server
 * and reflects the change, while UNRELATED caches (a plain fetchAny) are left
 * fresh.
 *
 * This pins invalidateListQueries' predicate: each of the three kinds must be
 * invalidated, and nothing else.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { createServer } from '../_helpers/fakeServer';
import { buildUsers, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

describe('INTENTION · list invalidation on create/delete', () => {
    it('createTarget invalidates all / paginate / parent caches → each refetches once', async () => {
        const server = createServer<IUser>(buildUsers(3, 1));
        const c = makeHook<IUser, number>();

        // prime one cache of each list-shaped kind
        await c.fetchAll(server.list());
        await c.fetchPaginate(
            server.search(() => true, 1, 10),
            1,
            10
        );
        await c.fetchByParent(server.list(), 7);
        expect(server.calls.list).toBe(2); // fetchAll + fetchByParent
        expect(server.calls.search).toBe(1); // fetchPaginate

        // a create must mark every list-shaped query stale
        await c.createTarget(server.create({ name: 'User 4', email: 'u4@e.com' }));

        // each kind refetches on next access (was invalidated)
        await c.fetchAll(server.list());
        await c.fetchPaginate(
            server.search(() => true, 1, 10),
            1,
            10
        );
        await c.fetchByParent(server.list(), 7);

        expect(server.calls.list).toBe(4); // both list-backed fetches ran again
        expect(server.calls.search).toBe(2); // paginate ran again
    });

    it('deleteTarget invalidates the same list-shaped caches', async () => {
        const server = createServer<IUser>(buildUsers(3, 1));
        const c = makeHook<IUser, number>();

        await c.fetchAll(server.list());
        expect(server.calls.list).toBe(1);

        await c.deleteTarget(server.remove(3), 3);

        await c.fetchAll(server.list());
        expect(server.calls.list).toBe(2); // refetched after the delete invalidated it
    });

    it('leaves UNRELATED caches fresh: a plain fetchAny is not invalidated by a create', async () => {
        const server = createServer<IUser>(buildUsers(3, 1));
        const c = makeHook<IUser, number>();

        const meta = jest.fn(() => Promise.resolve({ ok: true }));
        await c.fetchAny(meta, { lastUpdateKey: 'meta' });
        expect(meta).toHaveBeenCalledTimes(1);

        await c.createTarget(server.create({ name: 'User 4', email: 'u4@e.com' }));

        await c.fetchAny(meta, { lastUpdateKey: 'meta' });
        expect(meta).toHaveBeenCalledTimes(1); // still fresh — 'any' is not a list kind
    });

    it('leaves a per-id target cache fresh: fetchTarget is not a list kind either', async () => {
        const server = createServer<IUser>(buildUsers(3, 1));
        const c = makeHook<IUser, number>();

        await c.fetchTarget(server.get(1), 1);
        expect(server.calls.get).toBe(1);

        await c.createTarget(server.create({ name: 'User 4', email: 'u4@e.com' }));

        await c.fetchTarget(server.get(1), 1);
        expect(server.calls.get).toBe(1); // untouched: a new record says nothing about user 1
    });
});
