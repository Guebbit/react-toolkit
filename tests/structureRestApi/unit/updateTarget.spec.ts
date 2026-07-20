/**
 * UNIT — updateTarget: direct contract of the optimistic update.
 *   - applies the change and (by default) confirms it with the server response
 *   - resolves with the raw API response
 *   - rolls back to the previous record on error, INCLUDING fields it added
 *
 * (merge / fetchAgain / fetchLike variants live in modifiers/merge.spec.ts and
 * intention/crud-lifecycle.spec.ts.)
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve, apiReject } from '../_helpers/fakeApi';
import { USERS, type IUser } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeHook<IUser, number>();

async function seedAlice(c: ReturnType<typeof make>) {
    await c.fetchAll(apiResolve([...USERS]));
}

describe('UNIT · updateTarget', () => {
    it('applies the update and confirms it', async () => {
        const c = make();
        await seedAlice(c);
        const updated: IUser = { id: 1, name: 'Alice Updated', email: 'new@example.com' };
        await c.updateTarget(apiResolve(updated), { name: 'Alice Updated' }, 1);
        expect(c.getRecord(1)?.name).toBe('Alice Updated');
    });

    it('resolves with the raw API response', async () => {
        const c = make();
        await seedAlice(c);
        const response: IUser = { id: 1, name: 'Alice Server', email: 'alice@example.com' };
        await expect(c.updateTarget(apiResolve(response), { name: 'x' }, 1)).resolves.toEqual(
            response
        );
    });

    it('rolls back to the previous record on error', async () => {
        const c = make();
        await seedAlice(c);
        await expect(c.updateTarget(apiReject(), { name: 'Broken' }, 1)).rejects.toThrow();
        expect(c.getRecord(1)).toEqual(USERS[0]);
    });

    it('rolls back fields the optimistic update ADDED, not just the ones it changed', async () => {
        const c = make();
        const original: IUser = { id: 1, name: 'Alice', email: 'a@x.com' };
        await c.fetchTarget(apiResolve(original), 1);

        // optimistic patch introduces a NEW field, then the server rejects
        await expect(
            c.updateTarget(apiReject(), { draft: true } as unknown as Partial<IUser>, 1)
        ).rejects.toThrow();

        // a merge-based rollback would leave `draft` behind: the restore must be a
        // full replace of the snapshot, not a merge over the mutated record
        expect(c.getRecord(1)).not.toHaveProperty('draft');
        expect(c.getRecord(1)).toEqual(original);
    });
});
