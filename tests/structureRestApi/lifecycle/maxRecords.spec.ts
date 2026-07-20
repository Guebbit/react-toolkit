/**
 * LIFECYCLE — maxRecords: hard upper bound on itemDictionary size.
 *
 * A backstop against unbounded growth, not a cache policy. When an incoming batch
 * would push the dictionary past the cap, the whole client store is wiped BEFORE the
 * batch is stored — so the freshest items always survive, and no structure this
 * composable owns (e.g. parentHasMany) is left holding ids that no longer resolve.
 *
 * useStructureSearchApi owns a further id-holding structure (searchCached) on
 * top of this composable, and that one is NOT wiped by this internal cap
 * enforcement (only its own explicit resetSearches()/resetAll()/destroy() clear
 * it) — see tests/structureSearchApi/lifecycle/maxRecords.spec.ts.
 */

import { makeHook, clearAllInstances } from '../_helpers/harness';
import { apiResolve } from '../_helpers/fakeApi';
import { buildArticles, type IArticle } from '../_helpers/fixtures';

afterEach(clearAllInstances);

const make = (maxRecords: number) => makeHook<IArticle, number>({ maxRecords });

describe('LIFECYCLE · maxRecords', () => {
    it('wipes the store before a batch that would exceed the cap, keeping that batch', async () => {
        const c = make(10);
        // 8 records: under the cap, nothing is wiped
        await c.fetchAll(apiResolve(buildArticles(8, 'tech', 1)), { lastUpdateKey: 'a' });
        expect(c.itemList).toHaveLength(8);

        // 5 more would make 13 > 10 → wipe first, then store the 5
        await c.fetchAll(apiResolve(buildArticles(5, 'tech', 100)), { lastUpdateKey: 'b' });
        expect(c.itemList).toHaveLength(5);
        // the freshest batch is the one that survived
        expect(c.itemList.map((a) => a.id)).toEqual([100, 101, 102, 103, 104]);
    });

    it('never wipes when disabled (maxRecords = 0)', async () => {
        const c = make(0);
        await c.fetchAll(apiResolve(buildArticles(8, 'tech', 1)), { lastUpdateKey: 'a' });
        await c.fetchAll(apiResolve(buildArticles(8, 'tech', 100)), { lastUpdateKey: 'b' });
        expect(c.itemList).toHaveLength(16);
    });

    it('defaults to 100k', () => {
        expect(makeHook<IArticle, number>().maxRecords).toBe(100_000);
    });
});
