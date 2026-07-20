/**
 * Generates a random unique value, used to fill in a missing identifier field.
 *
 * Guarded: `crypto` is not a global in every environment (some SSR/Node/jsdom setups),
 * and an unguarded `crypto.randomUUID()` throws there rather than degrading.
 */
export const generateFallbackValue = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
