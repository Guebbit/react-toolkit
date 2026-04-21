import { useNotificationsStore, IToastType } from '../src/stores/notifications';

describe('useNotificationsStore', () => {
    beforeEach(() => {
        useNotificationsStore.setState({ history: [], dialogs: {} });
    });

    it('starts with empty history and messages', () => {
        const store = useNotificationsStore.getState();
        expect(store.history).toHaveLength(0);
        expect(store.messages()).toHaveLength(0);
    });

    it('adds a message to history', () => {
        const store = useNotificationsStore.getState();
        store.addMessage('Hello', IToastType.SUCCESS);
        const history = useNotificationsStore.getState().history;
        expect(history).toHaveLength(1);
        expect(history[0]?.message).toBe('Hello');
        expect(history[0]?.type).toBe(IToastType.SUCCESS);
        expect(history[0]?.visible).toBe(true);
    });

    it('shows visible messages in computed messages', () => {
        const store = useNotificationsStore.getState();
        store.addMessage('Visible', IToastType.PRIMARY);
        expect(useNotificationsStore.getState().messages()).toHaveLength(1);
    });

    it('hides a message by id', () => {
        const store = useNotificationsStore.getState();
        store.addMessage('Hide me', IToastType.WARNING);
        const id = useNotificationsStore.getState().history[0]!.id;
        store.hideMessage(id);
        expect(useNotificationsStore.getState().messages()).toHaveLength(0);
        expect(useNotificationsStore.getState().history[0]!.visible).toBe(false);
    });

    it('shows a hidden message by id', () => {
        const store = useNotificationsStore.getState();
        store.addMessage('Toggle me', IToastType.DANGER);
        const id = useNotificationsStore.getState().history[0]!.id;
        store.hideMessage(id);
        store.showMessage(id);
        expect(useNotificationsStore.getState().messages()).toHaveLength(1);
        expect(useNotificationsStore.getState().history[0]!.visible).toBe(true);
    });

    it('removes a message permanently from history', () => {
        const store = useNotificationsStore.getState();
        store.addMessage('Remove me', IToastType.PRIMARY);
        const id = useNotificationsStore.getState().history[0]!.id;
        store.removeMessage(id);
        expect(useNotificationsStore.getState().history).toHaveLength(0);
    });

    it('finds a message by id', () => {
        const store = useNotificationsStore.getState();
        store.addMessage('Find me', IToastType.SECONDARY);
        const id = useNotificationsStore.getState().history[0]!.id;
        const found = store.findMessage(id);
        expect(found?.message).toBe('Find me');
    });

    it('dialogs are empty by default', () => {
        const store = useNotificationsStore.getState();
        expect(Object.keys(store.dialogs)).toHaveLength(0);
    });
});
