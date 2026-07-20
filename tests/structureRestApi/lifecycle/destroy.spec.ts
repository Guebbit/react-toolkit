/**
 * LIFECYCLE — teardown contract for `destroy()`.
 *
 * `destroy()` clears the query cache only when this composable created it; an
 * injected client is left alone unless `destroy(true)` forces it. It always
 * resets the client store (itemDictionary): destroy means the owning scope is
 * gone, so nothing should still render from it.
 */

import { QueryClient } from '@tanstack/query-core';
import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const newClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: 'always' } } });

describe('LIFECYCLE · destroy() teardown', () => {
    it('destroy() clears a client we created → a later fetch re-hits the API', async () => {
        const c = makeHook<IUser, number>();
        const first = apiResolve([...USERS]);
        await c.fetchAll(first);
        c.destroy();
        const second = apiResolve([...USERS]);
        await c.fetchAll(second);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('destroy() leaves an injected client alone → its cache survives', async () => {
        const client = newClient();
        const c = makeHook<IUser, number>({ queryClient: client });
        const first = apiResolve([...USERS]);
        await c.fetchAll(first);
        c.destroy(); // injected → not cleared
        const second = apiResolve([...USERS]);
        await c.fetchAll(second);
        expect(second).not.toHaveBeenCalled();
        client.clear();
    });

    it('destroy(true) force-clears even an injected client', async () => {
        const client = newClient();
        const c = makeHook<IUser, number>({ queryClient: client });
        await c.fetchAll(apiResolve([...USERS]));
        c.destroy(true); // force → cleared
        const second = apiResolve([...USERS]);
        await c.fetchAll(second);
        expect(second).toHaveBeenCalledTimes(1);
        client.clear();
    });

    it('destroy() resets the client store — records go', async () => {
        const c = makeHook<IUser, number>();
        await c.fetchAll(apiResolve([...USERS]));
        expect(c.itemList.length).toBeGreaterThan(0);

        c.destroy();

        expect(c.itemList).toHaveLength(0);
    });
});
