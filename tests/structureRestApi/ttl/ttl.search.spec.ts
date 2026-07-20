/**
 * TTL — freshness of fetchPaginate over time.
 *   - VALID: repeating the same (page, pageSize) just under TTL → cache hit
 *   - STALE: repeating it past TTL → API called again
 *
 * (fetchSearch's TTL behaviour lives in tests/structureSearchApi/ttl/ttl.search.spec.ts)
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { buildProducts, type IProduct } from '../_helpers/fixtures';
import { useFakeClock, advance, restoreClock } from '../_helpers/time';

const TTL = 10_000;
const makeProducts = () => makeHook<IProduct, number>({ TTL });

beforeEach(() => useFakeClock());
afterEach(() => {
    clearAllInstances();
    restoreClock();
});

describe('TTL · fetchPaginate', () => {
    it('VALID just under TTL → served from cache', async () => {
        const c = makeProducts();
        const first = apiResolve(buildProducts(10, 1));
        const second = apiResolve(buildProducts(10, 1));
        await c.fetchPaginate(first, 1, 10);
        await advance(TTL - 1);
        await c.fetchPaginate(second, 1, 10);
        expect(second).not.toHaveBeenCalled();
    });

    it('STALE past TTL → API called again', async () => {
        const c = makeProducts();
        const first = apiResolve(buildProducts(10, 1));
        const second = apiResolve(buildProducts(10, 1));
        await c.fetchPaginate(first, 1, 10);
        await advance(TTL + 1);
        await c.fetchPaginate(second, 1, 10);
        expect(second).toHaveBeenCalledTimes(1);
    });
});
