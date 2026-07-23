/**
 * UNIT — useWatchSearch: fetchSearch's reactive counterpart, the React-first
 * equivalent of a Vue `watch([pageCurrent, pageSize], ...)`.
 *
 * A `useEffect` re-runs the search whenever the api's pageCurrent/pageSize change,
 * reading whatever filters the api is bound to. No stop handle — unmount cleans up.
 *
 *   - fires immediately (by default) using pageCurrent/pageSize and the current filters
 *   - refetches when pageCurrent or pageSize change
 *   - does NOT refetch on its own when the filters change (filters are read, not watched)
 *   - immediate: false skips the initial run
 *   - search(): triggers a fetch on demand with whatever filters/page/pageSize hold now
 *   - search(true): forces even when the page is already cached
 *   - onSuccess/onError/onSettled fire with the right arguments
 */

import { act, renderHook } from '@testing-library/react';
import {
    useStructureSearchApi,
    useWatchSearch,
    type IWatchSearchSettings
} from '../../../src/hooks/structureSearchApi';
import { track, clearAllInstances } from '../../structureRestApi/_helpers/harness';
import { buildArticles, type IArticle } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

type Filters = { category?: string };

const TECH_FILTERS: Filters = { category: 'tech' };
const TECH = buildArticles(5, 'tech', 1);

/** Flush pending fetch microtasks. */
const flush = () => act(async () => {});

/** Records every (filters, page, pageSize) triple it was called with. */
const fakeApiCall = (items: IArticle[] = TECH) =>
    jest.fn((_filters: Filters, _page: number, _pageSize: number) => Promise.resolve(items));

/**
 * Renders useStructureSearchApi + useWatchSearch together against a mutable
 * `filters` object (mutating `.current` models filters changing without a render).
 */
const renderWatch = (
    apiCall: (f: Filters, p: number, s: number) => Promise<(IArticle | undefined)[]>,
    settings?: IWatchSearchSettings<IArticle, Filters>,
    initialFilters: Filters = TECH_FILTERS
) => {
    const filters = { current: initialFilters };
    const view = renderHook(() => {
        const api = useStructureSearchApi<IArticle, number, string | number, Filters>(
            () => filters.current
        );
        const { search } = useWatchSearch(api, apiCall, settings);
        return { api, search };
    });
    track({
        get queryClient() {
            return view.result.current.api.queryClient;
        }
    });
    return { ...view, filters };
};

