/**
 * A tiny stateful in-memory REST server for the "intention" scenario tests.
 * Each method returns a `() => Promise` closure suitable as an `apiCall`, and
 * every hit is counted in `calls` so specs can prove when the network was (not)
 * touched. Optional `latency` uses setTimeout (drive it with jest fake timers).
 * Plain module (not a *.spec.ts) so Jest's testMatch ignores it.
 */

export interface IServerOptions {
    /** When > 0, responses resolve after this many ms (needs fake timers to advance). */
    latency?: number;
}

export interface IServerCalls {
    list: number;
    get: number;
    search: number;
    create: number;
    update: number;
    remove: number;
}

export function createServer<T extends { id: number }>(
    seed: T[] = [],
    options: IServerOptions = {}
) {
    const store = new Map<number, T>(seed.map((item) => [item.id, { ...item }]));
    const calls: IServerCalls = { list: 0, get: 0, search: 0, create: 0, update: 0, remove: 0 };
    let autoId = 0;
    for (const item of seed) autoId = Math.max(autoId, item.id);

    const settle = <R>(value: R): Promise<R> => {
        if (!options.latency) return Promise.resolve(value);
        return new Promise<R>((resolve) => setTimeout(() => resolve(value), options.latency));
    };

    /** GET /resource — all items. */
    // eslint-disable-next-line unicorn/consistent-function-scoping -- must stay nested to match the `() => apiCall` factory contract shared with `get`/`many`/`search`
    const list = () => () => {
        calls.list += 1;
        return settle([...store.values()] as (T | undefined)[]);
    };

    /** GET /resource/:id — single item (or undefined). */
    const get = (id: number) => () => {
        calls.get += 1;
        const found = store.get(id);
        return settle(found ? { ...found } : undefined);
    };

    /** GET /resource/:id (batch) — the items whose id is in `ids`. */
    const many = (ids: number[]) => () => {
        calls.get += 1;
        return settle(
            ids.map((id) => store.get(id)).filter((item): item is T => item !== undefined)
        );
    };

    /**
     * GET /resource?filters — returns the matching items, paginated.
     * Pass a predicate describing the filter and the page/pageSize used.
     */
    const search =
        (predicate: (item: T) => boolean = () => true, page = 1, pageSize = 10) =>
        () => {
            calls.search += 1;
            const matched = [...store.values()].filter((item) => predicate(item));
            const start = (page - 1) * pageSize;
            return settle(matched.slice(start, start + pageSize) as (T | undefined)[]);
        };

    /** POST /resource — create; auto-assigns an id when absent. */
    const create = (data: Partial<T>) => () => {
        calls.create += 1;
        const id: number = (data as { id?: number }).id ?? (autoId += 1);
        const item = { ...data, id } as T;
        store.set(id, item);
        return settle({ ...item });
    };

    /** PUT /resource/:id — merge patch into the stored item, echo it back. */
    const update = (id: number, patch: Partial<T>) => () => {
        calls.update += 1;
        const existing = store.get(id);
        const merged = { ...existing, ...patch, id } as T;
        store.set(id, merged);
        return settle({ ...merged });
    };

    /** DELETE /resource/:id — remove and acknowledge. */
    const remove = (id: number) => () => {
        calls.remove += 1;
        store.delete(id);
        return settle<{ id: number }>({ id });
    };

    return { store, calls, list, get, many, search, create, update, remove };
}
