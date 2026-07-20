/**
 * UNIT — fetchMultiple: direct contract of the "batch by id" fetch.
 *   - no ids → resolves [] without calling the API
 *   - with a cold cache, requests all ids in one call and stores them
 *   - re-throws on error
 *
 * (Selective staleness — "only fetch expired ids" — is a freshness concern and
 * lives in ttl/ttl.multiple.spec.ts.)
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve, apiReject } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

describe('UNIT · fetchMultiple', () => {
    it('resolves [] and never calls the API when ids is empty', async () => {
        const c = make();
        const api = apiResolve([USERS[0]]);
        await expect(c.fetchMultiple(api, [])).resolves.toEqual([]);
        expect(api).not.toHaveBeenCalled();
    });

    it('resolves [] and never calls the API when ids is undefined', async () => {
        const c = make();
        const api = apiResolve([USERS[0]]);
        await expect(c.fetchMultiple(api)).resolves.toEqual([]);
        expect(api).not.toHaveBeenCalled();
    });

    it('requests all ids in one call against a cold cache and stores them', async () => {
        const c = make();
        const api = apiResolve([USERS[0], USERS[1]]);
        const result = await c.fetchMultiple(api, [1, 2]);
        expect(api).toHaveBeenCalledTimes(1);
        expect(result).toHaveLength(2);
        expect(c.getRecord(1)).toEqual(USERS[0]);
        expect(c.getRecord(2)).toEqual(USERS[1]);
    });

    it('re-throws on error', async () => {
        const c = make();
        await expect(c.fetchMultiple(apiReject(), [1, 2])).rejects.toThrow('network error');
    });
});
