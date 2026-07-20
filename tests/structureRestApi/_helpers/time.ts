/**
 * Fake-clock helpers for the TTL / concurrency specs.
 *
 * Usage inside a describe:
 *   beforeEach(() => useFakeClock());
 *   afterEach(() => { clearAllInstances(); restoreClock(); });
 *   ...
 *   await advance(TTL + 1); // travel past the stale window
 *
 * `advance` uses jest.advanceTimersByTimeAsync so pending promise microtasks
 * (the resolved apiCall chains) flush between steps. Immediate (latency-0) APIs
 * don't need advance — just await the fetch call.
 *
 * Plain module (not a *.spec.ts) so Jest's testMatch ignores it.
 */

/** Fixed, deterministic base time so dataUpdatedAt math is stable. */
export const BASE_NOW = new Date('2026-01-01T00:00:00.000Z').getTime();

export function useFakeClock(now: number = BASE_NOW): void {
    jest.useFakeTimers({ now });
}

export async function advance(ms: number): Promise<void> {
    await jest.advanceTimersByTimeAsync(ms);
}

export function restoreClock(): void {
    jest.useRealTimers();
}
