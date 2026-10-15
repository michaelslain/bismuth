// core/test/sseRefresh.test.ts
//
// End-to-end guard for the file-tree refresh chain's BACKEND half (github issue #8: "creating a
// new folder or document is not reflected in the Vault view until you restart").
//
// Triage for that issue found the backend healthy — but nothing in the suite actually asserted
// it, so a regression here would have been silent. Each case drives one of the three real ways
// content appears and asserts BOTH halves of the contract:
//   1. an SSE frame arrives marking the tree dirty, and
//   2. GET /tree actually contains the new entry afterwards.
// Asserting only (1) would pass even if the tree never rebuilt; asserting only (2) would pass
// even if the frontend was never told. The bug class needs both.
//
// SSE is read with fetch + a ReadableStream reader, matching server.test.ts — Bun has no global
// EventSource. Frames are split on "\n\n" and non-`data:` lines are skipped, because the server
// interleaves `: keepalive` comments (core/src/server.ts, every settings.server.sseHeartbeatMs).
import { test, expect } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from '../src/server'
import { initializeSettings } from '../src/settings'
import { makeSampleVault } from './helpers'

// waitForFrame's own poll runs up to 4000ms by default, on top of vault setup, server boot, and
// several HTTP round trips — leaving only a few hundred ms of headroom against Bun's 5s default
// per-test timeout (the exact flake class fixed in 46680ecb for the CLI suite). Give each test
// real margin via bun:test's third `test()` argument, matching cli/test/cli.test.ts's style.
const TEST_TIMEOUT_MS = 15_000

/** Read SSE frames until `match` accepts one, or `timeoutMs` elapses. Returns the frame. The read
 *  races the deadline, so a stream that goes quiet fails at `timeoutMs` instead of hanging until the
 *  test's own timeout, and the error lists every frame that arrived without matching. */
