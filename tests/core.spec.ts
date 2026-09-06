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

    it('ignores active keys outside the given prefixes', () => {
        useCoreStore.getState().setLoading('cart', true);
        expect(useCoreStore.getState().isLoading(['accountProfile'])).toBe(false);
        expect(useCoreStore.getState().isLoading(['cart'])).toBe(true);
    });

    it('matches every key under a prefix, action postfixes included', () => {
        useCoreStore.getState().setLoading('accountProfile:avatar-upload', true);
        expect(useCoreStore.getState().isLoading(['account'])).toBe(true);
        expect(useCoreStore.getState().isLoading(['accountProfile:avatar-upload'])).toBe(true);
        expect(useCoreStore.getState().isLoading(['accountProfile:avatar-remove'])).toBe(false);
    });

    it('accepts several prefixes, any of which is enough', () => {
        useCoreStore.getState().setLoading('orders', true);
        expect(useCoreStore.getState().isLoading(['cart', 'orders'])).toBe(true);
        expect(useCoreStore.getState().isLoading(['cart', 'wishlist'])).toBe(false);
    });

    it('answers false for a prefix whose only key is inactive', () => {
        useCoreStore.getState().setLoading('cart', false);
        expect(useCoreStore.getState().isLoading(['cart'])).toBe(false);
    });

    it('matches a prefix only from the start of the key', () => {
        useCoreStore.getState().setLoading('my-account', true);
        expect(useCoreStore.getState().isLoading(['account'])).toBe(false);
    });
});
