import { test, expect } from 'bun:test'
import { createServer } from '../src/server'
import { reconcileSettings } from '../src/settings'
import { makeVault, tempDir, waitForFsQuiet } from './helpers'
import { shouldRunSlowTests } from './slowGate'

// Gated with shouldRunSlowTests: each test here waits on the real watcher — up to ~3.7 s per test
// (waitForFsQuiet's 3 s cap, then server boot and a 500 ms settle) — which test:fast skips.
const t = shouldRunSlowTests(process.env) ? test : test.skip

// Throwaway machine dirs for createServer's boot-time side effects (daemon machine registry +
// run registry) — mirrors server.test.ts (:19-37) and server.gcal-ticker.test.ts, so this file
// can run standalone (`bun test core/test/server.bootConfig.test.ts`) without touching the real
// ~/.bismuth. BISMUTH_LAYOUT_CACHE_DIR is already redirected process-wide by the test preload
// (core/test/setup.ts); BISMUTH_GCAL_DIR only matters if the auto-sync ticker is enabled, which
// it isn't here (Task 11 gated it behind an explicit opt-in the plain servers below don't set).
process.env.BISMUTH_DAEMON_DIR = tempDir('bismuth-bootcfg-machine-')
process.env.BISMUTH_RUN_DIR = tempDir('bismuth-bootcfg-run-')
process.env.BISMUTH_GCAL_DIR = tempDir('bismuth-bootcfg-gcal-')

/** Build a throwaway vault from `files` and boot a real server on it, with the boot-time task
 *  migration disabled (BISMUTH_NO_TASK_MIGRATE is read synchronously inside createServer, so
 *  setting it only around that one call is enough — see server.test.ts:2522-2535).
 *
 *  Pre-reconciles `.settings` before createServer ever runs, and waits for the resulting write
 *  to fully drain from the filesystem's event stream. createServer's own boot-time
 *  reconcileSettings call writes `.settings` into existence for a vault that doesn't have one yet.
 *  That write IS self-write-marked now (server.ts marks `.settings` before the call, re-arms the mark
 *  when the call actually wrote, and takes it back off when it wrote nothing or threw), so its own
 *  echo no longer bumps the version. Reconciling here first still matters: the file already exists
 *  and is fully schema-filled, so createServer's call finds nothing to write and this test never
 *  depends on the mark's timing. And the `waitForFsQuiet` still matters: THIS write's own (possibly
 *  delayed) fs notification is not marked by anything, so if it arrived after createServer's watcher
 *  attaches it would be taken for an external `.settings` change and bump the version all the same. */
async function startTestServer(opts: {
    files: Record<string, string>
}): Promise<{ url: string; stop: () => void }> {
    const vault = makeVault(opts.files, 'bismuth-bootcfg-vault-')
    await reconcileSettings(vault)
    await waitForFsQuiet(vault)
    process.env.BISMUTH_NO_TASK_MIGRATE = '1'
    let server: ReturnType<typeof createServer>
    try {
        server = createServer({ vault, port: 0 })
    } finally {
        delete process.env.BISMUTH_NO_TASK_MIGRATE
    }
    return {
        url: `http://localhost:${server.port}`,
        stop: () => server.stop(true),
    }
}

t(
    'loading an unchanged config at boot does not bump the version or invalidate caches',
    async () => {
        const { url, stop } = await startTestServer({
            files: { 'a.md': '# a\n[[b]]', 'b.md': '# b' },
        })
        try {
            await fetch(`${url}/tree`)
            await Bun.sleep(500) // the async loadAppConfig of a 2-file vault settles in well under this
            const { version } = await (await fetch(`${url}/version`)).json()
            expect(version).toBe(0)
        } finally {
            stop()
        }
    },
)

t('CORS preflight is cacheable', async () => {
    const { url, stop } = await startTestServer({ files: {} })
    try {
        const res = await fetch(`${url}/tree`, { method: 'OPTIONS' })
        expect(res.headers.get('Access-Control-Max-Age')).toBe('600')
    } finally {
        stop()
    }
})
