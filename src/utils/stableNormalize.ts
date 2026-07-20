/**
 * Rebuilds a value with every object's keys sorted, so JSON.stringify of the
 * result is a stable cache key regardless of property insertion order. Recurses
 * into nested objects — a single-level `Object.keys().toSorted()` replacer only
 * sorts the top level and silently corrupts nested keys.
 *
 * Arrays keep their order (meaningful in a filter, e.g. sort priority);
 * `undefined` values are dropped (an absent filter and an explicitly unset one
 * share a key); `Date` becomes its ISO string.
 */
export const stableNormalize = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => stableNormalize(item));
    const source = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(source).toSorted())
        if (source[key] !== undefined) normalized[key] = stableNormalize(source[key]);
    return normalized;
};
