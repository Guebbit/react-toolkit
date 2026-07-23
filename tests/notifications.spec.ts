import { useNotificationsStore, IToastType } from '../src/stores/notifications';

/** Adds three messages and returns their ids in insertion order. */
const addThree = () => {
    const store = useNotificationsStore.getState();
    store.addMessage('one', IToastType.PRIMARY);
    store.addMessage('two', IToastType.PRIMARY);
    store.addMessage('three', IToastType.PRIMARY);
    return useNotificationsStore.getState().history.map(({ id }) => id);
};

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

    describe('operations target ONLY the given id (isolation)', () => {
        it('hideMessage hides only the target, leaving the others visible', () => {
            const [, second] = addThree();
            useNotificationsStore.getState().hideMessage(second);

            const visible = useNotificationsStore.getState().getMessages();
            expect(visible.map((m) => m.message)).toEqual(['one', 'three']); // 'two' gone, rest stay
        });

        it('showMessage shows only the target, leaving the others as they were', () => {
            const [first, second, third] = addThree();
            const store = useNotificationsStore.getState();
            store.hideMessage(first);
            store.hideMessage(second);
            store.hideMessage(third);
            // now reveal just the middle one
            store.showMessage(second);

            const visible = useNotificationsStore.getState().getMessages();
            expect(visible.map((m) => m.message)).toEqual(['two']); // only 'two' back, not all
        });

        it('removeMessage removes only the target, keeping the rest of history', () => {
            const [, second] = addThree();
            useNotificationsStore.getState().removeMessage(second);

            const remaining = useNotificationsStore.getState().history;
            expect(remaining.map((m) => m.message)).toEqual(['one', 'three']); // only 'two' removed
        });

        it('findMessage returns the matching message, and undefined for an unknown id', () => {
            const [, second] = addThree();
            const store = useNotificationsStore.getState();
            expect(store.findMessage(second)?.message).toBe('two'); // the RIGHT one, not just the first
            expect(store.findMessage('does-not-exist')).toBeUndefined();
        });
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

    describe('auto-hide timeout', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        it('hides a message automatically after a positive timeout', () => {
            const store = useNotificationsStore.getState();
            store.addMessage('Temporary', IToastType.PRIMARY, 1000);
            expect(useNotificationsStore.getState().getMessages()).toHaveLength(1);

            jest.advanceTimersByTime(999);
            expect(useNotificationsStore.getState().getMessages()).toHaveLength(1); // not yet

            jest.advanceTimersByTime(1);
            const s = useNotificationsStore.getState();
            expect(s.getMessages()).toHaveLength(0); // hidden at the deadline
            expect(s.history).toHaveLength(1); // but still in history (hidden, not removed)
        });

        it('does NOT schedule any hide when timeout is <= 0', () => {
            const store = useNotificationsStore.getState();
            store.addMessage('Sticky', IToastType.PRIMARY); // default timeout -1
            store.addMessage('AlsoSticky', IToastType.PRIMARY, 0); // explicit 0

            jest.advanceTimersByTime(1_000_000);
            expect(useNotificationsStore.getState().getMessages()).toHaveLength(2); // both stay visible
        });
    });
});
