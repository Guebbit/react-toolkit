import { create } from 'zustand';

export enum IToastType {
    PRIMARY = 'primary',
    SECONDARY = 'secondary',
    DANGER = 'error',
    WARNING = 'warning',
    SUCCESS = 'success'
}
export interface IToastMessage {
    id: string;
    message: string;
    type: IToastType;
    visible: boolean;
}

interface NotificationsState {
    history: IToastMessage[];
    dialogs: Record<string, boolean>;
    messages: () => IToastMessage[];
    addMessage: (message: string, type?: IToastType, timeout?: number) => void;
    findMessage: (_id: string) => IToastMessage | undefined;
    hideMessage: (_id: string) => void;
    showMessage: (_id: string) => void;
    removeMessage: (_id: string) => void;
}

/**
 *
 */
export const useNotificationsStore = create<NotificationsState>()((set, get) => ({
    // ________________ MESSAGES (also known as toasts) ________________

    /**
     * Settings
     */
    history: [],
    /**
     * Manage all dialogs
     * key is dialog name, value is dialog visibility (on/off)
     */
    dialogs: {},
    /**
     * Visible messages
     */
    messages: () => get().history.filter(({ visible }) => visible),
    /**
     * Add a message then after a timeout and then remove it (FIFO)
     *
     * @param message
     * @param type
     * @param timeout
     */
    addMessage: (message: string, type = IToastType.PRIMARY, timeout = -1) => {
        const id = crypto.randomUUID();
        // Add to history
        set((state) => ({
            history: [...state.history, { id, message, type, visible: true }]
        }));
        // Remove after timeout (if any)
        if (timeout > 0)
            setTimeout(() => {
                get().hideMessage(id);
            }, timeout);
    },
    /**
     * Find a message by id
     *
     * @param _id
     */
    findMessage: (_id: string) => get().history.find(({ id }) => id === _id),
    /**
     * Hide a message visibility
     *
     * @param _id
     */
    hideMessage: (_id: string) =>
        set((state) => ({
            history: state.history.map((message) =>
                message.id === _id ? { ...message, visible: false } : message
            )
        })),
    /**
     * Show a message visibility
     *
     * @param _id
     */
    showMessage: (_id: string) =>
        set((state) => ({
            history: state.history.map((message) =>
                message.id === _id ? { ...message, visible: true } : message
            )
        })),
    /**
     * Permanently remove a message (even from history)
     *
     * @param _id
     */
    removeMessage: (_id: string) =>
        set((state) => ({
            history: state.history.filter(({ id }) => id !== _id)
        }))
}));
