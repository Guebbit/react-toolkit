import { create } from 'zustand';
import { getUuid } from '@guebbit/js-toolkit';

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

interface INotificationsState {
    history: IToastMessage[];
    dialogs: Record<string, boolean>;
}

interface INotificationsActions {
    getMessages: () => IToastMessage[];
    addMessage: (message: string, type?: IToastType, timeout?: number) => void;
    findMessage: (_id: string) => IToastMessage | undefined;
    hideMessage: (_id: string) => void;
    showMessage: (_id: string) => void;
    removeMessage: (_id: string) => void;
    setDialogVisibility: (name: string, visible: boolean) => void;
}

/**
 * Notifications store for managing toast messages and dialogs
 */
export const useNotificationsStore = create<INotificationsState & INotificationsActions>(
    (set, get) => ({
        // ________________ MESSAGES (also known as toasts) ________________

        /**
         * Settings
         */
        history: [],

        /**
         * Visible messages
         */
        getMessages: () => get().history.filter(({ visible }) => visible),

        /**
         * Add a message then after a timeout and then remove it (FIFO)
         *
         * @param message
         * @param type
         * @param timeout
         */
        addMessage: (message: string, type = IToastType.PRIMARY, timeout = -1) => {
            const id = getUuid();
            // Add to history
            set((state) => ({
                history: [
                    ...state.history,
                    {
                        id,
                        message,
                        type,
                        visible: true
                    }
                ]
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
        hideMessage: (_id: string) => {
            set((state) => ({
                history: state.history.map((message) =>
                    message.id === _id ? { ...message, visible: false } : message
                )
            }));
        },

        /**
         * Show a message visibility
         *
         * @param _id
         */
        showMessage: (_id: string) => {
            set((state) => ({
                history: state.history.map((message) =>
                    message.id === _id ? { ...message, visible: true } : message
                )
            }));
        },

        /**
         * Permanently remove a message (even from history)
         *
         * @param _id
         */
        removeMessage: (_id: string) => {
            set((state) => ({
                history: state.history.filter(({ id }) => id !== _id)
            }));
        },

        // ________________ DIALOGS ________________

        /**
         * Manage all dialogs
         * key is dialog name, value is dialog visibility (on/off)
         */
        dialogs: {},

        /**
         * Set dialog visibility
         *
         * @param name - dialog name
         * @param visible - visibility state
         */
        setDialogVisibility: (name: string, visible: boolean) => {
            set((state) => ({
                dialogs: { ...state.dialogs, [name]: visible }
            }));
        }
    })
);
