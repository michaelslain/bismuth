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
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { apiBase, httpTransport, setTransport, type Transport } from './api'
import type { TreeEntry } from '../../core/src/graph'

let treeCalls = 0
let resolvers: Array<(entries: TreeEntry[]) => void> = []

/** Resolve the OLDEST still-pending `api.tree()` call with `entries`. */
function resolveTree(entries: TreeEntry[]): void {
    const resolve = resolvers.shift()
    if (!resolve) throw new Error('resolveTree: no pending api.tree() call')
    resolve(entries)
}

const originalBase = apiBase()

/** Swap in a fake Transport whose `getJson` (the only verb `api.tree()` uses) is hand-driven:
 *  counts calls and returns a promise this file resolves manually via `resolveTree`. */
function installTreeStub(): void {
    treeCalls = 0
    resolvers = []
    const stub: Transport = {
        getJson: <T>() =>
            new Promise<T>(resolve => {
                treeCalls++
                resolvers.push(resolve as unknown as (entries: TreeEntry[]) => void)
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
})
