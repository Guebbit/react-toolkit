import { isCoreLoading, useCoreStore } from '../src/stores/core';

describe('useCoreStore', () => {
    beforeEach(() => {
        useCoreStore.setState({ loadings: {} });
    });

    it('starts with no loadings', () => {
        expect(isCoreLoading()).toBe(false);
    });

    it('sets a loading key to true', () => {
        const store = useCoreStore.getState();
        store.setLoading('fetch', true);
        expect(store.getLoading('fetch')).toBe(true);
        expect(isCoreLoading()).toBe(true);
    });

    it('sets a loading key to false', () => {
        const store = useCoreStore.getState();
        store.setLoading('fetch', true);
        store.setLoading('fetch', false);
        expect(store.getLoading('fetch')).toBe(false);
        expect(isCoreLoading()).toBe(false);
    });

    it('resets all loadings', () => {
        const store = useCoreStore.getState();
        store.setLoading('a', true);
        store.setLoading('b', true);
        store.resetLoadings();
        expect(isCoreLoading()).toBe(false);
    });

    it('returns true when at least one loading is active', () => {
        const store = useCoreStore.getState();
        store.setLoading('a', true);
        store.setLoading('b', false);
        expect(isCoreLoading()).toBe(true);
    });
});
