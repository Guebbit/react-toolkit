/**
 * TTL — concurrent and immediately-successive calls.
 *   - Two identical in-flight fetches DEDUPE to a single API call (TanStack
 *     shares the running promise for the same query key).
 *   - Concurrent fetches on DIFFERENT keys each run.
 *   - An immediate second GET (no time passing) is a cache hit.
 *   - A create (POST) immediately followed by a GET is served from cache.
 *
 * Uses real timers + externally-controlled deferred promises (no fake clock).
 * The two genuinely-concurrent cases (two overlapping in-flight calls, fired
 * without awaiting between them) use `makeRawHook` + a single shared `act()`
 * scope — React's `act()` does not support two independent, unrelated scopes
 * open at once (see the harness's `makeRawHook` doc comment).
 */

import { act } from '@testing-library/react';
import { makeHook, makeRawHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve, deferredApi } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

describe('TTL · concurrency', () => {
    it('two identical in-flight fetchAll calls dedupe to ONE API call', async () => {
        const result = makeRawHook<IUser, number>();
        const { call, control } = deferredApi<IUser[]>();

        await act(async () => {
            const p1 = result.current.fetchAll(call);
            const p2 = result.current.fetchAll(call);
            control.resolve([...USERS]);
            await Promise.all([p1, p2]);
        });

        expect(call).toHaveBeenCalledTimes(1);
    });

    it('concurrent fetches on different lastUpdateKeys each run', async () => {
        const result = makeRawHook<IUser, number>();
        const a = deferredApi<IUser[]>();
        const b = deferredApi<IUser[]>();

        await act(async () => {
            const p1 = result.current.fetchAll(a.call, { lastUpdateKey: 'A' });
            const p2 = result.current.fetchAll(b.call, { lastUpdateKey: 'B' });
            a.control.resolve([...USERS]);
            b.control.resolve([...USERS]);
            await Promise.all([p1, p2]);
        });

        expect(a.call).toHaveBeenCalledTimes(1);
        expect(b.call).toHaveBeenCalledTimes(1);
    });

    it('an immediate second GET is served from cache', async () => {
        const c = make();
        const first = apiResolve([...USERS]);
        const second = apiResolve([...USERS]);
        await c.fetchAll(first);
        await c.fetchAll(second);
        expect(second).not.toHaveBeenCalled();
    });

    it('a create (POST) immediately followed by a GET of the same id is a cache hit', async () => {
        const c = make();
        const created: IUser = { id: 4, name: 'Dave', email: 'dave@example.com' };
        await c.createTarget(apiResolve(created));
        const get = apiResolve(created);
        await c.fetchTarget(get, 4);
        expect(get).not.toHaveBeenCalled();
    });
});