async function waitForFrame(
    base: string,
    match: (payload: {
        version: number
        paths: string[]
        dirty?: { graph: boolean; tree: boolean }
    }) => boolean,
    trigger: () => Promise<void> | void,
    timeoutMs = 4000,
): Promise<{
    version: number
    paths: string[]
    dirty?: { graph: boolean; tree: boolean }
}> {
    const res = await fetch(`${base}/events`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const seen: string[] = []
    const deadline = Date.now() + timeoutMs
    try {
        await trigger()
        let buf = ''
        while (true) {
            const left = deadline - Date.now()
            if (left <= 0) break
            let timer: ReturnType<typeof setTimeout> | undefined
            const next = await Promise.race([
                reader.read(),
                new Promise<'timeout'>(resolve => {
                    timer = setTimeout(() => resolve('timeout'), left)
                }),
            ]).finally(() => clearTimeout(timer))
            if (next === 'timeout' || next.done) break
            buf += decoder.decode(next.value)
            const frames = buf.split('\n\n')
            buf = frames.pop() ?? ''
            for (const f of frames) {
                if (!f.startsWith('data: ')) continue // skip `: keepalive` comments
                const payload = JSON.parse(f.slice(6))
                if (match(payload)) return payload
                seen.push(f.slice(6))
            }
        }
        throw new Error(
            `no matching SSE frame within ${timeoutMs}ms; non-matching frames: ${
                seen.length ? seen.join(' | ') : '(none)'
            }; trailing buf=${buf}`,
        )
    } finally {
        await reader.cancel().catch(() => {})
    }
}

test(
    'a new FOLDER on disk marks the tree dirty and lands in GET /tree',
    async () => {
        const { vault, memory } = await makeSampleVault()
        // A brand-new vault has no `.settings` yet, so server boot fires an async reconcileSettings()
        // that bootstraps a default one (core/src/server.ts ~line 226). Materialize it BEFORE
        // createServer so that boot-time write never happens at all — reconcileSettings then
        // finds nothing to migrate or strip and performs no write. Without this, the bootstrap
        // write could land on the same debounced watcher flush as our trigger below, and because
        // `.settings` changes unconditionally force dirty.tree=true (classifyVault's isSettingsPath
        // branch), it would make this test pass even if the real folder-creation code path were broken.
        await initializeSettings(vault)
        const server = createServer({ vault, memory, port: 0 })
        const base = `http://localhost:${server.port}`
        try {
            // Prime so the SSE response has flushed headers before we start reading.
            await fetch(`${base}/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'prime-folder.md', kind: 'file' }),
            })

            const frame = await waitForFrame(
                base,
                p => p.dirty?.tree === true,
                () => {
                    mkdirSync(join(vault, 'BrandNewFolder'))
                },
            )
            expect(frame.dirty?.tree).toBe(true)

            const tree = await (await fetch(`${base}/tree`)).text()
            expect(tree).toContain('BrandNewFolder')
        } finally {
            server.stop(true)
        }
    },
    TEST_TIMEOUT_MS,
)

test(
    'a new NOTE on disk marks the tree dirty and lands in GET /tree',
    async () => {
        const { vault, memory } = await makeSampleVault()
        // See the identical comment in the FOLDER test above: materialize `.settings` before
        // createServer so the boot-time bootstrap write never happens, removing its race with our
        // trigger outright instead of racing it.
        await initializeSettings(vault)
        const server = createServer({ vault, memory, port: 0 })
        const base = `http://localhost:${server.port}`
        try {
            await fetch(`${base}/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'prime-note.md', kind: 'file' }),
            })

            const frame = await waitForFrame(
                base,
                p => p.dirty?.tree === true,
                () => {
                    writeFileSync(
                        join(vault, 'BrandNewNote.md'),
                        '# brand new\n',
                    )
                },
            )
            expect(frame.dirty?.tree).toBe(true)

            const tree = await (await fetch(`${base}/tree`)).text()
            expect(tree).toContain('BrandNewNote')
        } finally {
            server.stop(true)
        }
    },
    TEST_TIMEOUT_MS,
)

test(
    'POST /create (the path the app itself uses) marks the tree dirty and lands in GET /tree',
    async () => {
        const { vault, memory } = await makeSampleVault()
        const server = createServer({ vault, memory, port: 0 })
        const base = `http://localhost:${server.port}`
        try {
            await fetch(`${base}/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'prime-api.md', kind: 'file' }),
            })

            const frame = await waitForFrame(
                base,
                p => p.paths.includes('ViaApi.md'),
                async () => {
                    await fetch(`${base}/create`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            path: 'ViaApi.md',
                            kind: 'file',
                        }),
                    })
                },
            )
            expect(frame.dirty?.tree).toBe(true)

            const tree = await (await fetch(`${base}/tree`)).text()
            expect(tree).toContain('ViaApi')
        } finally {
            server.stop(true)
        }
    },
    TEST_TIMEOUT_MS,
)

test(
    'a content-only edit does NOT mark the tree dirty',
    async () => {
        // The complement, and the reason this suite is not vacuous: if `dirty.tree` were hardcoded
        // true, every test above would pass while the optimisation that keeps the sidebar quiet on a
        // pure prose edit was broken. This case fails in that world.
        const { vault, memory } = await makeSampleVault()
        // Materialize `.settings` before createServer (see the FOLDER test above) so a boot-time
        // bootstrap write can never land in the same debounced batch as the create below and force
        // dirty.tree=true on the frame we go on to match.
        await initializeSettings(vault)
        const server = createServer({ vault, memory, port: 0 })
        const base = `http://localhost:${server.port}`
        try {
            await fetch(`${base}/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'EditMe.md', kind: 'file' }),
            })

            const frame = await waitForFrame(
                base,
                p => p.paths.includes('EditMe.md'),
                async () => {
                    await fetch(`${base}/file`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            path: 'EditMe.md',
                            contents:
                                '# EditMe\n\njust prose, no links or tags\n',
                        }),
                    })
                },
            )
            expect(frame.dirty?.tree).toBe(false)
        } finally {
            server.stop(true)
        }
    },
    TEST_TIMEOUT_MS,
)

test(
    'a note created while the boot task-migration scan is held is structural on its first event',
    async () => {
        // The boot scan seeds the change tracker with every note it reads. A note born AFTER the server
        // started may have its watcher event still in flight, so seeding it would make that event
        // classify as "unchanged" (dirty to neither graph nor tree) and the note would never reach the
        // sidebar. beforeTaskMigration holds the scan so the note can be written first and the scan
        // released straight after; the watcher's debounce then flushes after the scan has finished.
        const { vault, memory } = await makeSampleVault()
        await initializeSettings(vault)
        let release!: () => void
        const held = new Promise<void>(resolve => (release = resolve))
        const server = createServer({
            vault,
            memory,
            port: 0,
            beforeTaskMigration: () => held,
        })
        const base = `http://localhost:${server.port}`
        try {
            const frame = await waitForFrame(
                base,
                p => p.paths.includes('BootBorn.md'),
                async () => {
                    writeFileSync(join(vault, 'BootBorn.md'), '# born at boot\n')
                    release()
                    // The scan has seeded (or declined to seed) every note once it reports.
                    for (let i = 0; i < 200; i++) {
                        const r = await (await fetch(`${base}/tasks/migration`)).json()
                        if (r.ran !== null) return
                        await new Promise(resolve => setTimeout(resolve, 10))
                    }
                },
                8000,
            )
            expect(frame.dirty?.tree).toBe(true)
            const tree = await (await fetch(`${base}/tree`)).text()
            expect(tree).toContain('BootBorn')
        } finally {
            release()
            server.stop(true)
        }
    },
    TEST_TIMEOUT_MS,
)
