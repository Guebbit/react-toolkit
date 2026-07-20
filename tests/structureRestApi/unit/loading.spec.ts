/**
 * UNIT — loading primitives with the internal ref.
 *   - loading is false before anything happens
 *   - startLoading / stopLoading toggle it
 *   - a fetch flips it true during the call and false afterwards
 *
 * (External getLoading/setLoading, per-call postfix and loading:false are in
 * modifiers/loading.spec.ts.)
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

describe('UNIT · loading', () => {
    it('is false initially', () => {
        const c = make();
        expect(c.loading).toBe(false);
    });

    it('startLoading / stopLoading toggle the flag', () => {
        const c = make();
        c.startLoading();
        expect(c.loading).toBe(true);
        c.stopLoading();
        expect(c.loading).toBe(false);
    });

    it('is true during a fetch and false after it resolves', async () => {
        const c = make();
        let during = false;
        await c.fetchAll(
            jest.fn(() => {
                during = c.loading as boolean;
                return Promise.resolve([...USERS]);
            })
        );
        expect(during).toBe(true);
        expect(c.loading).toBe(false);
    });
});
