/**
 * UNIT — fetchPaginate: direct contract of "server pagination, one page at a time".
 * No filter/search concept of its own (see useStructureSearchApi.fetchSearch,
 * built on top of this, for filters/searchGet):
 *   - resolves with the page items and stores them
 *   - an empty page resolves cleanly
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { buildProducts, type IProduct } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IProduct, number>();

describe('UNIT · fetchPaginate', () => {
    it('resolves with the page items', async () => {
        const c = make();
        await expect(
            c.fetchPaginate(apiResolve(buildProducts(10, 1)), 1, 10)
        ).resolves.toHaveLength(10);
    });

    it('stores the returned items', async () => {
        const c = make();
        await c.fetchPaginate(apiResolve(buildProducts(10, 1)), 1, 10);
        expect(c.getRecord(1)).toBeDefined();
        expect(c.getRecord(10)).toBeDefined();
    });

    it('resolves an empty page cleanly', async () => {
        const c = make();
        await expect(c.fetchPaginate(apiResolve([]), 1, 10)).resolves.toEqual([]);
    });
});
