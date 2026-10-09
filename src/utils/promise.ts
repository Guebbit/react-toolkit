/**
 * Promise-chain helpers used in place of `async`/`await` across `src/`.
 *
 * Both exist to keep a chain's observable timing identical to the `await` it replaced. That is
 * not pedantry: extra microtask hops are visible to consumers testing with React's `act`, whose
 * thenable can settle in the gap and show a test the state from before the chain's tail ran.
 */

/**
 * Invoke `run` NOW and hand back its result as a promise.
 *
 * Two properties, both of which `await run()` had and a bare `Promise.resolve().then(run)` does
 * not: the call happens synchronously, so anything the caller does right after sees the work
 * already started; and a SYNCHRONOUS throw inside `run` arrives as a rejection instead of
 * escaping the call frame. `Promise.resolve` passes a native promise straight through, so no hop
 * is added on the way out either.
 *
 * @param run
 */
export const runAsPromise = <R>(run: () => R | Promise<R>): Promise<R> => {
    try {
        return Promise.resolve(run());
    } catch (error: unknown) {
        // Rejected with the thrown value exactly as-is, Error or not: `await` did not reshape it,
        // and a caller matching on a thrown `{ code: 401 }` must still see that object.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(error);
    }
};

/**
 * Run `cleanup` as `promise` settles, either way, then settle the same way.
 *
 * `.finally` reads better but settles a few microtasks AFTER the cleanup, and that gap is
 * observable (see above). The two-arm form settles in the same tick the cleanup ran in, which is
 * what `try`/`finally` around an `await` gave.
 *
 * @param promise
 * @param cleanup
 */
export const withCleanup = <R>(promise: Promise<R>, cleanup: () => void): Promise<R> =>
    promise.then(
        (value) => {
            cleanup();
            return value;
        },
        (error: unknown) => {
            cleanup();
            throw error;
        }
    );
