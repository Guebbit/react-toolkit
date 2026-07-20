/**
 * PAGINATION — server-side via fetchAll with a per-page lastUpdateKey.
 * Each page is fetched and freshness-tracked independently; items accumulate.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { buildProducts, type IProduct } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IProduct, number>();
const pageKey = (page: number) => `products-page-${page}`;

describe('PAGINATION · server-side (fetchAll per page)', () => {
    it('fetches a page and stores its items', async () => {
        const c = make();
        await c.fetchAll(apiResolve(buildProducts(10, 1)), { lastUpdateKey: pageKey(1) });
        expect(c.itemList).toHaveLength(10);
    });

    it('accumulates items across pages', async () => {
        const c = make();
        await c.fetchAll(apiResolve(buildProducts(10, 1)), { lastUpdateKey: pageKey(1) });
        await c.fetchAll(apiResolve(buildProducts(10, 11)), { lastUpdateKey: pageKey(2) });
        expect(c.itemList).toHaveLength(20);
    });

    it('does not re-fetch the same page within TTL', async () => {
        const c = make();
        const first = apiResolve(buildProducts(10, 1));
        const second = apiResolve(buildProducts(10, 1));
        await c.fetchAll(first, { lastUpdateKey: pageKey(1) });
        await c.fetchAll(second, { lastUpdateKey: pageKey(1) });
        expect(second).not.toHaveBeenCalled();
    });

    it('fetches different pages independently', async () => {
        const c = make();
        const p1 = apiResolve(buildProducts(10, 1));
        const p2 = apiResolve(buildProducts(10, 11));
        await c.fetchAll(p1, { lastUpdateKey: pageKey(1) });
        await c.fetchAll(p2, { lastUpdateKey: pageKey(2) });
        expect(p1).toHaveBeenCalledTimes(1);
        expect(p2).toHaveBeenCalledTimes(1);
    });

    it('forced re-fetches a page', async () => {
        const c = make();
        const first = apiResolve(buildProducts(10, 1));
        const second = apiResolve(buildProducts(10, 1));
        await c.fetchAll(first, { lastUpdateKey: pageKey(1) });
        await c.fetchAll(second, { lastUpdateKey: pageKey(1), forced: true });
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('handles an empty last page without dropping earlier items', async () => {
        const c = make();
        await c.fetchAll(apiResolve(buildProducts(10, 1)), { lastUpdateKey: pageKey(1) });
        await c.fetchAll(apiResolve<IProduct[]>([]), { lastUpdateKey: pageKey(2) });
        expect(c.itemList).toHaveLength(10);
    });
});
