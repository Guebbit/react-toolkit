import { useNotificationsStore, IToastType } from '../src/stores/notifications';

describe('useNotificationsStore', () => {
  beforeEach(() => {
    // Reset Zustand store state before each test
    useNotificationsStore.setState({
      history: [],
      dialogs: {}
    });
  });

  it('starts with empty history and messages', () => {
    const store = useNotificationsStore.getState();
    expect(store.history).toHaveLength(0);
    expect(store.getMessages()).toHaveLength(0);
  });

  it('adds a message to history', () => {
    const store = useNotificationsStore.getState();
    store.addMessage('Hello', IToastType.SUCCESS);
    const s = useNotificationsStore.getState();
    expect(s.history).toHaveLength(1);
    expect(s.history[0].message).toBe('Hello');
    expect(s.history[0].type).toBe(IToastType.SUCCESS);
    expect(s.history[0].visible).toBe(true);
  });

  it('shows visible messages in computed messages', () => {
    const store = useNotificationsStore.getState();
    store.addMessage('Visible', IToastType.PRIMARY);
    expect(useNotificationsStore.getState().getMessages()).toHaveLength(1);
  });

  it('hides a message by id', () => {
    const store = useNotificationsStore.getState();
    store.addMessage('Hide me', IToastType.WARNING);
    const updated = useNotificationsStore.getState();
    const id = updated.history[0].id;
    updated.hideMessage(id);
    const s = useNotificationsStore.getState();
    expect(s.getMessages()).toHaveLength(0);
    expect(s.history[0].visible).toBe(false);
  });

  it('shows a hidden message by id', () => {
    const s0 = useNotificationsStore.getState();
    s0.addMessage('Toggle me', IToastType.DANGER);
    const s1 = useNotificationsStore.getState();
    const id = s1.history[0].id;
    s1.hideMessage(id);
    s1.showMessage(id);
    const s = useNotificationsStore.getState();
    expect(s.getMessages()).toHaveLength(1);
    expect(s.history[0].visible).toBe(true);
  });

  it('removes a message permanently from history', () => {
    const s0 = useNotificationsStore.getState();
    s0.addMessage('Remove me', IToastType.PRIMARY);
    const s1 = useNotificationsStore.getState();
    const id = s1.history[0].id;
    s1.removeMessage(id);
    expect(useNotificationsStore.getState().history).toHaveLength(0);
  });

  it('finds a message by id', () => {
    const s0 = useNotificationsStore.getState();
    s0.addMessage('Find me', IToastType.SECONDARY);
    const s1 = useNotificationsStore.getState();
    const id = s1.history[0].id;
    const found = s1.findMessage(id);
    expect(found?.message).toBe('Find me');
  });

  it('dialogs are empty by default', () => {
    const store = useNotificationsStore.getState();
    expect(Object.keys(store.dialogs)).toHaveLength(0);
  });
});