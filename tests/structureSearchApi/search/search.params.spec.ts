/**
 * SEARCH — filter parameters as the cache dimension.
 *
 * Each distinct set of filters is its own cache bucket; equal filters (regardless
 * of key order, at ANY depth) share one. Covers flat string/number/boolean filters,
 * array-of-primitive filters, and nested-object filters (sort/range/geo shapes) —
 * all serialise stably via searchKeyGen -> canonicalize.
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeSearchHook<IArticle, number>();
const TECH = buildArticles(5, 'tech', 1);
const SPORT = buildArticles(3, 'sport', 100);

describe('SEARCH · filter parameters', () => {
    it('equal filters in different key order hit the same bucket', async () => {
        const { searchApi } = make();
        const first = apiResolve(TECH);
        const second = apiResolve(TECH);
        await searchApi.fetchSearch(first, { category: 'tech', status: 'active' }, 1);
        await searchApi.fetchSearch(second, { status: 'active', category: 'tech' }, 1);
        expect(second).not.toHaveBeenCalled();
    });

    it('different filter VALUES are separate buckets', async () => {
        const { searchApi } = make();
        const techCall = apiResolve(TECH);
        const sportCall = apiResolve(SPORT);
        await searchApi.fetchSearch(techCall, { category: 'tech' }, 1);
        await searchApi.fetchSearch(sportCall, { category: 'sport' }, 1);
        expect(techCall).toHaveBeenCalledTimes(1);
        expect(sportCall).toHaveBeenCalledTimes(1);
    });

    it('different filter PROPERTIES are separate buckets', async () => {
        const { searchApi } = make();
        const a = apiResolve(TECH);
        const b = apiResolve(TECH);
        await searchApi.fetchSearch(a, { category: 'tech' }, 1);
        await searchApi.fetchSearch(b, { tag: 'tech' }, 1);
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('boolean filter values distinguish buckets', async () => {
        const { searchApi } = make();
        const on = apiResolve(TECH);
        const off = apiResolve(TECH);
        await searchApi.fetchSearch(on, { published: true }, 1);
        await searchApi.fetchSearch(off, { published: false }, 1);
        expect(on).toHaveBeenCalledTimes(1);
        expect(off).toHaveBeenCalledTimes(1);
    });

    it('numeric filter values distinguish buckets', async () => {
        const { searchApi } = make();
        const y2023 = apiResolve(TECH);
        const y2024 = apiResolve(TECH);
        await searchApi.fetchSearch(y2023, { year: 2023 }, 1);
        await searchApi.fetchSearch(y2024, { year: 2024 }, 1);
        expect(y2023).toHaveBeenCalledTimes(1);
        expect(y2024).toHaveBeenCalledTimes(1);
    });

    it('array-of-primitive filter values distinguish buckets', async () => {
        const { searchApi } = make();
        const xy = apiResolve(TECH);
        const xz = apiResolve(TECH);
        await searchApi.fetchSearch(xy, { tags: ['x', 'y'] }, 1);
        await searchApi.fetchSearch(xz, { tags: ['x', 'z'] }, 1);
        expect(xy).toHaveBeenCalledTimes(1);
        expect(xz).toHaveBeenCalledTimes(1);
    });

    it('empty filters are their own bucket, distinct from any filtered search', async () => {
        const { searchApi } = make();
        const all = apiResolve(TECH);
        const filtered = apiResolve(TECH);
        await searchApi.fetchSearch(all, {}, 1);
        await searchApi.fetchSearch(filtered, { category: 'tech' }, 1);
        expect(all).toHaveBeenCalledTimes(1);
        expect(filtered).toHaveBeenCalledTimes(1);
    });

    it('searchGet returns the stored results for a filtered search', async () => {
        const { searchApi } = make();
        await searchApi.fetchSearch(apiResolve(TECH), { category: 'tech' }, 1);
        expect(searchApi.searchGet({ category: 'tech' }, 1).map((a) => a.id)).toEqual(
            TECH.map((a) => a.id)
        );
    });

    it('nested-object filters are distinct cache buckets', async () => {
        const { searchApi } = make();
        const first = apiResolve(buildArticles(2, 'tech', 1)); // ids 1,2
        const second = apiResolve(buildArticles(2, 'tech', 50)); // ids 50,51

        await searchApi.fetchSearch(first, { sort: { by: 'name' } }, 1);
        await searchApi.fetchSearch(second, { sort: { by: 'date' } }, 1);

        // differ only BELOW the top level → the second search must actually run ...
        expect(second).toHaveBeenCalledTimes(1);
        // ... and return its own results, not the first search's.
        expect(searchApi.searchGet({ sort: { by: 'date' } }, 1).map((a) => a.id)).toEqual([50, 51]);
    });

    it('nested-object filters share a bucket regardless of key order at any depth', async () => {
        const { searchApi } = make();
        const first = apiResolve(TECH);
        const second = apiResolve(TECH);

        await searchApi.fetchSearch(first, { sort: { by: 'name', dir: 'asc' } }, 1);
        await searchApi.fetchSearch(second, { sort: { dir: 'asc', by: 'name' } }, 1);

        // same filters, different key order → one bucket, no second request
        expect(second).not.toHaveBeenCalled();
    });
});
