import { create } from 'zustand';

export interface CoreState {
    loadings: Record<string | symbol, boolean>;
    setLoading: (key?: string, value?: boolean) => boolean;
    resetLoadings: () => void;
    getLoading: (key?: string) => boolean;
}

export const useCoreStore = create<CoreState>()((set, get) => ({
    /**
     * This loading state must be accessible from anywhere:
     * components, guards and so on.
     */
    loadings: {},
    /**
     * Set loading value
     *
     * @param key
     * @param value
     */
    setLoading: (key = '', value = false) => {
        set((state) => ({ loadings: { ...state.loadings, [key]: value } }));
        return value;
    },
    /**
     * Reset all loadings
     */
    resetLoadings: () => set({ loadings: {} }),
    /**
     * Check if there is a specific loading
     */
    getLoading: (key = '') => !!get().loadings[key]
}));

/**
 * Check if there are any loadings
 */
export const isCoreLoading = () => Object.values(useCoreStore.getState().loadings).some(Boolean);
