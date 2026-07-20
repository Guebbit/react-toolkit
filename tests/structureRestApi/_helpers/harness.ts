/**
 * Hook factories + instance registry for the structureRestApi suite.
 * Every spec should call `afterEach(clearAllInstances)` to stop TanStack's gc
 * timers so Jest exits cleanly.
 * Plain module (not a *.spec.ts) so Jest's testMatch ignores it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { QueryClient } from '@tanstack/query-core';
import { act, renderHook } from '@testing-library/react';
import {
    useStructureRestApi,
    type IStructureRestApi
} from '../../../src/hooks/structureRestApi';

type AnyInstance = { queryClient: QueryClient };

const instances: AnyInstance[] = [];

/** Register an instance so its QueryClient gets cleared after the test. */
export function track<C extends AnyInstance>(instance: C): C {
    instances.push(instance);
    return instance;
}

/** Clear every tracked QueryClient (call in afterEach). */
export function clearAllInstances(): void {
    for (const instance of instances.splice(0)) {
        if (instance?.queryClient) instance.queryClient.clear();
    }
}

/**
 * Runs a hook-returned function through `act()` so the resulting state update
 * is flushed (synchronously for a sync return, or awaited for an async one)
 * before the caller reads the hook's next value — mirroring what a component
 * calling this method from an event handler gets for free.
 */
function callThroughAct(fn: (...args: unknown[]) => unknown, thisArgument: unknown, args: unknown[]): unknown {
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
 * object (`c.itemList`, `c.setPageSize(10)`, `await c.fetchAll(...)`) instead
 * of re-reading `result.current` after every state-mutating call. Property
 * reads always forward to the latest render; function properties are
 * auto-wrapped in `act()` so the read that follows sees a flushed update.
 */
function liveHandle<C extends object>(getCurrent: () => C): C {
    return new Proxy({} as C, {
        get(_target, property) {
            const current = getCurrent();
            const value = Reflect.get(current as object, property);
            if (typeof value !== 'function') return value;
            return (...args: unknown[]) => callThroughAct(value as (...a: unknown[]) => unknown, current, args);
        }
    });
}

/**
 * Default hook instance: identifiers 'id', 1-hour TTL, tracked for cleanup.
 * Pass options to override (e.g. `{ TTL: 0 }`, `{ loadingKey }`, `{ queryClient }`).
 */
export function makeHook<
    T extends Record<string | number, any> = Record<string, any>,
    K extends string | number = Extract<keyof T, string | number>
>(options: IStructureRestApi<K, T> = {}) {
    const { result } = renderHook(() =>
        useStructureRestApi<K, T>({ identifiers: 'id', TTL: 3_600_000, ...options })
    );
    return track(liveHandle(() => result.current));
}

/**
 * Raw (non-live-wrapped) hook instance, tracked for cleanup, for the rare
 * spec that fires two overlapping state-mutating calls without awaiting
 * between them (e.g. two concurrent `fetchAll`s on different lastUpdateKeys).
 * `liveHandle`'s automatic per-call `act()` wrapping only supports ONE
 * in-flight call at a time — two independent, unrelated `act()` scopes open
 * at once are unsupported by React and corrupt its act queue for the rest of
 * the test file. Wrap such a pair yourself: `await act(async () => { ... })`.
 */
export function makeRawHook<
    T extends Record<string | number, any> = Record<string, any>,
    K extends string | number = Extract<keyof T, string | number>
>(options: IStructureRestApi<K, T> = {}) {
    const { result } = renderHook(() =>
        useStructureRestApi<K, T>({ identifiers: 'id', TTL: 3_600_000, ...options })
    );
    track({ get queryClient() { return result.current.queryClient; } });
    return result;
}

/**
 * Hook wired to an EXTERNAL loading store (getLoading/setLoading), the way a
 * consumer integrates a global loading manager. Returns the hook instance plus
 * the backing `store` so specs can assert per-key loading state.
 */
export function makeExternalLoading<
    T extends Record<string | number, any> = Record<string, any>,
    K extends string | number = Extract<keyof T, string | number>
>(loadingKey = 'resource', options: IStructureRestApi<K, T> = {}) {
    const store: Record<string, boolean> = {};
    const { result } = renderHook(() =>
        useStructureRestApi<K, T>({
            identifiers: 'id',
            TTL: 3_600_000,
            loadingKey,
            getLoading: (k?: string) => !!(k && store[k]),
            setLoading: (k?: string, v?: boolean) => {
                if (k) store[k] = !!v;
            },
            ...options
        })
    );
    return { c: track(liveHandle(() => result.current)), store, loadingKey };
}

/**
 * Two hook instances sharing a single QueryClient AND loadingKey, so they
 * share cache buckets. Returns the client, both instances (`a`, `b`) and a
 * `make` factory for additional siblings.
 */
export function makeShared<
    T extends Record<string | number, any> = Record<string, any>,
    K extends string | number = Extract<keyof T, string | number>
>(loadingKey = 'shared', TTL = 3_600_000) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                gcTime: Math.max(TTL, 5 * 60 * 1000),
                networkMode: 'always'
            }
        }
    });
    const { result: resultA } = renderHook(() =>
        useStructureRestApi<K, T>({ identifiers: 'id', loadingKey, TTL, queryClient })
    );
    const { result: resultB } = renderHook(() =>
        useStructureRestApi<K, T>({ identifiers: 'id', loadingKey, TTL, queryClient })
    );
    const a = track(liveHandle(() => resultA.current));
    const b = track(liveHandle(() => resultB.current));
    const make = () => {
        const { result } = renderHook(() =>
            useStructureRestApi<K, T>({ identifiers: 'id', loadingKey, TTL, queryClient })
        );
        return track(liveHandle(() => result.current));
    };
    return { queryClient, make, a, b };
}
