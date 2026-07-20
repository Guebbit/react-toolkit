/**
 * UNIT — deleteTarget: direct contract of the optimistic delete.
 *   - removes the item immediately and resolves with the API response
 *   - rolls the item back on error
 *   - evicts the item from EVERY lastUpdateKey bucket of the target cache
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve, apiReject } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

describe('UNIT · deleteTarget', () => {
    it('removes the item immediately and resolves with the API response', async () => {
        const c = make();
        await c.fetchAll(apiResolve([...USERS]));
        const ack = { success: true };
        await expect(c.deleteTarget(apiResolve(ack), 1)).resolves.toEqual(ack);
        expect(c.getRecord(1)).toBeUndefined();
        expect(c.itemList).toHaveLength(2);
    });

    it('rolls the item back on error', async () => {
        const c = make();
        await c.fetchAll(apiResolve([...USERS]));
        await expect(c.deleteTarget(apiReject(), 1)).rejects.toThrow();
        expect(c.getRecord(1)).toEqual(USERS[0]);
    });

    it('invalidates a target cached under a lastUpdateKey, not just the default bucket', async () => {
        const c = make();
        await c.fetchTarget(apiResolve(USERS[0]), 1, { lastUpdateKey: 'v1' });
        await c.deleteTarget(apiResolve({ ok: true }), 1);

        // the namespaced entry must be gone too → this must hit the network again
        const get = apiResolve(USERS[0]);
        await c.fetchTarget(get, 1, { lastUpdateKey: 'v1' });
        expect(get).toHaveBeenCalledTimes(1);
    });
});
