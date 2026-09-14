// core/test/server.bootViews.test.ts
//
// The boot view warm-up (end of createServer) computes the 2nd/3rd-brain view layouts once the first graph,
// tree and feeds are ready, and attaches them to the cached graph, so the first brain-mode switch is
// instant. It is speculative, so a graph invalidation cancels it while it runs. It used to share ONE
// AbortController for the life of the process: an invalidation landing BEFORE the warm-up even started
// (on a daemon-enabled vault, an early memory write) aborted that controller up front, and the warm-up
// then never ran at all, not even for the fresh graph the chain re-reads.
//
// Gated with shouldRunSlowTests: it boots a real server and waits on the watcher and the layout worker.
import { test, expect } from 'bun:test'
import { join } from 'node:path'
import { createServer } from '../src/server'
import { reconcileSettings } from '../src/settings'
import { makeVault, tempDir, waitForFsQuiet } from './helpers'
import { shouldRunSlowTests } from './slowGate'

const t = shouldRunSlowTests(process.env) ? test : test.skip

// Throwaway machine dirs for createServer's boot-time side effects, as in server.bootConfig.test.ts. The
// vault below enables the daemon, so boot runs migrateDaemonState: BISMUTH_DAEMON_DIR and an EMPTY legacy
// source keep it off the real ~/.bismuth/daemon and ~/.claude-bot (as server.test.ts does).
process.env.BISMUTH_DAEMON_DIR = tempDir('bismuth-bootviews-machine-')
process.env.BISMUTH_LEGACY_CLAUDE_BOT_DIR = join(
    tempDir('bismuth-bootviews-legacy-'),
    'no-claude-bot',
)
process.env.BISMUTH_RUN_DIR = tempDir('bismuth-bootviews-run-')
process.env.BISMUTH_GCAL_DIR = tempDir('bismuth-bootviews-gcal-')

type Graph = {
    nodes: { id: string }[]
    views?: {
        second?: { pos3d: Record<string, number[]> }
        third?: { pos3d: Record<string, number[]> }
    }
}

t(
    'a graph invalidation BEFORE the boot view warm-up starts does not stop it running for the fresh graph',
    async () => {
        // A daemon-enabled vault with a memory note, so the full graph differs from its 2nd-brain subgraph.
        // With notes only, the 2nd-brain subgraph IS the full graph: its layout is already cached, and
        // attachLayout attaches views with no warm-up at all, so the test could not see the warm-up.
        const vault = makeVault(
            {
                '.settings': 'daemon:\n  enabled: true\n',
                'a.md': '# a\n[[b]]',
                'b.md': '# b',
                '.daemon/memory/m.md': 'A memory about [[a]].\n',
            },
            'bismuth-bootviews-vault-',
        )
        // Pre-fill .settings and let the fixture's own writes drain, so nothing but the create below
        // invalidates the graph (a stray watcher echo would cancel the warm-up mid-flight, correctly).
        await reconcileSettings(vault)
        await waitForFsQuiet(vault)
        process.env.BISMUTH_NO_TASK_MIGRATE = '1'
        let server: ReturnType<typeof createServer>
        try {
            server = createServer({ vault, port: 0 })
        } finally {
            delete process.env.BISMUTH_NO_TASK_MIGRATE
        }
        const base = `http://localhost:${server.port}`
        try {
            // Invalidate at once, while the first graph build is still waiting on the layout worker —
            // before the warm-up, which starts only after that graph and the tree + feeds are built.
            const created = await fetch(`${base}/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: 'c.md', kind: 'file' }),
            })
            expect(created.status).toBe(200)

            // Nothing here requests /graph/views, so view layouts that cover `c` can only come from the
            // boot warm-up having run on the post-invalidation graph.
            let g: Graph | undefined
            const deadline = Date.now() + 10_000
            while (Date.now() < deadline) {
                g = (await (await fetch(`${base}/graph`)).json()) as Graph
                if (g.views?.second?.pos3d['c']) break
                await Bun.sleep(100)
            }
            expect(g?.nodes.map(n => n.id)).toContain('mem:m')
            expect(g?.nodes.map(n => n.id)).toContain('c')
            expect(g?.views?.second?.pos3d['c']).toBeDefined()
            expect(g?.views?.third?.pos3d['mem:m']).toBeDefined()
        } finally {
            server.stop(true)
        }
    },
    20_000, // outlasts the 10 s poll, so a failure reports the assertion rather than the test timeout
)
