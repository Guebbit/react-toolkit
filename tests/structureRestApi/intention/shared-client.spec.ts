/**
 * INTENTION — sharing a QueryClient across composables.
 * Two composables that share BOTH a QueryClient and a loadingKey share cache
 * buckets (one fetch warms the other). A differing loadingKey namespaces them
 * apart even on the same client.
 */

import { QueryClient } from '@tanstack/query-core';
import { makeShared, makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

describe('INTENTION · shared QueryClient', () => {
    it('shared client + loadingKey: one composable warms the other', async () => {
        const { a, b } = makeShared<IUser, number>('users');
        const first = apiResolve([...USERS]);
        const second = apiResolve([...USERS]);
        await a.fetchAll(first, { lastUpdateKey: 'roster' });
        await b.fetchAll(second, { lastUpdateKey: 'roster' });
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();
    });

    it('shared client + loadingKey: composable b sees a target seeded by a', async () => {
        const { a, b } = makeShared<IUser, number>('users');
        await a.fetchAll(apiResolve([...USERS]));
        const get = apiResolve(USERS[0]);
        await b.fetchTarget(get, 1);
        expect(get).not.toHaveBeenCalled();
    });

    it('same client but DIFFERENT loadingKey does not share', async () => {
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false, networkMode: 'always' } }
        });
        const a = makeHook<IUser, number>({ loadingKey: 'a', queryClient: client });
        const b = makeHook<IUser, number>({ loadingKey: 'b', queryClient: client });
        const first = apiResolve([...USERS]);
        const second = apiResolve([...USERS]);
        await a.fetchAll(first, { lastUpdateKey: 'roster' });
        await b.fetchAll(second, { lastUpdateKey: 'roster' });
        expect(second).toHaveBeenCalledTimes(1);
        client.clear();
    });
});
