/**
 * EFFECT STABILITY — the `loading` flag under overlapping requests.
 *
 * `loading` is ref-counted (see the loadingCountsRef note in the source): the point
 * of the ref-count is that a component bound to `loading` sees exactly ONE
 * false->true->false cycle around a burst of concurrent requests, never a flicker
 * per request. A boolean flag would fail this — the first request to resolve would
 * flip it off while others are still in flight.
 *
 * Because only the 0->1 and 1->0 edges call `bumpLoadingVersion`, each edge is one
 * committed render. Capturing `loading` on every render therefore yields the exact
 * transition SEQUENCE a subscriber observes — the property the ref-count exists for.
 */

import { renderHook, act } from '@testing-library/react';
import { useStructureRestApi } from '../../../src/hooks/structureRestApi';
import { track, clearAllInstances } from '../_helpers/harness';
import { deferredApi } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

/** Renders the hook and records `loading` on every commit. */
const renderLoading = () => {
    const seq: boolean[] = [];
    const view = renderHook(() => {
        const c = useStructureRestApi<IUser, number>({ identifiers: 'id' });
        seq.push(c.loading);
        return c;
    });
    track({
        get queryClient() {
            return view.result.current.queryClient;
        }
    });
    return { c: () => view.result.current, seq };
};

/** Collapses consecutive duplicates: the observable transition sequence. */
const transitions = (seq: boolean[]) => seq.filter((v, i) => i === 0 || v !== seq[i - 1]);

describe('EFFECT STABILITY · loading ref-count', () => {
    it('shows a single false->true->false cycle for a burst of concurrent requests', async () => {
        const { c, seq } = renderLoading();

        const a = deferredApi<IUser[]>();
        const b = deferredApi<IUser[]>();
        const d = deferredApi<IUser[]>();

        // three overlapping fetches on distinct cache keys (so none dedupe away),
        // all on the SAME loading bucket (no per-call loadingKey)
        let p1!: Promise<unknown>;
        let p2!: Promise<unknown>;
        let p3!: Promise<unknown>;
        act(() => {
            p1 = c().fetchAll(a.call, { lastUpdateKey: 'A' });
            p2 = c().fetchAll(b.call, { lastUpdateKey: 'B' });
            p3 = c().fetchAll(d.call, { lastUpdateKey: 'C' });
        });

        expect(c().loading).toBe(true); // on from the first start

        // resolve out of order; loading must stay true until the LAST one settles
        await act(async () => {
            a.control.resolve([...USERS]);
            await p1;
        });
        expect(c().loading).toBe(true);

        await act(async () => {
            d.control.resolve([...USERS]);
            await p3;
        });
        expect(c().loading).toBe(true);

        await act(async () => {
            b.control.resolve([...USERS]);
            await p2;
        });
        expect(c().loading).toBe(false); // off only after the last

        expect(transitions(seq)).toEqual([false, true, false]); // one cycle, no flicker
    });

    it('does not go negative: an extra stopLoading cannot mask a later start', () => {
        const { c } = renderLoading();

        // count is already 0; a stray stop must not drive it to -1
        act(() => c().stopLoading());
        act(() => c().startLoading());
        // 0 -> 0 -> 1, so loading is true. Without the Math.max(…, 0) floor it would
        // be -1 -> 0 here and read false.
        expect(c().loading).toBe(true);

        act(() => c().stopLoading());
        expect(c().loading).toBe(false);
    });

    it('a spurious stop on a never-started key is ignored while a fetch is in flight', async () => {
        const { c } = renderLoading();
        const { call, control } = deferredApi<IUser[]>();

        let p!: Promise<unknown>;
        act(() => {
            p = c().fetchAll(call, { lastUpdateKey: 'A' });
        });
        expect(c().loading).toBe(true);

        act(() => c().stopLoading('-nonexistent')); // different bucket, never counted up
        expect(c().loading).toBe(true);

        await act(async () => {
            control.resolve([...USERS]);
            await p;
        });
        expect(c().loading).toBe(false);
    });

    it('turns loading off even when the request REJECTS (finally path)', async () => {
        const { c, seq } = renderLoading();
        const { call, control } = deferredApi<IUser[]>();

        let p!: Promise<unknown>;
        act(() => {
            p = c().fetchAll(call, { lastUpdateKey: 'A' });
        });
        expect(c().loading).toBe(true);

        await act(async () => {
            control.reject(new Error('boom'));
            await expect(p).rejects.toThrow('boom');
        });

        expect(c().loading).toBe(false);
        expect(transitions(seq)).toEqual([false, true, false]);
    });

    it('an external loading store is told ONLY about the 0->1 and 1->0 edges', async () => {
        const store: Record<string, boolean> = {};
        const loadingKey = 'resource';
        const view = renderHook(() =>
            useStructureRestApi<IUser, number>({
                identifiers: 'id',
                loadingKey,
                getLoading: (k?: string) => !!(k && store[k]),
                setLoading: (k?: string, v?: boolean) => {
                    if (k) store[k] = !!v;
                }
            })
        );
        track({
            get queryClient() {
                return view.result.current.queryClient;
            }
        });
        const c = () => view.result.current;

        const a = deferredApi<IUser[]>();
        const b = deferredApi<IUser[]>();
        const edges: boolean[] = [];

        let p1!: Promise<unknown>;
        let p2!: Promise<unknown>;
        act(() => {
            p1 = c().fetchAll(a.call, { lastUpdateKey: 'A' });
        });
        edges.push(store[loadingKey]); // true after first start
        act(() => {
            p2 = c().fetchAll(b.call, { lastUpdateKey: 'B' });
        });
        edges.push(store[loadingKey]); // still true, second start did not re-toggle

        await act(async () => {
            a.control.resolve([...USERS]);
            await p1;
        });
        edges.push(store[loadingKey]); // still true, one in flight

        await act(async () => {
            b.control.resolve([...USERS]);
            await p2;
        });
        edges.push(store[loadingKey]); // false only now

        expect(edges).toEqual([true, true, true, false]);
    });
});
