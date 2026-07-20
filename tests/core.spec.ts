import { useCoreStore } from '../src/stores/core';

describe('useCoreStore', () => {
    beforeEach(() => {
        // Reset Zustand store state before each test
        useCoreStore.setState({ loadings: {} });
    });

    it('starts with no loadings', () => {
        const state = useCoreStore.getState();
        expect(state.isLoading()).toBe(false);
    });

    it('sets a loading key to true', () => {
        const state = useCoreStore.getState();
        state.setLoading('fetch', true);
        expect(useCoreStore.getState().getLoading('fetch')).toBe(true);
        expect(useCoreStore.getState().isLoading()).toBe(true);
    });

    it('sets a loading key to false', () => {
        const state = useCoreStore.getState();
        state.setLoading('fetch', true);
        state.setLoading('fetch', false);
        expect(useCoreStore.getState().getLoading('fetch')).toBe(false);
        expect(useCoreStore.getState().isLoading()).toBe(false);
    });

    it('resets all loadings', () => {
        const state = useCoreStore.getState();
        state.setLoading('a', true);
        state.setLoading('b', true);
        state.resetLoadings();
        expect(useCoreStore.getState().isLoading()).toBe(false);
    });

    it('returns true when at least one loading is active', () => {
        const state = useCoreStore.getState();
        state.setLoading('a', true);
        state.setLoading('b', false);
        expect(useCoreStore.getState().isLoading()).toBe(true);
    });
});
