/**
 * UNIT — fetchAll: direct contract of the "list everything" fetch.
 *   - resolves with the items and stores each in the dictionary
 *   - skips undefined entries; handles an empty list
 *   - re-throws on error and leaves already-stored data intact
 *
 * (Caching/TTL, merge, mismatch and forced are exercised in ttl/ and modifiers/.)
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve, apiReject } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

describe('UNIT · fetchAll', () => {
    it('resolves with the fetched items', async () => {
        const c = make();
        await expect(c.fetchAll(apiResolve([...USERS]))).resolves.toHaveLength(3);
    });

    it('stores each item in the dictionary by id', async () => {
        const c = make();
        await c.fetchAll(apiResolve([...USERS]));
        expect(c.getRecord(1)).toEqual(USERS[0]);
        expect(c.getRecord(2)).toEqual(USERS[1]);
        expect(c.getRecord(3)).toEqual(USERS[2]);
    });

    it('populates itemList', async () => {
        const c = make();
        await c.fetchAll(apiResolve([...USERS]));
        expect(c.itemList).toHaveLength(3);
    });

    it('skips undefined entries in the response', async () => {
        const c = make();
        await c.fetchAll(apiResolve([USERS[0], undefined, USERS[1]]));
        expect(c.itemList).toHaveLength(2);
        expect(c.getRecord(1)).toEqual(USERS[0]);
        expect(c.getRecord(2)).toEqual(USERS[1]);
    });

    it('handles an empty list', async () => {
        const c = make();
        await expect(c.fetchAll(apiResolve([]))).resolves.toEqual([]);
        expect(c.itemList).toHaveLength(0);
    });

    it('re-throws on error and keeps previously stored items', async () => {
        const c = make();
        await c.fetchAll(apiResolve([USERS[0]]));
        await expect(c.fetchAll(apiReject(), { forced: true })).rejects.toThrow('network error');
        expect(c.getRecord(1)).toEqual(USERS[0]);
    });
});
