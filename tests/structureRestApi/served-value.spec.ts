/**
 * VALUE — assert the VALUE that is served, not merely that the network was skipped.
 *
 * The rest of the suite mostly checks `expect(mock).not.toHaveBeenCalled()`. That
 * proves plumbing, not correctness: a cache that returned garbage would pass. These
 * tests pin the actual data returned/stored on both cache hits and refetches.
 *
 * The last test covers what used to be the `{ data }` wrapping bug: a fetchTarget
 * served from a *seeding* fetch (list/search/parent/create/update) must resolve the
 * item, just like one served from fetchTarget's own cache. Both now go through the
 * same `{ data }` shape (seedTarget), so both work.
 */

import { makeHook, clearAllInstances } from './_helpers/harness';
import { apiResolve } from './_helpers/fakeApi';
import { USERS, type IUser } from './_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();
const v = (role: string): IUser => ({ id: 1, name: 'Alice', email: 'a@x.com', role });

describe('VALUE · served on a cache hit', () => {
    it('fetchAll: a cache hit serves the ORIGINAL value (a differing later response is never applied)', async () => {
        const c = make();
        await c.fetchAll(apiResolve([v('v1')]));
        const later = apiResolve([v('v2')]);
        await c.fetchAll(later); // within TTL → cache hit
        expect(later).not.toHaveBeenCalled();
        expect(c.getRecord(1)?.role).toBe('v1');
    });

    it('forced: a refetch REPLACES the stored value (not just re-calls the API)', async () => {
        const c = make();
        await c.fetchAll(apiResolve([v('v1')]));
        await c.fetchAll(apiResolve([v('v2')]), { forced: true });
        expect(c.getRecord(1)?.role).toBe('v2');
    });

    it('fetchTarget (cold): resolves the full item', async () => {
        const c = make();
        await expect(c.fetchTarget(apiResolve(USERS[0]), 1)).resolves.toEqual(USERS[0]);
    });

    it('fetchTarget (warm from a prior fetchTarget): resolves the item from cache', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1);
        const second = apiResolve(USERS[0]);
        await expect(c.fetchTarget(second, 1)).resolves.toEqual(USERS[0]);
        expect(second).not.toHaveBeenCalled();
    });

    it('fetchMultiple (warm): resolves items with their full fields, not just the right count', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1);
        await c.fetchTarget(apiResolve(USERS[1]), 2);
        const batch = apiResolve([USERS[0], USERS[1]]);
        const result = await c.fetchMultiple(batch, [1, 2]);
        expect(batch).not.toHaveBeenCalled();
        expect(result).toEqual(expect.arrayContaining([USERS[0], USERS[1]]));
    });

    it('fetchTarget (warm from a list fetch) resolves the seeded item', async () => {
        const c = make();
        await c.fetchAll(apiResolve([...USERS]));
        await expect(c.fetchTarget(apiResolve(USERS[0]), 1)).resolves.toEqual(USERS[0]);
    });
});
