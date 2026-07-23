/**
 * Hook factory for the structureSearchApi suite: builds a tracked
 * useStructureSearchApi() instance (which owns its own internal restApi) bound
 * to a mutable `filters` object, so tests can change filters mid-test.
 * Reuses the structureRestApi suite's own tracking (clearAllInstances stops the
 * shared QueryClient's gc timers so Jest exits cleanly).
 * Plain module (not a *.spec.ts) so Jest's testMatch ignores it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { act, renderHook } from '@testing-library/react';
import { useStructureSearchApi } from '../../../src/hooks/structureSearchApi';
import { track, clearAllInstances } from '../../structureRestApi/_helpers/harness';
import type { IStructureRestApi } from '../../../src/hooks/structureRestApi';

export { clearAllInstances, track } from '../../structureRestApi/_helpers/harness';

function callThroughAct(
    fn: (...args: unknown[]) => unknown,
    thisArgument: unknown,
    args: unknown[]
): unknown {
    let returned: unknown;
    // Returning `returned` from the act() callback (rather than starting a
    // second, later act() call once we notice it's a Promise) is what keeps
    // act() "active" for its entire settlement — including a `finally` block
    // that runs as a microtask continuation of that same promise. A second,
    // separately-started act() call always loses that race: the continuation
    // is already queued ahead of it, so its state update lands unwrapped.
    const actSettled = act(() => {
        returned = Reflect.apply(fn, thisArgument, args);
        return returned;
    });
    if (!(returned instanceof Promise)) return returned;

    const pending = returned;
    return Promise.resolve(actSettled).then(() => pending);
}

/**
 * Wraps a `renderHook` result so tests can read/call it as a plain live
 * object instead of re-reading `result.current` after every state-mutating
 * call — see the structureRestApi harness's `liveHandle` for the full rationale.
 */
function liveHandle<C extends object>(getCurrent: () => C): C {
    return new Proxy({} as C, {
        get(_target, property) {
            const current = getCurrent();
            const value: unknown = Reflect.get(current as object, property);
            if (typeof value !== 'function') return value;
            return (...args: unknown[]) =>
                callThroughAct(value as (...a: unknown[]) => unknown, current, args);
        }
    });
}

/**
 * Default hook instance: tracked for cleanup. Pass `restApiOptions` to override
 * the internal restApi (e.g. `{ TTL: 0 }`), and `initialFilters` to seed the
 * filters object searchApi is bound to.
 */
export function makeSearchHook<
    T extends Record<string | number, any> = Record<string, any>,
    K extends string | number = Extract<keyof T, string | number>,
    F = object
>(restApiOptions: IStructureRestApi = {}, initialFilters: F = {} as F) {
    // Mutable filters object — tests mutate .current to simulate filter changes
    const filters = { current: initialFilters };
    const { result } = renderHook(() =>
        useStructureSearchApi<T, K, string | number, F>(() => filters.current, restApiOptions)
    );
    const searchApi = track(liveHandle(() => result.current));
    return { searchApi, filters };
}
