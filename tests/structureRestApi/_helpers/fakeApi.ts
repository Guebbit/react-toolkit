/**
 * Fake async-call helpers used as the `apiCall` argument of the fetch/mutate
 * methods. All are jest.fn()-based so specs can assert call counts.
 * Plain module (not a *.spec.ts) so Jest's testMatch ignores it.
 */

/** A call-counting stub that resolves with `data` (or `undefined`, if omitted). */
export function apiResolve<T>(data: T): jest.Mock<Promise<T>, []>;
export function apiResolve(): jest.Mock<Promise<undefined>, []>;
export function apiResolve<T>(data?: T): jest.Mock<Promise<T | undefined>, []> {
    return jest.fn(() => Promise.resolve(data));
}

/** A call-counting stub that rejects with an Error. */
export function apiReject(message = 'network error'): jest.Mock<Promise<never>, []> {
    return jest.fn(() => Promise.reject(new Error(message)));
}

/**
 * A stub that resolves with a fresh clone of `data` every call, and returns a
 * different `version` marker each time — handy to prove a refetch actually
 * replaced the previous value.
 */
export function apiVersioned<T extends object>(
    base: T
): jest.Mock<Promise<T & { version: number }>, []> {
    let version = 0;
    return jest.fn(() => {
        version += 1;
        return Promise.resolve({ ...base, version });
    });
}

export interface IDeferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
}

/** A promise whose resolution is controlled externally (for concurrency/latency tests). */
export function deferred<T>(): IDeferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/**
 * Wraps a value in a call-counting stub backed by an IDeferred, so the test can
 * decide WHEN the call resolves. Returns both the stub and its controls.
 */
export function deferredApi<T>(): { call: jest.Mock<Promise<T>, []>; control: IDeferred<T> } {
    const control = deferred<T>();
    const call = jest.fn(() => control.promise);
    return { call, control };
}
