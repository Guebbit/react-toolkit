import { create } from 'zustand';

interface ICoreState {
    /**
     * This loading must be accessed from anywhere.
     * Components, guards and so on.
     */
    loadings: Record<string, boolean>;
}

interface ICoreActions {
    setLoading: (key?: string, value?: boolean) => void;
    resetLoadings: () => void;
    getLoading: (key?: string) => boolean;
    isLoading: (prefixes?: string[]) => boolean;
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
     * Check if anything is loading.
     *
     * Prefixes scope the question: keys are namespaced by their owner ('accountProfile') and
     * their action ('accountProfile:avatar-upload'), so a caller asks about one module, one
     * screen or one button instead of the whole app. No prefixes: any key at all.
     *
     * @param prefixes
     */
    isLoading: (prefixes = []) =>
        Object.entries(get().loadings).some(
            ([key, value]) =>
                value &&
                (prefixes.length === 0 || prefixes.some((prefix) => key.startsWith(prefix)))
        )
}));