describe('UNIT · useWatchSearch', () => {
    it('fires immediately, reading the current filters/page/pageSize', async () => {
        const apiCall = fakeApiCall();
        renderWatch(apiCall);

        expect(apiCall).toHaveBeenCalledTimes(1);
        expect(apiCall).toHaveBeenCalledWith({ category: 'tech' }, 1, 10);
        // Let the mount fetch settle inside act() (its state update lands post-assert).
        await flush();
    });

    it('skips the initial run when immediate is false', () => {
        const apiCall = fakeApiCall();
        renderWatch(apiCall, { immediate: false }, {});

        expect(apiCall).not.toHaveBeenCalled();
    });

    it('refetches when pageCurrent changes', async () => {
        const apiCall = fakeApiCall();
        const { result } = renderWatch(apiCall, undefined, {});
        await flush();
        expect(apiCall).toHaveBeenCalledTimes(1);

        act(() => result.current.api.setPageCurrent(2));
        await flush();

        expect(apiCall).toHaveBeenCalledTimes(2);
        expect(apiCall).toHaveBeenLastCalledWith({}, 2, 10);
    });

    it('refetches when pageSize changes', async () => {
        const apiCall = fakeApiCall();
        const { result } = renderWatch(apiCall, undefined, {});
        await flush();
        expect(apiCall).toHaveBeenCalledTimes(1);

        act(() => result.current.api.setPageSize(25));
        await flush();

        expect(apiCall).toHaveBeenCalledTimes(2);
        expect(apiCall).toHaveBeenLastCalledWith({}, 1, 25);
    });

    it('does not refetch on its own when filters change', async () => {
        const apiCall = fakeApiCall();
        const { filters } = renderWatch(apiCall);
        await flush();
        expect(apiCall).toHaveBeenCalledTimes(1);

        // Mutating the bound filters triggers no render, so no search.
        filters.current = { category: 'design' };
        await flush();

        expect(apiCall).toHaveBeenCalledTimes(1);
    });

    it('does not re-search on an unrelated re-render (search/getFilters stay stable)', async () => {
        // TTL:0 makes every cache entry immediately stale, so if the watch effect
        // re-ran it WOULD re-hit apiCall — the cache can no longer mask a spurious
        // re-run. The count therefore proves the effect fired exactly once, which
        // only holds if `search` (and the getFilters/fetchSearch it closes over)
        // keep a stable identity across renders the effect must ignore.
        const apiCall = fakeApiCall();
        const filters = { current: TECH_FILTERS };
        const view = renderHook(
            // `nonce` is an unrelated prop: bumping it re-renders the host without
            // touching filters/pageCurrent/pageSize — the effect must not fire.
            ({ nonce: _nonce }: { nonce: number }) => {
                const api = useStructureSearchApi<IArticle, number, string | number, Filters>(
                    () => filters.current,
                    { TTL: 0 }
                );
                const { search } = useWatchSearch(api, apiCall);
                return { api, search };
            },
            { initialProps: { nonce: 0 } }
        );
        track({
            get queryClient() {
                return view.result.current.api.queryClient;
            }
        });
        await flush();
        expect(apiCall).toHaveBeenCalledTimes(1);

        act(() => view.rerender({ nonce: 1 }));
        await flush();
        act(() => view.rerender({ nonce: 2 }));
        await flush();

        expect(apiCall).toHaveBeenCalledTimes(1);
    });

    it('search() triggers a fetch on demand with the current filters/page/pageSize', async () => {
        const apiCall = fakeApiCall();
        const { result, filters } = renderWatch(apiCall, { immediate: false });

        filters.current = { category: 'design' };
        await act(async () => {
            await result.current.search();
        });

        expect(apiCall).toHaveBeenCalledTimes(1);
        expect(apiCall).toHaveBeenCalledWith({ category: 'design' }, 1, 10);
    });

    it('search() resolves with the fetched items and stores them', async () => {
        const { result } = renderWatch(fakeApiCall(), { immediate: false }, {});

        let items: unknown;
        await act(async () => {
            items = await result.current.search();
        });

        expect(items).toEqual(TECH);
        expect(result.current.api.getRecord(1)).toEqual(TECH[0]);
    });

    it('a repeated search() within TTL is served from cache (apiCall not re-invoked)', async () => {
        const apiCall = fakeApiCall();
        const { result } = renderWatch(apiCall, { immediate: false }, {});

        await act(async () => {
            await result.current.search();
        });
        await act(async () => {
            await result.current.search();
        });

        expect(apiCall).toHaveBeenCalledTimes(1);
    });

    it('search(true) forces a re-fetch even when cached', async () => {
        const apiCall = fakeApiCall();
        const { result } = renderWatch(apiCall, { immediate: false }, {});

        await act(async () => {
            await result.current.search();
        });
        await act(async () => {
            await result.current.search(true);
        });

        expect(apiCall).toHaveBeenCalledTimes(2);
    });

    it('calls onSuccess/onSettled with the fetched items and filters', async () => {
        const onSuccess = jest.fn();
        const onSettled = jest.fn();
        const onError = jest.fn();
        renderWatch(fakeApiCall(), { onSuccess, onError, onSettled });
        await flush();

        expect(onSuccess).toHaveBeenCalledWith(TECH, { category: 'tech' });
        expect(onSettled).toHaveBeenCalledWith(TECH, undefined, { category: 'tech' });
        expect(onError).not.toHaveBeenCalled();
    });

    it('calls onError/onSettled when the search rejects, and search() does not throw', async () => {
        const error = new Error('network error');
        const apiCall = jest.fn(() => Promise.reject(error));
        const onSuccess = jest.fn();
        const onError = jest.fn();
        const onSettled = jest.fn();
        const { result } = renderWatch(apiCall, {
            immediate: false,
            onSuccess,
            onError,
            onSettled
        });

        let resolved: unknown = 'unset';
        await act(async () => {
            resolved = await result.current.search();
        });

        expect(resolved).toBeUndefined();
        expect(onError).toHaveBeenCalledWith(error, { category: 'tech' });
        expect(onSettled).toHaveBeenCalledWith(undefined, error, { category: 'tech' });
        expect(onSuccess).not.toHaveBeenCalled();
    });

    it('stops on unmount: a later page change fires no search', async () => {
        const apiCall = fakeApiCall();
        const { result, unmount } = renderWatch(apiCall, undefined, {});
        await flush();
        expect(apiCall).toHaveBeenCalledTimes(1);

        const setPageCurrent = result.current.api.setPageCurrent;
        unmount();
        // The state setter still exists, but with the component unmounted the
        // effect that would search is gone.
        act(() => setPageCurrent(2));
        await flush();

        expect(apiCall).toHaveBeenCalledTimes(1);
    });
});
