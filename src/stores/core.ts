import { create } from 'zustand';

interface ICoreState {
    /**
     * This loading must be accessed from anywhere.
     * Components, guards and so on.
     */
    loadings: Record<string | symbol, boolean>;
}

interface ICoreActions {
    setLoading: (key?: string | symbol, value?: boolean) => void;
    resetLoadings: () => void;
    getLoading: (key?: string | symbol) => boolean;
    isLoading: () => boolean;
}

export const useCoreStore = create<ICoreState & ICoreActions>((set, get) => ({
    loadings: {},

    /**
     * Set loading value
     *
     * @param key
     * @param value
     */
    setLoading: (key = '', value = false) => {
        set((state) => ({
            loadings: { ...state.loadings, [key]: value }
        }));
    },

    /**
     * Reset all loadings
     */
    resetLoadings: () => {
        set({ loadings: {} });
    },

    /**
     * Check if there is a specific loading
     */
    getLoading: (key = '') => !!get().loadings[key],

    /**
     * Check if there are any loadings
     */
    isLoading: () => Object.values(get().loadings).some(Boolean)
}));
