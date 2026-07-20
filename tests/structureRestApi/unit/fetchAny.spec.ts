/**
 * UNIT — fetchAny: direct contract of the generic wrapper.
 *
 * fetchAny wraps ANY async call returning ANY shape. Its direct job:
 *   - resolve with the call's result
 *   - cache ONLY when a lastUpdateKey is given (opt-in), keyed per lastUpdateKey
 *   - honour forced; on error clear the entry so a retry runs
 *   - manage the loading flag (unless loading:false)
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiReject } from '../_helpers/fakeApi';
import type { IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

describe('UNIT · fetchAny', () => {
    it('resolves with the call result (object shape)', async () => {
        const c = make();
        const stats = { total: 42, active: 7 };
        await expect(c.fetchAny(jest.fn(() => Promise.resolve(stats)))).resolves.toEqual(stats);
    });

    it('resolves with a primitive shape (health-check boolean)', async () => {
        const c = make();
        await expect(c.fetchAny(jest.fn(() => Promise.resolve(true)))).resolves.toBe(true);
    });

    it('WITHOUT lastUpdateKey runs the call every time (no caching)', async () => {
        const c = make();
        const first = jest.fn(() => Promise.resolve(1));
        const second = jest.fn(() => Promise.resolve(2));
        await c.fetchAny(first);
        await c.fetchAny(second);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('WITH lastUpdateKey serves the second identical call from cache', async () => {
        const c = make();
        const first = jest.fn(() => Promise.resolve(1));
        const second = jest.fn(() => Promise.resolve(2));
        await c.fetchAny(first, { lastUpdateKey: 'stats' });
        const result = await c.fetchAny(second, { lastUpdateKey: 'stats' });
        expect(second).not.toHaveBeenCalled();
        expect(result).toBe(1);
    });

    it('treats different lastUpdateKeys as independent buckets', async () => {
        const c = make();
        const a = jest.fn(() => Promise.resolve('a'));
        const b = jest.fn(() => Promise.resolve('b'));
        await c.fetchAny(a, { lastUpdateKey: 'endpoint-a' });
        await c.fetchAny(b, { lastUpdateKey: 'endpoint-b' });
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('forced bypasses a cached entry', async () => {
        const c = make();
        const first = jest.fn(() => Promise.resolve(1));
        const second = jest.fn(() => Promise.resolve(2));
        await c.fetchAny(first, { lastUpdateKey: 'stats' });
        await c.fetchAny(second, { lastUpdateKey: 'stats', forced: true });
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('re-throws the error', async () => {
        const c = make();
        await expect(c.fetchAny(apiReject('boom'))).rejects.toThrow('boom');
    });

    it('clears a failed cached entry so the next call retries', async () => {
        const c = make();
        await expect(c.fetchAny(apiReject(), { lastUpdateKey: 'stats' })).rejects.toThrow();
        const retry = jest.fn(() => Promise.resolve('ok'));
        await expect(c.fetchAny(retry, { lastUpdateKey: 'stats' })).resolves.toBe('ok');
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('toggles loading during the call and back to false', async () => {
        const c = make();
        let during = false;
        await c.fetchAny(
            jest.fn(() => {
                during = c.loading as boolean;
                return Promise.resolve(1);
            })
        );
        expect(during).toBe(true);
        expect(c.loading).toBe(false);
    });

    it('loading:false leaves the flag untouched', async () => {
        const c = make();
        let during = true;
        await c.fetchAny(
            jest.fn(() => {
                during = c.loading as boolean;
                return Promise.resolve(1);
            }),
            { loading: false }
        );
        expect(during).toBe(false);
        expect(c.loading).toBe(false);
    });
});
