/**
 * UNIT — watchTarget: fetchTarget's imperative "watch this id" counterpart.
 *
 * A React ref, unlike a Vue ref, is not itself reactive: mutating `idRef.current`
 * triggers neither a re-render nor a `useEffect`. watchTarget therefore polls the
 * ref (every `max(50, TTL / 2)` ms) instead of subscribing to it, which is also
 * what lets it notice a change made from anywhere — not just from this hook's
 * own render.
 *
 *   - fires immediately for the id present at creation, and selects it eagerly
 *     (before the fetch promise resolves)
 *   - a nullish id at creation is a no-op
 *   - the next poll tick picks up an id change made to the ref and refetches
 *   - onSuccess/onError/onSettled fire with the item/error and id
 *   - stop() cancels the poll
 */

import { useRef } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useStructureRestApi } from '../../../src/hooks/structureRestApi';
import { track, clearAllInstances } from '../_helpers/harness';
import { USERS, type IUser } from '../_helpers/fixtures';
import { useFakeClock, advance, restoreClock } from '../_helpers/time';

const TTL = 1000; // poll interval = max(50, TTL / 2) = 500ms
const noop = () => {};

const useHarness = (initialId?: number) => {
    const c = track(useStructureRestApi<number, IUser>({ identifiers: 'id', TTL }));
    const idRef = useRef<number | undefined>(initialId);
    return { c, idRef };
};

const fakeApiCall = () => jest.fn((id: number) => Promise.resolve(USERS.find((u) => u.id === id)));

beforeEach(() => useFakeClock());
afterEach(() => {
    clearAllInstances();
    restoreClock();
});

describe('UNIT · watchTarget', () => {
    it('fires immediately for the id present at creation, and selects it eagerly', async () => {
        const apiCall = fakeApiCall();
        const { result } = renderHook(() => useHarness(1));
        let stop: () => void = noop;

        act(() => {
            stop = result.current.c.watchTarget(result.current.idRef, apiCall);
        });

        // Synchronous: selection isn't gated on the fetch resolving.
        expect(apiCall).toHaveBeenCalledTimes(1);
        expect(result.current.c.selectedIdentifier).toBe(1);

        await act(() => advance(0));
        expect(result.current.c.selectedRecord).toEqual(USERS[0]);

        act(() => stop());
    });

    it('is a no-op when the id is nullish at creation', () => {
        const apiCall = fakeApiCall();
        const { result } = renderHook(() => useHarness());
        let stop: () => void = noop;

        act(() => {
            stop = result.current.c.watchTarget(result.current.idRef, apiCall);
        });

        expect(apiCall).not.toHaveBeenCalled();
        expect(result.current.c.selectedIdentifier).toBeUndefined();

        act(() => stop());
    });

    it('picks up an id change on the next poll tick and refetches', async () => {
        const apiCall = fakeApiCall();
        const { result } = renderHook(() => useHarness(1));
        let stop: () => void = noop;

        act(() => {
            stop = result.current.c.watchTarget(result.current.idRef, apiCall);
        });
        await act(() => advance(0));
        expect(apiCall).toHaveBeenCalledTimes(1);

        act(() => {
            result.current.idRef.current = 2;
        });
        // Not picked up until the next poll tick — refs aren't reactive.
        expect(apiCall).toHaveBeenCalledTimes(1);

        await act(() => advance(500));
        expect(apiCall).toHaveBeenCalledTimes(2);
        expect(apiCall).toHaveBeenLastCalledWith(2);
        expect(result.current.c.selectedIdentifier).toBe(2);
        expect(result.current.c.selectedRecord).toEqual(USERS[1]);

        act(() => stop());
    });

    it('re-fetches the same id once it goes stale, via the poll', async () => {
        const apiCall = fakeApiCall();
        const { result } = renderHook(() => useHarness(1));
        let stop: () => void = noop;

        act(() => {
            stop = result.current.c.watchTarget(result.current.idRef, apiCall);
        });
        await act(() => advance(0));
        expect(apiCall).toHaveBeenCalledTimes(1);

        // id unchanged, but stale past TTL by the next poll tick
        await act(() => advance(1200));
        expect(apiCall.mock.calls.length).toBeGreaterThanOrEqual(2);

        act(() => stop());
    });

    it('calls onSuccess/onSettled with the fetched item and id', async () => {
        const onSuccess = jest.fn();
        const onSettled = jest.fn();
        const onError = jest.fn();
        const { result } = renderHook(() => useHarness(1));
        let stop: () => void = noop;

        act(() => {
            stop = result.current.c.watchTarget(result.current.idRef, fakeApiCall(), {
                onSuccess,
                onError,
                onSettled
            });
        });
        await act(() => advance(0));

        expect(onSuccess).toHaveBeenCalledWith(USERS[0], 1);
        expect(onSettled).toHaveBeenCalledWith(USERS[0], undefined, 1);
        expect(onError).not.toHaveBeenCalled();

        act(() => stop());
    });

    it('calls onError/onSettled when the fetch rejects', async () => {
        const error = new Error('network error');
        const apiCall = jest.fn(() => Promise.reject(error));
        const onSuccess = jest.fn();
        const onError = jest.fn();
        const onSettled = jest.fn();
        const { result } = renderHook(() => useHarness(1));
        let stop: () => void = noop;

        act(() => {
            stop = result.current.c.watchTarget(result.current.idRef, apiCall, {
                onSuccess,
                onError,
                onSettled
            });
        });
        await act(() => advance(0));

        expect(onError).toHaveBeenCalledWith(error, 1);
        expect(onSettled).toHaveBeenCalledWith(undefined, error, 1);
        expect(onSuccess).not.toHaveBeenCalled();
        // Selection is eager and unaffected by the fetch's outcome.
        expect(result.current.c.selectedIdentifier).toBe(1);

        act(() => stop());
    });

    it('stop() cancels the poll', async () => {
        const apiCall = fakeApiCall();
        const { result } = renderHook(() => useHarness(1));
        let stop: () => void = noop;

        act(() => {
            stop = result.current.c.watchTarget(result.current.idRef, apiCall);
        });
        await act(() => advance(0));
        expect(apiCall).toHaveBeenCalledTimes(1);

        act(() => stop());

        act(() => {
            result.current.idRef.current = 2;
        });
        await act(() => advance(5000));
        expect(apiCall).toHaveBeenCalledTimes(1);
    });
});
