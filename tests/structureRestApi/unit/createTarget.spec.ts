/**
 * UNIT — createTarget: direct contract of the optimistic create.
 *   - resolves with the created item and stores it
 *   - resolves undefined when the API returns undefined
 *   - swaps a dummy placeholder for the real item on success
 *   - rolls the dummy back on error
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve, apiReject } from '../_helpers/fakeApi';
import type { IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();
const DAVE: IUser = { id: 4, name: 'Dave', email: 'dave@example.com' };

describe('UNIT · createTarget', () => {
    it('resolves with the created item and stores it', async () => {
        const c = make();
        const result = await c.createTarget(apiResolve(DAVE));
        expect(result).toEqual(DAVE);
        expect(c.getRecord(4)).toEqual(DAVE);
    });

    it('resolves undefined when the API returns undefined', async () => {
        const c = make();
        await expect(c.createTarget(apiResolve())).resolves.toBeUndefined();
    });

    it('replaces the dummy placeholder with the real item on success', async () => {
        const c = make();
        const dummy: IUser = { id: -1, name: 'Loading...', email: '' };
        await c.createTarget(apiResolve(DAVE), dummy);
        expect(c.getRecord(4)).toEqual(DAVE);
        expect(c.itemList.some((u) => u.name === 'Loading...')).toBe(false);
    });

    it('rolls the dummy back on error', async () => {
        const c = make();
        const dummy: IUser = { id: -1, name: 'Loading...', email: '' };
        await expect(c.createTarget(apiReject(), dummy)).rejects.toThrow();
        expect(c.itemList).toHaveLength(0);
    });
});
