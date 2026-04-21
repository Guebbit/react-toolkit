import { act, renderHook } from '@testing-library/react';
import { useStructureDataManagement } from '../src/hooks/structureDataManagement';

interface ITestItem {
    id: number;
    name: string;
}

type Composable = ReturnType<typeof useStructureDataManagement<ITestItem>>;

const createRef = <T>(getter: () => T, setter?: (value: T) => void) =>
    Object.defineProperty({}, 'value', {
        get: getter,
        set: (value: T) => {
            if (!setter) return;
            act(() => setter(value));
        },
        enumerable: true
    }) as { value: T };

const makeComposable = () => {
    const rendered = renderHook(() => useStructureDataManagement<ITestItem>('id'));
    const current = () => rendered.result.current;

    return {
        getRecord: (...args: Parameters<Composable['getRecord']>) => current().getRecord(...args),
        addRecord: (item: ITestItem) => act(() => current().addRecord(item)),
        addRecords: (items: (ITestItem | undefined)[]) => act(() => current().addRecords(items)),
        editRecord: (...args: Parameters<Composable['editRecord']>) =>
            act(() => current().editRecord(...args)),
        editRecords: (items: (ITestItem | undefined)[]) => act(() => current().editRecords(items)),
        deleteRecord: (id: never) => act(() => current().deleteRecord(id)),
        setRecords: (items: never) => act(() => current().setRecords(items)),
        resetRecords: () => act(() => current().resetRecords()),
        addToParent: (parentId: never, childId: never) => act(() => current().addToParent(parentId, childId)),
        removeFromParent: (parentId: never, childId: never) =>
            act(() => current().removeFromParent(parentId, childId)),
        getListByParent: (parentId: never) => current().getListByParent(parentId),
        itemList: createRef(() => current().itemList),
        selectedIdentifier: createRef(
            () => current().selectedIdentifier,
            (value) => current().setSelectedIdentifier(value)
        ),
        selectedRecord: createRef(() => current().selectedRecord),
        pageCurrent: createRef(() => current().pageCurrent, (value) => current().setPageCurrent(value)),
        pageSize: createRef(() => current().pageSize, (value) => current().setPageSize(value)),
        pageTotal: createRef(() => current().pageTotal),
        pageItemList: createRef(() => current().pageItemList)
    };
};

describe('useStructureDataManagement', () => {
    let composable: ReturnType<typeof makeComposable>;

    beforeEach(() => {
        composable = makeComposable();
    });

    describe('addRecord / getRecord', () => {
        it('adds a record and retrieves it by id', () => {
            const item: ITestItem = { id: 1, name: 'Alice' };
            composable.addRecord(item);
            expect(composable.getRecord(1 as never)).toEqual(item);
        });

        it('overwrites an existing record when added again', () => {
            composable.addRecord({ id: 1, name: 'Alice' });
            composable.addRecord({ id: 1, name: 'Bob' });
            expect(composable.getRecord(1 as never)).toEqual({ id: 1, name: 'Bob' });
        });

        it('returns undefined for a missing record', () => {
            expect(composable.getRecord(99 as never)).toBeUndefined();
        });
    });

    describe('addRecords / itemList', () => {
        it('adds multiple records and exposes them in itemList', () => {
            composable.addRecords([
                { id: 1, name: 'Alice' },
                { id: 2, name: 'Bob' }
            ]);
            expect(composable.itemList.value).toHaveLength(2);
        });

        it('skips undefined entries in addRecords', () => {
            composable.addRecords([{ id: 1, name: 'Alice' }, undefined]);
            expect(composable.itemList.value).toHaveLength(1);
        });
    });

    describe('editRecord', () => {
        it('merges partial data into an existing record', () => {
            composable.addRecord({ id: 1, name: 'Alice' });
            composable.editRecord({ name: 'Alice Updated' }, 1 as never);
            expect(composable.getRecord(1 as never)).toEqual({ id: 1, name: 'Alice Updated' });
        });

        it('creates a new record when create flag is true and id is missing', () => {
            composable.editRecord({ id: 2, name: 'Bob' }, 2 as never, true);
            expect(composable.getRecord(2 as never)).toEqual({ id: 2, name: 'Bob' });
        });
    });

    describe('deleteRecord', () => {
        it('removes a record from the dictionary', () => {
            composable.addRecord({ id: 1, name: 'Alice' });
            composable.deleteRecord(1 as never);
            expect(composable.getRecord(1 as never)).toBeUndefined();
        });
    });

    describe('setRecords / resetRecords', () => {
        it('sets the full dictionary directly', () => {
            composable.setRecords({ alice: { id: 1, name: 'Alice' } } as never);
            expect(composable.itemList.value).toHaveLength(1);
        });

        it('resets the dictionary to empty', () => {
            composable.addRecord({ id: 1, name: 'Alice' });
            composable.resetRecords();
            expect(composable.itemList.value).toHaveLength(0);
        });
    });

    describe('selectedRecord', () => {
        it('returns the selected record when selectedIdentifier is set', () => {
            const item: ITestItem = { id: 1, name: 'Alice' };
            composable.addRecord(item);
            composable.selectedIdentifier.value = 1 as never;
            expect(composable.selectedRecord.value).toEqual(item);
        });
    });

    describe('pagination', () => {
        beforeEach(() => {
            composable.addRecords(
                Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }))
            );
            composable.pageSize.value = 10;
        });

        it('calculates total pages correctly', () => {
            expect(composable.pageTotal.value).toBe(3);
        });

        it('returns items for the current page', () => {
            composable.pageCurrent.value = 1;
            expect(composable.pageItemList.value).toHaveLength(10);
        });

        it('returns remaining items on the last page', () => {
            composable.pageCurrent.value = 3;
            expect(composable.pageItemList.value).toHaveLength(5);
        });
    });

    describe('parent-child relationships', () => {
        it('adds a child to a parent and retrieves it', () => {
            composable.addRecord({ id: 1, name: 'Child' });
            composable.addToParent('parent-1' as never, 1 as never);
            const list = composable.getListByParent('parent-1' as never);
            expect(list).toHaveLength(1);
        });

        it('removes a child from a parent', () => {
            composable.addRecord({ id: 1, name: 'Child' });
            composable.addToParent('parent-1' as never, 1 as never);
            composable.removeFromParent('parent-1' as never, 1 as never);
            const list = composable.getListByParent('parent-1' as never);
            expect(list).toHaveLength(0);
        });
    });
});
