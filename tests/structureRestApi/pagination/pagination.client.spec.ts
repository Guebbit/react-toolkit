/**
 * PAGINATION — client-side (offline): load everything once, page through it locally.
 * Exercises pageSize / pageCurrent / pageTotal / pageOffset / pageItemList.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { buildProducts, type IProduct } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IProduct, number>();

describe('PAGINATION · client-side', () => {
    it('pageTotal is 1 when everything fits on one page', async () => {
        const c = make();
        await c.fetchAll(apiResolve(buildProducts(5)));
        c.setPageSize(10);
        expect(c.pageTotal).toBe(1);
    });

    it('computes the number of pages (ceil)', async () => {
        const c = make();
        await c.fetchAll(apiResolve(buildProducts(25)));
        c.setPageSize(10);
        expect(c.pageTotal).toBe(3);
    });

    it('returns the first page items', async () => {
        const c = make();
        await c.fetchAll(apiResolve(buildProducts(25)));
        c.setPageSize(10);
        c.setPageCurrent(1);
        expect(c.pageItemList).toHaveLength(10);
        expect(c.pageItemList[0]!.id).toBe(1);
    });

    it('returns the second page items', async () => {
        const c = make();
        await c.fetchAll(apiResolve(buildProducts(25)));
        c.setPageSize(10);
        c.setPageCurrent(2);
        const ids = c.pageItemList.map((p) => p.id);
        expect(ids[0]).toBe(11);
        expect(ids.at(-1)).toBe(20);
    });

    it('returns the remaining items on the last page', async () => {
        const c = make();
        await c.fetchAll(apiResolve(buildProducts(25)));
        c.setPageSize(10);
        c.setPageCurrent(3);
        expect(c.pageItemList).toHaveLength(5);
    });

    it('pageItemList is empty when there are no items', () => {
        const c = make();
        c.setPageSize(10);
        c.setPageCurrent(1);
        expect(c.pageItemList).toHaveLength(0);
    });

    it('pageOffset is 0 on page 1 and advances by pageSize', async () => {
        const c = make();
        await c.fetchAll(apiResolve(buildProducts(25)));
        c.setPageSize(10);
        c.setPageCurrent(1);
        expect(c.pageOffset).toBe(0);
        c.setPageCurrent(3);
        expect(c.pageOffset).toBe(20);
    });

    it('recalculates pages when pageSize changes', async () => {
        const c = make();
        await c.fetchAll(apiResolve(buildProducts(25)));
        c.setPageSize(10);
        expect(c.pageTotal).toBe(3);
        c.setPageSize(5);
        expect(c.pageTotal).toBe(5);
    });

    it('navigating every page yields each item exactly once', async () => {
        const products = buildProducts(25);
        const c = make();
        await c.fetchAll(apiResolve(products));
        c.setPageSize(10);
        const collected: IProduct[] = [];
        for (let p = 1; p <= c.pageTotal; p++) {
            c.setPageCurrent(p);
            collected.push(...c.pageItemList);
        }
        expect(collected.map((i) => i.id).toSorted((a, b) => a - b)).toEqual(
            products.map((p) => p.id)
        );
    });
});
