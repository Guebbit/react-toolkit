# Testing

This project has two layers of tests:

- **The Jest suite** (`npm test`) — the usual example-based tests. They exercise the hooks
  and stores against a small stateful in-memory REST server, asserting both the local store state
  _and_ the number of server round-trips at each step.
- **Mutation testing** (`npm run test:mutation`) — a meta-test that measures how good the Jest
  suite actually is at catching bugs.

The first tells you the code works on the cases you thought of. The second tells you whether your
tests would _notice_ if the code broke. They answer different questions, and you want both.

## Why example-based tests aren't enough

A passing test suite doesn't mean the tests are good. A test can pass for the wrong reason: it
might only check a value the code happens to produce anyway, mock away the very thing it claims to
verify, or never exercise a branch at all. A suite full of tests like that is **green but blind** —
it goes on passing even after someone breaks the code.

You can't see this by reading the coverage number either. Line coverage says a line _ran_ during
the tests; it says nothing about whether any assertion would _fail_ if that line were wrong. 100%
coverage with zero real assertions is entirely possible.

Mutation testing is how you measure the thing coverage can't: **do the tests actually catch
bugs?**

## What is a mutation?

A **mutation** is a small, deliberate change to the source code — a single edit that _should_ be a
bug. The mutation-testing tool makes thousands of these, one at a time, and re-runs the test suite
against each mutated copy of the code.

Each mutation is a tiny "what if this line were wrong?" experiment. Some real examples from this
codebase (all of these were tried automatically):

```ts
// src/hooks/structureRestApi.ts — original
(Array.isArray(result) ? result : [result]).filter((item): item is T => item !== undefined);

// mutated: the filter is disabled ("what if we let undefined entries through?")
(Array.isArray(result) ? result : [result]);
```

```ts
// src/hooks/structureRestApi.ts — original
counts[bucket] = Math.max((counts[bucket] ?? 0) - 1, 0); // never go negative

// mutated: the floor is removed ("what if we let the ref-count go negative?")
counts[bucket] = (counts[bucket] ?? 0) - 1;
```

Typical mutation categories:

| Category                    | Example change                                  |
| --------------------------- | ----------------------------------------------- |
| **Conditional**             | `if (cond)` → `if (true)` / `if (false)`        |
| **Equality / relational**   | `a === b` → `a !== b`, `>` → `>=`, `<` → `<=`    |
| **Logical operator**        | `a && b` → `a \|\| b`                            |
| **Arithmetic**              | `a + b` → `a - b`                                |
| **String / object literal** | `'target'` → `''`, `{ ... }` → `{}`             |
| **Optional chaining**       | `onSuccess?.()` → `onSuccess()`                  |
| **Return / block removal**  | dropping a `return` or emptying a function body  |

Each mutated copy of the code is called a **mutant**.

## Killed, survived, and what the score means

After running the suite against a mutant, there are two outcomes:

- **Killed** ✅ — at least one test _failed_. Good: the tests noticed the bug. That mutant is dead.
- **Survived** ❌ — every test still _passed_ despite the bug. Bad: this is a hole in your tests.
  Something the code does is not actually verified by any assertion.

Two special cases:

- **No coverage** — no test even ran the mutated line, so it couldn't possibly be killed. A
  survivor by omission.
- **Timeout** — the mutation sent the code into an infinite loop; counted as killed (the tests
  would clearly have caught it).

The **mutation score** is simply:

```
mutation score = killed / (total mutants)
```

A survivor is a concrete, actionable to-do: it points at an exact line and an exact change that
your tests don't defend against. You either add a test that kills it, or conclude it's an
_equivalent mutant_ (see below) and leave it.

### Equivalent mutants

Not every survivor is a real gap. Some mutations produce code that behaves _identically_ to the
original — no test can kill them because there is nothing to catch. Classic examples: flipping
`<` to `<=` on a loop bound that can never hit the boundary, or dropping an `undefined`-guard
whose value would be stripped by `JSON.stringify` anyway. These are **equivalent mutants**, and a
mutation score of 100% is usually neither achievable nor worth chasing because of them. Aim high,
then judge the remaining survivors case by case.

## What is Stryker?

[**Stryker**](https://stryker-mutator.io/) is the mutation-testing framework this project uses (the
JavaScript/TypeScript implementation, `@stryker-mutator/core`). It's the tool that does everything
described above: it parses the source, generates the mutants, runs the existing Jest suite against
each one, and reports which survived.

To keep this fast, Stryker doesn't re-run the whole suite for every mutant. With
`coverageAnalysis: "perTest"` it first records which tests touch which code, then for each mutant
runs _only_ the tests that could possibly kill it.

### Running it

```bash
npm run test:mutation
```

Configuration lives in [`stryker.conf.json`](https://stryker-mutator.io/docs/stryker-js/configuration/).
It mutates everything under `src/` (except the barrel `src/index.ts`) and drives the project's
existing `jest.config.cjs`. When it finishes it prints a per-file summary and writes a browsable
HTML report to `reports/mutation/mutation.html` — open that to see each surviving mutant inline
with the source, which is the fastest way to decide "real gap or equivalent mutant?".

> The full run mutates the whole `src/` tree and takes a few minutes. While iterating, scope it to
> one file with `npx stryker run --mutate "src/hooks/structureDataManagement.ts"`.

## A bug this actually caught

Mutation testing isn't just bookkeeping. Chasing survivors in `structureDataManagement.ts` surfaced
a real bug in `createIdentifier`: when given a **custom single identifier**, it ignored the argument
and used the instance's default identifier instead — so the type signature advertised
`string | string[]`, but only the array form worked. No existing test had ever passed a custom
single identifier, so the code was both green and wrong. The gap the mutants pointed at was the same
gap that hid the bug; writing the test that closed it is what exposed the bug.

That's the whole point: **a test that can't fail can't protect you.** Mutation testing finds the
tests that can't fail.
