import { useCallback, useRef, useState } from 'react';

/**
 * State whose current value is readable synchronously, the instant after it is
 * written, and whose writes still schedule a re-render.
 *
 * Plain `useState` cannot back this toolkit's data. Every hook here is written
 * against the read-your-own-write model: `addRecord` derives an id its caller
 * reads on the next line, `fetchMultiple` ingests a batch and immediately
 * resolves ids against it, `validate()` runs against a `form` the same event
 * handler just called `setForm` on. `useState` defers the write to the next
 * render, so each of those reads the previous value.
 *
 * Moving the work into a `setState` updater is not a way around it: updaters
 * must be pure, and React runs them lazily, twice under StrictMode, or — having
 * already computed a value eagerly to test for a bailout — not again at all. A
 * result smuggled out of an updater is therefore correct only for the first
 * call after a render and silently `undefined` for every call batched behind it.
 *
 * So the value lives in a ref (synchronous) and each write bumps a counter,
 * which is what actually schedules the re-render. Writes replace the value
 * rather than mutating it, so `useMemo` and `memo` consumers still observe a
 * changed identity.
 *
 * @param initialValue - the starting value, or a factory called once to build it.
 *                       Optional, mirroring `useState<T>()`, so a state that
 *                       legitimately starts out empty is declared as
 *                       `useLiveState<K | undefined>()`.
 * @returns `[valueRef, setValue]` — read `valueRef.current` for the live value
 */
export const useLiveState = <T>(initialValue?: T | (() => T)) => {
    const valueRef = useRef<T>(undefined as T);

    // A separate flag rather than a `null` sentinel, so `undefined`/`null` are
    // legal initial values (selectedIdentifier starts out undefined).
    const initialized = useRef(false);
    if (!initialized.current) {
        initialized.current = true;
        valueRef.current =
            typeof initialValue === 'function' ? (initialValue as () => T)() : (initialValue as T);
    }

    const [, bumpVersion] = useState(0);

    const setValue = useCallback((next: T | ((current: T) => T)) => {
        const value =
            typeof next === 'function' ? (next as (current: T) => T)(valueRef.current) : next;
        // Nothing changed: skip the re-render, mirroring useState's own bailout.
        if (Object.is(value, valueRef.current)) return;
        valueRef.current = value;
        bumpVersion((version) => version + 1);
    }, []);

    return [valueRef, setValue] as const;
};
