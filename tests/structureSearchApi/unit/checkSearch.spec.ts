/**
 * UNIT — checkSearch: pre-flight freshness check for fetchSearch.
 *   - cold cache → false (nothing cached yet)
 *   - after a matching fetchSearch call → true (would be served from cache)
 *   - a different page of the same search is a different bucket
 *
 * (The TTL boundary itself lives in tests/structureSearchApi/ttl/ttl.check.spec.ts.)
 */

import { makeSearchHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../../structureRestApi/_helpers/fakeApi';
import { type IUser } from '../../structureRestApi/_helpers/fixtures';

afterEach(clearAllInstances);

const make = () => makeSearchHook<IUser, number>();

describe('UNIT · checkSearch', () => {
    it('false on a cold cache, true after fetchSearch for the same filters/page/pageSize', async () => {
        const { searchApi } = make();
        const filters = { role: 'admin' };
        expect(searchApi.checkSearch(filters, 1, 10)).toBe(false);
        await searchApi.fetchSearch(
            apiResolve([{ id: 1, name: 'Alice' } as IUser]),
            filters,
            1,
            10
        );
        expect(searchApi.checkSearch(filters, 1, 10)).toBe(true);
        // a different page of the same search is a different bucket
        expect(searchApi.checkSearch(filters, 2, 10)).toBe(false);
    });
});
