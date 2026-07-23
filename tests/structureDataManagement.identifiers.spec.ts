/**
 * UNIT — identifier resolution, batch edits and the error/guard branches of
 * useStructureDataManagement.
 *
 * The base spec covers the happy path; these cover the logic that only runs at
 * the edges and was previously untested: fallback-id generation for records that
 * arrive without their identifier, multiple/custom identifiers, editRecords batch
 * semantics, and the create=false guard rails. These are exactly the branches a
 * value-only happy-path suite silently skips.
 *
 * createIdentifier does not touch React state (it only reads/writes the plain item
 * object and may console.warn), so it is asserted directly; the mutating helpers
 * (addRecord/editRecord/…) are wrapped in act() so their state lands before we read.
 */

import { renderHook, act } from '@testing-library/react';
import { useStructureDataManagement } from '../src/hooks/structureDataManagement';

interface IItem {
    id?: number | string;
    name: string;
}

const setup = <T extends Record<string, unknown> = Record<string, unknown>>(
    identifiers: string | string[] = 'id',
    delimiter = '_'
) => renderHook(() => useStructureDataManagement<T>(identifiers, delimiter)).result;

describe('UNIT · identifier resolution & guards', () => {
    let warn: jest.SpyInstance;
    let error: jest.SpyInstance;

    beforeEach(() => {
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        error = jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
        error.mockRestore();
    });

    describe('createIdentifier — single identifier', () => {
        it('returns the identifier value when present', () => {
            const c = setup<IItem>('id');
            expect(c.current.createIdentifier({ id: 7, name: 'x' })).toBe(7);
            expect(warn).not.toHaveBeenCalled();
        });

        it('generates a fallback id when the identifier is missing, and WRITES it back onto the item', () => {
            const c = setup<IItem>('id');
            const item: IItem = { name: 'no-id' };
            const id = c.current.createIdentifier(item);

            expect(id).toBeDefined();
            expect(item.id).toBe(id); // the generated id is persisted on the item itself
            expect(warn).toHaveBeenCalled();
        });

        it('is STABLE across repeated calls on the same item (id is generated once, then read back)', () => {
            const c = setup<IItem>('id');
            const item: IItem = { name: 'no-id' };
            const first = c.current.createIdentifier(item);
            const second = c.current.createIdentifier(item);
            expect(second).toBe(first);
        });

        it('treats null like missing (generates a fallback)', () => {
            const c = setup<IItem>('id');
            // eslint-disable-next-line unicorn/no-null
            const item = { id: null, name: 'x' } as unknown as IItem;
            const id = c.current.createIdentifier(item);
            expect(id).toBeDefined();
            expect(id).not.toBeNull(); // a null must be REPLACED, not returned as-is
            expect(item.id).toBe(id);
            expect(warn).toHaveBeenCalled(); // the fill path ran
        });

        it('supports a custom identifier field via the second argument', () => {
            // Regression guard: the single-identifier branch must honour the custom
            // field passed here, not fall back to the instance default ('id').
            const c = setup('id');
            expect(c.current.createIdentifier({ id: 1, slug: 'abc' }, 'slug')).toBe('abc');
        });
    });

    describe('createIdentifier — multiple identifiers', () => {
        it('joins the identifier values with the delimiter, in declared order', () => {
            const c = setup(['a', 'b'], '|');
            expect(c.current.createIdentifier({ a: 'x', b: 'y' })).toBe('x|y');
            expect(warn).not.toHaveBeenCalled(); // both present → NO fallback fill
        });

        it('defaults the delimiter to "|" when none is given', () => {
            const c = renderHook(() =>
                useStructureDataManagement<Record<string, unknown>>(['a', 'b'])
            ).result;
            expect(c.current.createIdentifier({ a: 'x', b: 'y' })).toBe('x|y');
        });

        it('order is significant: swapping the values changes the key', () => {
            const c = setup(['a', 'b'], '|');
            expect(c.current.createIdentifier({ a: 'x', b: 'y' })).not.toBe(
                c.current.createIdentifier({ a: 'y', b: 'x' })
            );
        });

        it('fills ONLY the missing identifier fields with a fallback, keeping the present ones', () => {
            const c = setup(['a', 'b'], '|');
            const item: Record<string, unknown> = { a: 'x' }; // b missing
            const id = c.current.createIdentifier(item);

            expect(item.a).toBe('x'); // untouched
            expect(item.b).toBeDefined(); // filled
            expect(id).toBe(`x|${String(item.b)}`);
            expect(warn).toHaveBeenCalled();
        });

        it('getRecord resolves a multi-identifier record by its parts', () => {
            const c = setup(['a', 'b'], '|');
            act(() => {
                c.current.addRecord({ a: 'x', b: 'y', name: 'combo' });
            });
            expect(c.current.getRecord('x' as never, 'y' as never)).toEqual({
                a: 'x',
                b: 'y',
                name: 'combo'
            });
        });
    });

    describe('addRecord with a missing identifier', () => {
        it('lastInsertedRecord is undefined before anything is inserted', () => {
            const c = setup<IItem>('id');
            expect(c.current.lastInsertedIdentifier).toBeUndefined();
            expect(c.current.lastInsertedRecord).toBeUndefined();
        });

        it('assigns a fallback id and exposes it via lastInsertedIdentifier/Record', () => {
            const c = setup<IItem>('id');
            act(() => {
                c.current.addRecord({ name: 'auto' });
            });

            const id = c.current.lastInsertedIdentifier;
            expect(id).toBeDefined();
            expect(c.current.getRecord(id)).toEqual({ id, name: 'auto' });
            expect(c.current.lastInsertedRecord).toEqual({ id, name: 'auto' });
        });
    });

    describe('editRecord return value & guards', () => {
        it('returns the new id when it CREATED a record', () => {
            const c = setup<IItem>('id');
            let returned: unknown;
            act(() => {
                returned = c.current.editRecord({ id: 1, name: 'new' }, 1 as never);
            });
            expect(returned).toBe(1);
        });

        it('returns undefined when it only UPDATED an existing record', () => {
            const c = setup<IItem>('id');
            let returned: unknown = 'unset';
            act(() => {
                c.current.addRecord({ id: 1, name: 'a' });
                returned = c.current.editRecord({ name: 'b' }, 1 as never);
            });
            expect(returned).toBeUndefined();
            expect(c.current.getRecord(1 as never)?.name).toBe('b');
        });

        it('create=false with no id: errors and is a no-op', () => {
            const c = setup<IItem>('id');
            let result: unknown = 'unset';
            act(() => {
                result = c.current.editRecord({ name: 'x' }, undefined, false);
            });
            expect(result).toBeUndefined();
            expect(error).toHaveBeenCalled();
            expect(c.current.itemList).toHaveLength(0);
        });

        it('create=false on a missing id: errors and does NOT create the record', () => {
            const c = setup<IItem>('id');
            let result: unknown = 'unset';
            act(() => {
                result = c.current.editRecord({ name: 'x' }, 99 as never, false);
            });
            expect(result).toBeUndefined();
            expect(error).toHaveBeenCalled();
            expect(c.current.getRecord(99 as never)).toBeUndefined();
        });
    });

    describe('editRecords (batch)', () => {
        it('records only the NEWLY inserted ids in lastInsertedIdentifiers', () => {
            const c = setup<IItem>('id');
            act(() => {
                c.current.addRecord({ id: 1, name: 'existing' });
            });

            // 1 already exists (update), 2 and 3 are new
            act(() => {
                c.current.editRecords([
                    { id: 1, name: 'updated' },
                    { id: 2, name: 'two' },
                    { id: 3, name: 'three' }
                ]);
            });

            expect(c.current.lastInsertedIdentifiers).toEqual([2, 3]);
            expect(c.current.lastInsertedIdentifier).toBe(3); // singular tracks the last NEW id
            expect(c.current.getRecord(1 as never)?.name).toBe('updated');
            expect(c.current.itemList).toHaveLength(3);
        });

        it('leaves lastInsertedIdentifier untouched when a batch inserts nothing new', () => {
            const c = setup<IItem>('id');
            act(() => {
                c.current.addRecord({ id: 1, name: 'existing' }); // sets lastInsertedIdentifier = 1
            });
            act(() => {
                c.current.editRecords([{ id: 1, name: 'updated' }]); // update only, no new id
            });
            // must NOT be clobbered to undefined by an empty-ids branch
            expect(c.current.lastInsertedIdentifier).toBe(1);
            expect(c.current.lastInsertedIdentifiers).toEqual([]);
        });

        it('skips undefined entries', () => {
            const c = setup<IItem>('id');
            act(() => {
                c.current.editRecords([{ id: 1, name: 'a' }, undefined, { id: 2, name: 'b' }]);
            });
            expect(c.current.lastInsertedIdentifiers).toEqual([1, 2]);
            expect(c.current.itemList).toHaveLength(2);
        });
    });

    describe('deleteRecord', () => {
        it('is a safe no-op for a non-existent id (no throw, dictionary unchanged)', () => {
            const c = setup<IItem>('id');
            act(() => {
                c.current.addRecord({ id: 1, name: 'a' });
            });
            expect(() => act(() => c.current.deleteRecord(99 as never))).not.toThrow();
            expect(c.current.itemList).toHaveLength(1);
        });
    });
});
