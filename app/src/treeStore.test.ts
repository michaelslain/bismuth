// app/src/treeStore.test.ts
//
// Coverage for the version-aware in-flight dedupe in treeStore.ts (Task 5). A burst of
// concurrent refreshVaultTree() calls at the SAME server version must share one `GET /tree`
// request; a call made after the version has advanced past the in-flight request's start
// version must not resolve early with data that predates what the caller now knows exists —
// it chains a fresh request after the in-flight one settles.
//
// `api.tree()` is hand-driven via `setTransport()` — the SAME seam api.test.ts's own
// "Transport seam" test uses — rather than `mock.module('./api', ...)`. `mock.module`
// replaces the ENTIRE module for the whole `bun test` process (every file that later
// resolves `./api`/`../api`, not just this one), which silently broke api.test.ts,
// bases/markdown.test.ts and editor/tableWidget.test.ts the first time this file used it —
// all of them call other `api.*` methods that a full-module mock strips. `setTransport` is
// scoped to a single shared object's ONE property (already the codebase's sanctioned way to
// hand-drive `api.*` without touching the network) and is restored in `afterEach`.
//
// `./serverVersion` IS mocked at the module level — safe here because nothing else in this
// test run imports it at runtime (only a type-only `import type { ServerChange }` elsewhere),
// so there's no other consumer for a module-wide replacement to break.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { apiBase, httpTransport, setTransport, type Transport } from './api'
import type { TreeEntry } from '../../core/src/graph'

let treeCalls = 0
type Pending = {
    resolve: (entries: TreeEntry[]) => void
    reject: (err: Error) => void
}
let pending: Pending[] = []

/** Resolve the OLDEST still-pending `api.tree()` call with `entries`. */
function resolveTree(entries: TreeEntry[]): void {
    const p = pending.shift()
    if (!p) throw new Error('resolveTree: no pending api.tree() call')
    p.resolve(entries)
}

/** Reject the OLDEST still-pending `api.tree()` call. */
function rejectTree(message = 'network error'): void {
    const p = pending.shift()
    if (!p) throw new Error('rejectTree: no pending api.tree() call')
    p.reject(new Error(message))
}

/** Settle `promise` into a plain `{ok, value}` / `{ok, error}` result — never throws and never
 *  hangs, unlike bun's `expect(...).rejects` matchers, which spin instead of failing fast when
 *  the promise being asserted on RESOLVES (exactly the case this file needs to fail cleanly on
 *  pre-fix code, where a "failed" fetch silently resolves with the last-good tree). */
function outcomeOf<T>(
    promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
    return promise.then(
        value => ({ ok: true, value }),
        error => ({ ok: false, error }),
    )
}

const originalBase = apiBase()

/** Swap in a fake Transport whose `getJson` (the only verb `api.tree()` uses) is hand-driven:
 *  counts calls and returns a promise this file resolves/rejects manually via
 *  `resolveTree`/`rejectTree`. */
function installTreeStub(): void {
    treeCalls = 0
    pending = []
    const stub: Transport = {
        getJson: <T>() =>
            new Promise<T>((resolve, reject) => {
                treeCalls++
                pending.push({
                    resolve: resolve as unknown as (entries: TreeEntry[]) => void,
                    reject,
                })
            }),
        getText: () => Promise.reject(new Error('not stubbed')),
        post: () => Promise.reject(new Error('not stubbed')),
        put: () => Promise.reject(new Error('not stubbed')),
        postJson: () => Promise.reject(new Error('not stubbed')),
        writeFileChecked: () => Promise.reject(new Error('not stubbed')),
        uploadAsset: () => Promise.reject(new Error('not stubbed')),
        convertHeic: () => Promise.reject(new Error('not stubbed')),
        stageTmpFile: () => Promise.reject(new Error('not stubbed')),
        assetUrl: (t: string) => t,
        eventsUrl: () => '',
        base: () => originalBase,
    }
    setTransport(stub)
}

afterEach(() => {
    setTransport(httpTransport(originalBase))
})

let version = 1
function setVersion(v: number): void {
    version = v
}

// `version` is module-level test state, shared across every test in this file (they all run in
// one process against one imported `treeStore` instance) — reset it before each test so a
// version bump made by an earlier test (e.g. `setVersion(2)`) can't leave a LATER test's own
// `setVersion(2)` a no-op, which silently changes what that test is actually exercising.
beforeEach(() => {
    version = 1
})

mock.module('./serverVersion', () => ({
    serverVersion: () => version,
    onServerChange: () => () => {},
}))

const { refreshVaultTree, vaultTree } = await import('./treeStore')

describe('refreshVaultTree (version-aware in-flight dedupe)', () => {
    test('concurrent refreshes at one version share one request; a newer version refetches', async () => {
        installTreeStub()
        const a = refreshVaultTree()
        const b = refreshVaultTree()
        expect(treeCalls).toBe(1)
        setVersion(2)
        const c = refreshVaultTree()
        resolveTree([{ path: 'x.md', kind: 'file' }])
        await Promise.all([a, b])
        resolveTree([{ path: 'y.md', kind: 'file' }])
        expect(await c).toEqual([{ path: 'y.md', kind: 'file' }])
        expect(treeCalls).toBe(2)
    })

    test('a settled request updates the reactive vaultTree cache', async () => {
        installTreeStub()
        const p = refreshVaultTree()
        resolveTree([{ path: 'z.md', kind: 'file' }])
        await p
        expect(vaultTree()).toEqual([{ path: 'z.md', kind: 'file' }])
    })

    test('a failing request REJECTS but leaves vaultTree() at its last-good value', async () => {
        installTreeStub()
        const good = refreshVaultTree()
        resolveTree([{ path: 'good.md', kind: 'file' }])
        await good
        expect(vaultTree()).toEqual([{ path: 'good.md', kind: 'file' }])

        const failing = refreshVaultTree()
        const outcome = outcomeOf(failing)
        rejectTree('boom')
        const result = await outcome
        expect(result.ok).toBe(false)
        expect((result as { ok: false; error: Error }).error.message).toBe('boom')
        // The cache must be untouched by the failure — still the last GOOD tree, never [].
        expect(vaultTree()).toEqual([{ path: 'good.md', kind: 'file' }])
    })

    test('after a failed request, a later call issues a fresh request and resolves', async () => {
        installTreeStub()
        const first = refreshVaultTree()
        const firstOutcome = outcomeOf(first)
        rejectTree('first fails')
        const firstResult = await firstOutcome
        expect(firstResult.ok).toBe(false) // the failed request must actually REJECT
        expect(treeCalls).toBe(1)

        const second = refreshVaultTree()
        expect(treeCalls).toBe(2) // a fresh request, not sharing the failed one
        resolveTree([{ path: 'after-fail.md', kind: 'file' }])
        expect(await second).toEqual([{ path: 'after-fail.md', kind: 'file' }])
    })

    test('a call chained after an in-flight request that then FAILS still gets its own fresh request', async () => {
        installTreeStub()
        const a = refreshVaultTree() // starts the in-flight request (version 1)
        setVersion(2)
        const b = refreshVaultTree() // version advanced past `a`'s start — chains after it
        const aOutcome = outcomeOf(a)
        rejectTree('a fails') // settle `a` by REJECTING
        const aResult = await aOutcome
        expect(aResult.ok).toBe(false)
        // `b` must not inherit `a`'s rejection — it chains a fresh request regardless of
        // how the request it chained after settled.
        resolveTree([{ path: 'chained.md', kind: 'file' }])
        expect(await b).toEqual([{ path: 'chained.md', kind: 'file' }])
        expect(treeCalls).toBe(2)
    })
})
