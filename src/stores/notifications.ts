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

export const useNotificationsStore = create<NotificationsState>()((set, get) => ({
    history: [],
    dialogs: {},
    messages: () => get().history.filter(({ visible }) => visible),
    addMessage: (message: string, type = IToastType.PRIMARY, timeout = -1) => {
        const id = crypto.randomUUID();
        set((state) => ({
            history: [...state.history, { id, message, type, visible: true }]
        }));
        if (timeout > 0)
            setTimeout(() => {
                get().hideMessage(id);
            }, timeout);
    },
    findMessage: (_id: string) => get().history.find(({ id }) => id === _id),
    hideMessage: (_id: string) =>
        set((state) => ({
            history: state.history.map((message) =>
                message.id === _id ? { ...message, visible: false } : message
            )
        })),
    showMessage: (_id: string) =>
        set((state) => ({
            history: state.history.map((message) =>
                message.id === _id ? { ...message, visible: true } : message
            )
        })),
    removeMessage: (_id: string) =>
        set((state) => ({
            history: state.history.filter(({ id }) => id !== _id)
        }))
}));
