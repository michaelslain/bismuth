import { makeVault, tempDir } from './helpers'
import { test, expect, spyOn } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from '../src/server'

// Throwaway machine dirs for the two boot writes createServer makes against a vault path: the
// daemon machine registry (registerVaultRoot) and the run registry (writeRunRecord). Neither may
// land in the real ~/.bismuth for the never-existed vaults below. Both writes are SYNCHRONOUS
// inside createServer, so these are set around the test rather than at module scope — a
// module-scope assignment here would silently override the same variables that server.test.ts
// (:19) and ownerToken.test.ts (:13) each pin to their OWN temp dir for the whole process.
const machineDir = tempDir('bismuth-gcal-tick-machine-')
const runDir = tempDir('bismuth-gcal-tick-run-')

// A throwaway ~/.bismuth/gcal holding a CONNECTED-looking account, so the auto-sync ticker gets
// past its `gcalStatus().connected` gate without the test ever reading the developer's real
// Google credentials. The token is never used: every tick below fails in the vault scan that
// precedes the first Google call, so nothing in this file can reach the network.
const gcalHome = tempDir('bismuth-gcal-tick-state-')
writeFileSync(
    join(gcalHome, 'state.json'),
    JSON.stringify({
        clientId: 'test-client',
        clientSecret: 'test-secret',
        refreshToken: 'test-refresh-token-never-used',
        account: 'nobody@example.invalid',
    }),
)

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Set env vars, returning a restore that puts each back exactly as it was (deleting the ones
 *  that were unset) — so nothing this file does outlives it. A value of `undefined` explicitly
 *  UNSETS that var for the duration (rather than leaving whatever the ambient environment had),
 *  so a test can guarantee e.g. BISMUTH_GCAL_AUTOSYNC/BISMUTH_APP_PATH are off. */
function setEnv(vars: Record<string, string | undefined>): () => void {
    const prev = Object.keys(vars).map(k => [k, process.env[k]] as const)
    for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
    }
    return () => {
        for (const [k, v] of prev) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        }
    }
}

/**
 * A vault path that can never come into existence: a child of a regular FILE, so every mkdir
 * under it fails with ENOTDIR. createServer's boot writes (settings reconcile) would otherwise
 * create a merely-missing dir, and a readable vault makes the ticker's scan succeed silently —
 * which is precisely the shape of "the assertion passed because nothing happened".
 */
function unmakeableVaultPath(tag: string): string {
    const file = join(
        tempDir('bismuth-gcal-tick-'),
        `${tag}-not-a-dir`,
    )
    writeFileSync(file, '')
    return join(file, 'vault')
}

/**
 * The auto-sync ticker belongs to the server that created it, and dies by EITHER shutdown verb
 * Bun puts on that object: `stop()` and `Symbol.dispose` (`using server = createServer(…)`).
 * Observed through the ticker's only externally visible act — the vault scan it logs when the
 * vault is unreadable — with a third, identically-built server left RUNNING as the in-test
 * control, so "the torn-down servers never ticked" cannot pass by the tick mechanism having
 * been broken or the window having been too short for any of them.
 *
 * Every acquisition sits inside the `try`, so a throw from `createServer` on these deliberately
 * hostile vault paths still restores the env and the console spy rather than leaking a 10ms tick
 * period and a swallowed `console.error` into every later test file in the process.
 */
