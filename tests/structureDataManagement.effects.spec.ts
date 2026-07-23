/**
 * EFFECT STABILITY — the reactive contract of useStructureDataManagement.
 *
 * These specs don't check WHAT the derived values return (structureDataManagement.spec.ts
 * does that); they check WHEN a derived value changes IDENTITY across renders. In React
 * that reference is the reactivity signal: a memo that keeps the same reference lets a
 * consumer memoized on it skip re-rendering, and a memo that produces a new reference on
 * an unrelated write makes every such consumer re-render for nothing. Both are invisible
 * to value-only tests, and both are exactly what a `useMemo`-dependency regression looks
 * like — flip a dep and the values stay correct while the re-render behaviour rots.
 *
 * Each write is its own act() so it maps to one committed render; the assertions compare
 * the derived value's reference (toBe / not.toBe) before and after that render.
 */

import { renderHook, act } from '@testing-library/react';
import { useStructureDataManagement } from '../src/hooks/structureDataManagement';

interface IItem {
    id: number;
    name: string;
    tag?: string;
}

const make = () => renderHook(() => useStructureDataManagement<IItem>('id')).result;

/** Seeds `n` sequentially-identified records inside one committed render. */
const seed = (c: ReturnType<typeof make>, n: number) => {
    act(() => {
        c.current.addRecords(Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `n${i}` })));
    });
};

describe('EFFECT STABILITY · useStructureDataManagement', () => {
    describe('selectedRecord — reference-level tracking', () => {
        it('keeps the SAME reference when an UNRELATED record changes', () => {
            const c = make();
            act(() => {
                c.current.addRecord({ id: 1, name: 'a' });
                c.current.addRecord({ id: 2, name: 'b' });
                c.current.setSelectedIdentifier(1);
            });
            const before = c.current.selectedRecord;

            act(() => {
                c.current.editRecord({ name: 'b-edited' }, 2 as never); // not the selected one
                c.current.addRecord({ id: 3, name: 'c' }); // brand-new, unrelated
            });

            // The dictionary reference changed, but record 1's object did not — so a
            // consumer memoized on selectedRecord must NOT be forced to re-render.
            expect(c.current.selectedRecord).toBe(before);
        });

        it('produces a NEW reference when the SELECTED record changes', () => {
            const c = make();
            act(() => {
                c.current.addRecord({ id: 1, name: 'a' });
                c.current.setSelectedIdentifier(1);
            });
            const before = c.current.selectedRecord;

            act(() => {
                c.current.editRecord({ name: 'a-edited' }, 1 as never);
            });

            expect(c.current.selectedRecord).not.toBe(before);
            expect(c.current.selectedRecord?.name).toBe('a-edited');
        });

        it('re-derives when the selected IDENTIFIER moves to another record', () => {
            const c = make();
            act(() => {
                c.current.addRecord({ id: 1, name: 'a' });
                c.current.addRecord({ id: 2, name: 'b' });
                c.current.setSelectedIdentifier(1);
            });

            act(() => c.current.setSelectedIdentifier(2));
            expect(c.current.selectedRecord).toEqual({ id: 2, name: 'b' });
        });

        it('tracks a not-yet-existing selection and resolves once that record is added', () => {
            const c = make();
            act(() => c.current.setSelectedIdentifier(5)); // nothing there yet
            expect(c.current.selectedRecord).toBeUndefined();

            act(() => {
                c.current.addRecord({ id: 5, name: 'late' });
            });
            expect(c.current.selectedRecord).toEqual({ id: 5, name: 'late' });
        });
    });

    describe('lastInsertedRecord', () => {
        it('moves to point at the most recently inserted record on each add', () => {
            const c = make();
            act(() => {
                c.current.addRecord({ id: 1, name: 'a' });
            });
            expect(c.current.lastInsertedRecord?.name).toBe('a');

            act(() => {
                c.current.addRecord({ id: 2, name: 'b' });
            });
            expect(c.current.lastInsertedRecord?.name).toBe('b');
        });
    });

    describe('itemList', () => {
        it('produces a NEW reference on each structural write, and the right contents', () => {
            const c = make();
            const empty = c.current.itemList;

            act(() => {
                c.current.addRecord({ id: 1, name: 'a' });
            });
            const afterAdd = c.current.itemList;
            expect(afterAdd).not.toBe(empty);
            expect(afterAdd).toHaveLength(1);

            act(() => {
                c.current.addRecord({ id: 2, name: 'b' });
            });
            expect(c.current.itemList).not.toBe(afterAdd);

            act(() => {
                c.current.deleteRecord(1 as never);
            });
            expect(c.current.itemList.map((i) => i.id)).toEqual([2]);
        });
    });

    describe('pagination is derived, not duplicated state', () => {
        it('pageTotal re-derives from item count and pageSize', () => {
            const c = make();
            seed(c, 25);
            expect(c.current.pageTotal).toBe(3); // ceil(25 / 10)

            act(() => c.current.setPageSize(5));
            expect(c.current.pageTotal).toBe(5); // ceil(25 / 5), recomputed from the new pageSize
        });

        it('pageOffset and pageItemList track pageCurrent without extra state', () => {
            const c = make();
            seed(c, 25);

            expect(c.current.pageOffset).toBe(0);
            expect(c.current.pageItemList.map((i) => i.id)).toEqual([
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10
            ]);

            act(() => c.current.setPageCurrent(3));
            expect(c.current.pageOffset).toBe(20);
            expect(c.current.pageItemList.map((i) => i.id)).toEqual([21, 22, 23, 24, 25]);
        });

        it('pageItemList keeps the SAME reference when only the selection changes', () => {
            const c = make();
            seed(c, 5);
            const before = c.current.pageItemList;

            // selecting a record touches selectedIdentifier, which pageItemList must not depend on
            act(() => c.current.setSelectedIdentifier(2));
            expect(c.current.pageItemList).toBe(before);
        });
    });
});
