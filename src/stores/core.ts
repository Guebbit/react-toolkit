import { create } from 'zustand';

export interface CoreState {
    loadings: Record<string | symbol, boolean>;
    setLoading: (key?: string, value?: boolean) => boolean;
    resetLoadings: () => void;
    getLoading: (key?: string) => boolean;
}

export const useCoreStore = create<CoreState>()((set, get) => ({
    loadings: {},
    setLoading: (key = '', value = false) => {
        set((state) => ({ loadings: { ...state.loadings, [key]: value } }));
        return value;
    },
    resetLoadings: () => set({ loadings: {} }),
    getLoading: (key = '') => !!get().loadings[key]
}));

export const isCoreLoading = () => Object.values(useCoreStore.getState().loadings).some(Boolean);
