import { renderHook, act } from '@testing-library/react';
import { useStructureDataManagement } from '../src/hooks/structureDataManagement';

interface ITestItem {
    id: number;
    name: string;
}

describe('useStructureDataManagement', () => {
    describe('addRecord / getRecord', () => {
        it('adds a record and retrieves it by id', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));
            const item: ITestItem = { id: 1, name: 'Alice' };

            act(() => {
                result.current.addRecord(item);
            });

            expect(result.current.getRecord(1 as never)).toEqual(item);
        });

        it('overwrites an existing record when added again', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.addRecord({ id: 1, name: 'Alice' });
                result.current.addRecord({ id: 1, name: 'Bob' });
            });

            expect(result.current.getRecord(1 as never)).toEqual({ id: 1, name: 'Bob' });
        });

        it('returns undefined for a missing record', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));
            expect(result.current.getRecord(99 as never)).toBeUndefined();
        });
    });

    describe('addRecords / itemList', () => {
        it('adds multiple records and exposes them in itemList', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.addRecords([
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' }
                ]);
            });

            expect(result.current.itemList).toHaveLength(2);
        });

        it('skips undefined entries in addRecords', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.addRecords([{ id: 1, name: 'Alice' }, undefined]);
            });

            expect(result.current.itemList).toHaveLength(1);
        });
    });

    describe('editRecord', () => {
        it('merges partial data into an existing record', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.addRecord({ id: 1, name: 'Alice' });
                result.current.editRecord({ name: 'Alice Updated' }, 1 as never);
            });

            expect(result.current.getRecord(1 as never)).toEqual({ id: 1, name: 'Alice Updated' });
        });

        it('creates a new record when create flag is true and id is missing', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.editRecord({ id: 2, name: 'Bob' }, 2 as never, true);
            });

            expect(result.current.getRecord(2 as never)).toEqual({ id: 2, name: 'Bob' });
        });
    });

    describe('deleteRecord', () => {
        it('removes a record from the dictionary', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.addRecord({ id: 1, name: 'Alice' });
                result.current.deleteRecord(1 as never);
            });

            expect(result.current.getRecord(1 as never)).toBeUndefined();
        });
    });

    describe('setRecords / resetRecords', () => {
        it('sets the full dictionary directly', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.setRecords({ alice: { id: 1, name: 'Alice' } } as never);
            });

            expect(result.current.itemList).toHaveLength(1);
        });

        it('resets the dictionary to empty', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.addRecord({ id: 1, name: 'Alice' });
                result.current.resetRecords();
            });

            expect(result.current.itemList).toHaveLength(0);
        });
    });

    describe('selectedRecord', () => {
        it('returns the selected record when selectedIdentifier is set', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));
            const item: ITestItem = { id: 1, name: 'Alice' };

            act(() => {
                result.current.addRecord(item);
                result.current.setSelectedIdentifier(1 as never);
            });

            expect(result.current.selectedRecord).toEqual(item);
        });
    });

    describe('pagination', () => {
        it('calculates total pages correctly', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.addRecords(
                    Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }))
                );
                result.current.setPageSize(10);
            });

            expect(result.current.pageTotal).toBe(3);
        });

        it('returns items for the current page', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.addRecords(
                    Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }))
                );
                result.current.setPageSize(10);
                result.current.setPageCurrent(1);
            });

            expect(result.current.pageItemList).toHaveLength(10);
        });

        it('returns remaining items on the last page', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.addRecords(
                    Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }))
                );
                result.current.setPageSize(10);
                result.current.setPageCurrent(3);
            });

            expect(result.current.pageItemList).toHaveLength(5);
        });
    });

    describe('parent-child relationships', () => {
        it('adds a child to a parent and retrieves it', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.addRecord({ id: 1, name: 'Child' });
                result.current.addToParent('parent-1' as never, 1 as never);
            });

            const list = result.current.getListByParent('parent-1' as never);
            expect(list).toHaveLength(1);
        });

        it('removes a child from a parent', () => {
            const { result } = renderHook(() => useStructureDataManagement<ITestItem>('id'));

            act(() => {
                result.current.addRecord({ id: 1, name: 'Child' });
                result.current.addToParent('parent-1' as never, 1 as never);
                result.current.removeFromParent('parent-1' as never, 1 as never);
            });

            const list = result.current.getListByParent('parent-1' as never);
            expect(list).toHaveLength(0);
        });
    });
});