test("a server's Google Calendar auto-sync ticker dies with the server, by stop() or dispose", async () => {
    const keptVault = unmakeableVaultPath('kept')
    const stoppedVault = unmakeableVaultPath('stopped')
    const disposedVault = unmakeableVaultPath('disposed')

    const logged: string[] = []
    let spy: ReturnType<typeof spyOn> | undefined
    let restore: (() => void) | undefined
    let kept: ReturnType<typeof createServer> | undefined

    try {
        spy = spyOn(console, 'error').mockImplementation(
            (...args: unknown[]) => {
                logged.push(args.map(a => String(a)).join(' '))
            },
        )
        restore = setEnv({
            BISMUTH_GCAL_DIR: gcalHome,
            BISMUTH_GCAL_TICK_MS: '10',
            BISMUTH_DAEMON_DIR: machineDir,
            BISMUTH_RUN_DIR: runDir,
            // The ticker no longer exists at all unless auto-sync is enabled (Task 11) — this
            // file is about the ticker's own lifecycle (dies with the server), not the gate, so
            // opt in explicitly. BISMUTH_APP_PATH stays unset: this must NOT also claim a legacy
            // manifest entry, which is a separate concern (see manifest.test.ts).
            BISMUTH_GCAL_AUTOSYNC: '1',
            BISMUTH_APP_PATH: undefined,
        })

        kept = createServer({ vault: keptVault, port: 0 })
        const stopped = createServer({ vault: stoppedVault, port: 0 })
        const disposed = createServer({ vault: disposedVault, port: 0 })
        await stopped.stop(true)
        disposed[Symbol.dispose]()

        const scans = (vault: string) =>
            logged.filter(
                m =>
                    m.includes('[gcal] auto-sync scan failed') &&
                    m.includes(vault),
            )

        // Control: the running server's ticker fires and reaches the vault scan. Without this the
        // assertions below would also hold if the ticker never ran for any reason at all.
        const deadline = Date.now() + 3_000
        while (scans(keptVault).length === 0 && Date.now() < deadline)
            await sleep(10)
        expect(scans(keptVault).length).toBeGreaterThan(0)

        // All three were built the same way at the same moment and their first tick was due at the
        // same 10ms. Give the two torn-down ones 30 further tick periods past the point where the
        // running one had already ticked.
        await sleep(300)
        expect(scans(stoppedVault)).toEqual([])
        expect(scans(disposedVault)).toEqual([])
    } finally {
        await kept?.stop(true)
        spy?.mockRestore()
        restore?.()
    }
})

/**
 * The data-safety default (Task 11): a plain dev/test/agent core — no BISMUTH_APP_PATH, no
 * BISMUTH_GCAL_AUTOSYNC opt-in — must not run the auto-sync ticker AT ALL, not even once. Proven
 * the same way as the lifecycle test above: by the ticker's only externally visible act (the
 * vault-scan log), over a window many multiples of the 10ms tick period.
 */
test('the ticker never runs at all when auto-sync is not enabled (plain dev/test core)', async () => {
    const vault = unmakeableVaultPath('autosync-off')
    const logged: string[] = []
    let spy: ReturnType<typeof spyOn> | undefined
    let restore: (() => void) | undefined
    let server: ReturnType<typeof createServer> | undefined

    try {
        spy = spyOn(console, 'error').mockImplementation(
            (...args: unknown[]) => {
                logged.push(args.map(a => String(a)).join(' '))
            },
        )
        restore = setEnv({
            BISMUTH_GCAL_DIR: gcalHome,
            BISMUTH_GCAL_TICK_MS: '10',
            BISMUTH_DAEMON_DIR: machineDir,
            BISMUTH_RUN_DIR: runDir,
            BISMUTH_GCAL_AUTOSYNC: undefined,
            BISMUTH_APP_PATH: undefined,
        })

        server = createServer({ vault, port: 0 })
        // 200ms is 20 tick periods at the 10ms rate above — many multiples of the interval a
        // running ticker would have fired on at least once.
        await sleep(200)

        expect(
            logged.filter(
                m =>
                    m.includes('[gcal] auto-sync scan failed') &&
                    m.includes(vault),
            ),
        ).toEqual([])
    } finally {
        await server?.stop(true)
        spy?.mockRestore()
        restore?.()
    }
})

// ── POST /gcal/sync is gated exactly like the ticker (final review F2) ──────────────────────────────
// A manual sync from a dev/test/agent core on a vault COPY still used the machine-wide refresh token:
// its first sync re-linked every event through the bismuthId self-heal, later ones pushed the copy's
// edits, and Phase C deleted real events the copy lacked. "It needs a human clicking a button" was false
// — `bismuth gcal sync <basePath>` reaches the route from any agent through the CLI or MCP.

/** A vault holding one calendar base with Google sync on (calendarId defaults to `primary`). */
function calendarVault(): string {
    return makeVault(
        {
            'Cal.md':
                '---\ntype: base\nviews:\n  - type: calendar\n    googleCalendarSync: true\n---\n',
        },
        'bismuth-gcal-sync-gate-',
    )
}

