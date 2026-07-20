/**
 * UNIT — watchSearch: fetchSearch's reactive counterpart, pre-bound to the
 * hook's own filtersSource.
 *   - fires immediately (by default) using pageCurrent/pageSize and the current filters
 *   - refetches when pageCurrent or pageSize change
 *   - does NOT refetch on its own when the filters change (filters are read, not watched)
 *   - immediate: false skips the initial run
 *   - search(): triggers a fetch on demand with whatever filters/page/pageSize hold now
 *   - search(true): forces even when the page is already cached
 *   - onSuccess/onError/onSettled fire with the right arguments
 *   - stop(): stops the pageCurrent/pageSize watcher
 */

import { act, renderHook } from '@testing-library/react';
import { useStructureSearchApi } from '../../../src/hooks/structureSearchApi';
import { track, makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

const TECH_FILTERS = { category: 'tech' };
const make = (initialFilters: { category?: string } = TECH_FILTERS) =>
    makeSearchHook<IArticle, number, { category?: string }>({}, initialFilters);
const TECH = buildArticles(5, 'tech', 1);

/** Flushes the microtask queue past runQuery's several internal `.then` hops. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Records every (filters, page, pageSize) triple it was called with. */
const fakeApiCall = (items: IArticle[] = TECH) =>
    jest.fn((filters: { category?: string }, page: number, pageSize: number) =>
        Promise.resolve(items)
    );

describe('UNIT · watchSearch', () => {
    it('fires immediately, reading the current filters/page/pageSize', () => {
        const { searchApi } = make();
        const apiCall = fakeApiCall();
        const { stop } = searchApi.watchSearch(apiCall);

        expect(apiCall).toHaveBeenCalledTimes(1);
        expect(apiCall).toHaveBeenCalledWith({ category: 'tech' }, 1, 10);
        stop();
    });

    it('accepts a getter as filtersSource, bound at construction', () => {
        const filters = { category: 'tech' };
        const { result } = renderHook(() => useStructureSearchApi<IArticle, number>(() => filters));
        const searchApi = track(result.current);
        const apiCall = fakeApiCall();
        const { stop } = searchApi.watchSearch(apiCall);

        expect(apiCall).toHaveBeenCalledWith({ category: 'tech' }, 1, 10);
        stop();
    });

    it('skips the initial run when immediate is false', () => {
        const { searchApi } = make({});
        const apiCall = fakeApiCall();
        const { stop } = searchApi.watchSearch(apiCall, { immediate: false });

        expect(apiCall).not.toHaveBeenCalled();
        stop();
    });

    it('refetches when pageCurrent changes', async () => {
        const { searchApi } = make({});
        const apiCall = fakeApiCall();
        const { stop } = searchApi.watchSearch(apiCall);
        await flush();

        searchApi.setPageCurrent(2);
        await flush();

        expect(apiCall).toHaveBeenCalledTimes(2);
        expect(apiCall).toHaveBeenLastCalledWith({}, 2, 10);
        stop();
    });

    it('refetches when pageSize changes', async () => {
        const { searchApi } = make({});
        const apiCall = fakeApiCall();
        const { stop } = searchApi.watchSearch(apiCall);
        await flush();

        searchApi.setPageSize(25);
        await flush();

        expect(apiCall).toHaveBeenCalledTimes(2);
        expect(apiCall).toHaveBeenLastCalledWith({}, 1, 25);
        stop();
    });

    it('does not refetch on its own when filters change', async () => {
        const { filters, searchApi } = make();
        const apiCall = fakeApiCall();
        const { stop } = searchApi.watchSearch(apiCall);
        await flush();

        filters.current = { category: 'design' };
        await flush();

        expect(apiCall).toHaveBeenCalledTimes(1);
        stop();
    });

    it('search() triggers a fetch on demand with the current filters/page/pageSize', async () => {
        const { filters, searchApi } = make();
        const apiCall = fakeApiCall();
        const { stop, search } = searchApi.watchSearch(apiCall, { immediate: false });

        filters.current = { category: 'design' };
        await search();

        expect(apiCall).toHaveBeenCalledTimes(1);
        expect(apiCall).toHaveBeenCalledWith({ category: 'design' }, 1, 10);
        stop();
    });

    it('search() resolves with the fetched items and stores them', async () => {
        const { searchApi } = make({});
        const { stop, search } = searchApi.watchSearch(fakeApiCall(), { immediate: false });

        // search() is a plain closure returned by watchSearch, not one of
        // searchApi's own live-wrapped methods, so its state update needs an
        // explicit act() to flush before reading searchApi.getRecord below.
        let items: unknown;
        await act(async () => {
            items = await search();
        });
        expect(items).toEqual(TECH);
        expect(searchApi.getRecord(1)).toEqual(TECH[0]);
        stop();
    });

    it('a repeated search() within TTL is served from cache (apiCall not re-invoked)', async () => {
        const { searchApi } = make({});
        const apiCall = fakeApiCall();
        const { stop, search } = searchApi.watchSearch(apiCall, { immediate: false });

        await search();
        await search();

        expect(apiCall).toHaveBeenCalledTimes(1);
        stop();
    });

    it('search(true) forces a re-fetch even when cached', async () => {
        const { searchApi } = make({});
        const apiCall = fakeApiCall();
        const { stop, search } = searchApi.watchSearch(apiCall, { immediate: false });

        await search();
        await search(true);

        expect(apiCall).toHaveBeenCalledTimes(2);
        stop();
    });

    it('calls onSuccess/onSettled with the fetched items and filters', async () => {
        const { searchApi } = make();
        const onSuccess = jest.fn();
        const onSettled = jest.fn();
        const onError = jest.fn();
        const { stop } = searchApi.watchSearch(fakeApiCall(), { onSuccess, onError, onSettled });
        await flush();

        expect(onSuccess).toHaveBeenCalledWith(TECH, { category: 'tech' });
        expect(onSettled).toHaveBeenCalledWith(TECH, undefined, { category: 'tech' });
        expect(onError).not.toHaveBeenCalled();
        stop();
    });

    it('calls onError/onSettled when the search rejects, and search() does not throw', async () => {
        const { searchApi } = make();
        const error = new Error('network error');
        const apiCall = jest.fn(() => Promise.reject(error));
        const onSuccess = jest.fn();
        const onError = jest.fn();
        const onSettled = jest.fn();
        const { stop, search } = searchApi.watchSearch(apiCall, {
            immediate: false,
            onSuccess,
            onError,
            onSettled
        });

        await expect(search()).resolves.toBeUndefined();
        expect(onError).toHaveBeenCalledWith(error, { category: 'tech' });
        expect(onSettled).toHaveBeenCalledWith(undefined, error, { category: 'tech' });
        expect(onSuccess).not.toHaveBeenCalled();
        stop();
    });

    it('stop() stops the pageCurrent/pageSize watcher', async () => {
        const { searchApi } = make({});
        const apiCall = fakeApiCall();
        const { stop } = searchApi.watchSearch(apiCall);
        await flush();
        stop();

        searchApi.setPageCurrent(2);
        await flush();

        expect(apiCall).toHaveBeenCalledTimes(1);
    });
});
