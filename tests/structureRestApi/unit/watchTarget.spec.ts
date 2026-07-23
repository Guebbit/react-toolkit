/**
 * UNIT — useWatchTarget: fetchTarget's reactive counterpart, the React-first
 * equivalent of a Vue `watch(idSource, ...)`.
 *
 * It takes the CURRENT id VALUE (state/prop) and drives a `useEffect` keyed on it,
 * so an id change re-runs fetchTarget IMMEDIATELY on the next render — no polling,
 * no timers.
 *
 *   - fires for the id present at mount, and selects it eagerly (before the fetch resolves)
 *   - a nullish id is a no-op
 *   - an id change on the next render refetches instantly and re-selects
 *   - onSuccess/onError/onSettled fire with the item/error and id
 *   - a change mid-flight suppresses the previous run's late callbacks
 *   - unmount stops it
 */

import { act, renderHook } from '@testing-library/react';
import {
    useStructureRestApi,
    useWatchTarget,
    type IWatchTargetSettings
} from '../../../src/hooks/structureRestApi';
import { track, clearAllInstances } from '../_helpers/harness';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const fakeApiCall = () => jest.fn((id: number) => Promise.resolve(USERS.find((u) => u.id === id)));

/** Flush pending fetch microtasks. */
const flush = () => act(async () => {});

/**
 * Renders useStructureRestApi + useWatchTarget together, with the watched id as a
 * render prop so `rerender({ id })` models a component's state/prop changing.
 */
const renderWatch = (
    apiCall: (id: number) => Promise<IUser | undefined>,
    settings?: IWatchTargetSettings<IUser | undefined>,
    initialId: number | undefined = 1
) => {
    const view = renderHook(
        ({ id }: { id: number | undefined }) => {
            const c = useStructureRestApi<IUser, number>({ identifiers: 'id' });
            useWatchTarget(c, id, apiCall, settings);
            return c;
        },
        { initialProps: { id: initialId } }
    );
    track({
        get queryClient() {
            return view.result.current.queryClient;
        }
    });
    return view;
};

describe('UNIT · useWatchTarget', () => {
    it('fires for the id present at mount, and selects it eagerly', async () => {
        const apiCall = fakeApiCall();
        const { result } = renderWatch(apiCall);

        expect(apiCall).toHaveBeenCalledTimes(1);
        expect(apiCall).toHaveBeenCalledWith(1);
        // Selection isn't gated on the fetch resolving.
        expect(result.current.selectedIdentifier).toBe(1);

        await flush();
        expect(result.current.selectedRecord).toEqual(USERS[0]);
    });

    it('is a no-op when the id is nullish at mount', () => {
        const apiCall = fakeApiCall();
        // Inlined (not renderWatch) so the id can be an explicit undefined.
        const { result } = renderHook(() => {
            const c = useStructureRestApi<IUser, number>({ identifiers: 'id' });
            useWatchTarget(c, undefined, apiCall);
            return c;
        });
        track({
            get queryClient() {
                return result.current.queryClient;
            }
        });

        expect(apiCall).not.toHaveBeenCalled();
        expect(result.current.selectedIdentifier).toBeUndefined();
    });

    it('refetches instantly on the next render when the id changes', async () => {
        const apiCall = fakeApiCall();
        const { result, rerender } = renderWatch(apiCall);
        await flush();
        expect(apiCall).toHaveBeenCalledTimes(1);

        // No timers: the id change is picked up on the render it happens in.
        act(() => rerender({ id: 2 }));
        expect(apiCall).toHaveBeenCalledTimes(2);
        expect(apiCall).toHaveBeenLastCalledWith(2);
        expect(result.current.selectedIdentifier).toBe(2);

        await flush();
        expect(result.current.selectedRecord).toEqual(USERS[1]);
    });

    it('does not refetch when the id stays the same across renders', async () => {
        const apiCall = fakeApiCall();
        const { rerender } = renderWatch(apiCall);
        await flush();
        expect(apiCall).toHaveBeenCalledTimes(1);

        act(() => rerender({ id: 1 }));
        await flush();
        expect(apiCall).toHaveBeenCalledTimes(1);
    });

    it('calls onSuccess/onSettled with the fetched item and id', async () => {
        const onSuccess = jest.fn();
        const onSettled = jest.fn();
        const onError = jest.fn();
        renderWatch(fakeApiCall(), { onSuccess, onError, onSettled });

        await flush();

        expect(onSuccess).toHaveBeenCalledWith(USERS[0], 1);
        expect(onSettled).toHaveBeenCalledWith(USERS[0], undefined, 1);
        expect(onError).not.toHaveBeenCalled();
    });

    it('calls onError/onSettled when the fetch rejects', async () => {
        const error = new Error('network error');
        const apiCall = jest.fn(() => Promise.reject(error));
        const onSuccess = jest.fn();
        const onError = jest.fn();
        const onSettled = jest.fn();
        const { result } = renderWatch(apiCall, { onSuccess, onError, onSettled });

        await flush();

        expect(onError).toHaveBeenCalledWith(error, 1);
        expect(onSettled).toHaveBeenCalledWith(undefined, error, 1);
        expect(onSuccess).not.toHaveBeenCalled();
        // Selection is eager and unaffected by the fetch's outcome.
        expect(result.current.selectedIdentifier).toBe(1);
    });

    it('suppresses the previous run late callbacks when the id changes mid-flight', async () => {
        const resolvers = new Map<number, (u: IUser | undefined) => void>();
        const apiCall = jest.fn(
            (id: number) =>
                new Promise<IUser | undefined>((resolve) => {
                    resolvers.set(id, resolve);
                })
        );
        const onSuccess = jest.fn();
        const { rerender } = renderWatch(apiCall, { onSuccess });

        // id 1 is in flight; switch to id 2 before it resolves.
        act(() => rerender({ id: 2 }));

        // Resolve the stale id-1 fetch: its callback must be suppressed.
        resolvers.get(1)!(USERS[0]);
        await flush();
        expect(onSuccess).not.toHaveBeenCalledWith(USERS[0], 1);

        // The live id-2 fetch still fires.
        resolvers.get(2)!(USERS[1]);
        await flush();
        expect(onSuccess).toHaveBeenCalledWith(USERS[1], 2);
    });

    it('stops on unmount: an in-flight fetch fires no callbacks once unmounted', async () => {
        const resolvers = new Map<number, (u: IUser | undefined) => void>();
        const apiCall = jest.fn(
            (id: number) =>
                new Promise<IUser | undefined>((resolve) => {
                    resolvers.set(id, resolve);
                })
        );
        const onSettled = jest.fn();
        const { unmount } = renderWatch(apiCall, { onSettled });
        expect(apiCall).toHaveBeenCalledTimes(1);

        unmount();
        // The fetch resolves after unmount — its callbacks must be suppressed.
        resolvers.get(1)!(USERS[0]);
        await flush();
        expect(onSettled).not.toHaveBeenCalled();
    });
});