/**
 * Let the test's own requests to its local server through; record and refuse every other URL. A sync
 * that got past the gate is therefore seen at its first Google call (the OAuth token refresh) and never
 * reaches the network — the refusal is a 503, not `invalid_grant`, so the connected-looking state below
 * is never cleared.
 */
function guardFetch(): { outbound: string[]; restore: () => void } {
    const realFetch = globalThis.fetch
    const outbound: string[] = []
    const spy = spyOn(globalThis, 'fetch').mockImplementation(((
        input: string | URL | Request,
        init?: RequestInit,
    ) => {
        const url = input instanceof Request ? input.url : String(input)
        if (url.startsWith('http://localhost:')) return realFetch(input, init)
        outbound.push(url)
        return Promise.resolve(new Response('refused by test', { status: 503 }))
    }) as typeof fetch)
    return { outbound, restore: () => spy.mockRestore() }
}

async function postGcalSync(
    env: Record<string, string | undefined>,
): Promise<{
    status: number
    body: string
    outbound: string[]
    logs: string[]
}> {
    // Its own connected-looking gcal home, so nothing here can disturb the ticker tests' state.
    const home = tempDir('bismuth-gcal-sync-gate-state-')
    writeFileSync(
        join(home, 'state.json'),
        JSON.stringify({
            clientId: 'test-client',
            clientSecret: 'test-secret',
            refreshToken: 'test-refresh-token-never-used',
            account: 'nobody@example.invalid',
        }),
    )
    const logs: string[] = []
    let restoreEnv: (() => void) | undefined
    let logSpy: ReturnType<typeof spyOn> | undefined
    let guard: ReturnType<typeof guardFetch> | undefined
    let server: ReturnType<typeof createServer> | undefined
    try {
        logSpy = spyOn(console, 'log').mockImplementation(
            (...args: unknown[]) => {
                logs.push(args.map(a => String(a)).join(' '))
            },
        )
        restoreEnv = setEnv({
            BISMUTH_GCAL_DIR: home,
            BISMUTH_GCAL_TICK_MS: '2000000000', // never tick: only the manual route is under test
            BISMUTH_DAEMON_DIR: machineDir,
            BISMUTH_RUN_DIR: runDir,
            BISMUTH_NO_TASK_MIGRATE: '1',
            ...env,
        })
        guard = guardFetch()
        server = createServer({ vault: calendarVault(), port: 0 })
        const res = await fetch(`http://localhost:${server.port}/gcal/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ basePath: 'Cal.md' }),
        })
        return {
            status: res.status,
            body: await res.text(),
            outbound: guard.outbound,
            logs,
        }
    } finally {
        await server?.stop(true)
        guard?.restore()
        logSpy?.mockRestore()
        restoreEnv?.()
    }
}

test('POST /gcal/sync on a plain dev core is refused with 403 and never calls Google', async () => {
    const r = await postGcalSync({
        BISMUTH_GCAL_AUTOSYNC: undefined,
        BISMUTH_APP_PATH: undefined,
    })
    expect(r.status).toBe(403)
    expect(JSON.parse(r.body).error).toContain('BISMUTH_GCAL_AUTOSYNC=1')
    expect(r.outbound.filter(u => u.includes('googleapis.com'))).toEqual([])
    expect(
        r.logs.some(l =>
            l.includes(
                '[gcal] manual sync off outside the installed app (set BISMUTH_GCAL_AUTOSYNC=1 to enable)',
            ),
        ),
    ).toBe(true)
})

test('POST /gcal/sync with BISMUTH_GCAL_AUTOSYNC=1 proceeds past the gate to the Google client', async () => {
    const r = await postGcalSync({
        BISMUTH_GCAL_AUTOSYNC: '1',
        BISMUTH_APP_PATH: undefined,
    })
    expect(r.status).not.toBe(403)
    // Its first Google call is the token refresh, refused above — so the route reports that failure.
    expect(r.outbound.filter(u => u.includes('googleapis.com'))).toEqual([
        'https://oauth2.googleapis.com/token',
    ])
    expect(r.status).toBe(400)
})
