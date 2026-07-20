/**
 * UNIT — fetchTarget: direct contract of the "single item" fetch.
 *   - resolves with the item and stores it
 *   - resolves undefined when the API returns undefined (with and without an id)
 *   - the id-less path still runs and stores the item
 *   - re-throws on error
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve, apiReject } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

describe('UNIT · fetchTarget', () => {
    it('resolves with the fetched item and stores it', async () => {
        const c = make();
        const result = await c.fetchTarget(apiResolve(USERS[0]), 1);
        expect(result).toEqual(USERS[0]);
        expect(c.getRecord(1)).toEqual(USERS[0]);
    });

    it('resolves undefined when the API returns undefined (id given)', async () => {
        const c = make();
        await expect(c.fetchTarget(apiResolve(), 99)).resolves.toBeUndefined();
        expect(c.getRecord(99)).toBeUndefined();
    });

    it('runs and stores the item when no id is given', async () => {
        const c = make();
        const result = await c.fetchTarget(apiResolve(USERS[0]));
        expect(result).toEqual(USERS[0]);
        expect(c.getRecord(1)).toEqual(USERS[0]);
    });

    it('resolves undefined when the API returns undefined and no id is given', async () => {
        const c = make();
        await expect(c.fetchTarget(apiResolve())).resolves.toBeUndefined();
    });

    it('re-throws on error', async () => {
        const c = make();
        await expect(c.fetchTarget(apiReject(), 1)).rejects.toThrow('network error');
    });
});
