import { test, expect } from 'bun:test'
import { stringify } from 'yaml'
import { createServer } from '../src/server'
import { DEFAULTS } from '../src/schema/settingsSchema'
import { makeVault, tempDir } from './helpers'

process.env.BISMUTH_DAEMON_DIR = tempDir('bismuth-setboot-machine-')
process.env.BISMUTH_RUN_DIR = tempDir('bismuth-setboot-run-')
process.env.BISMUTH_GCAL_DIR = tempDir('bismuth-setboot-gcal-')

// A pre-sparse vault: the whole schema materialized at its defaults. Reconcile strips it, but it
// runs async at boot — a GET /settings that serialized the file first folded every default-valued
// legacy key (editorFontSize, uiFont, ...) into `appearance.tokens`, pinning them over the theme.
test('the first GET /settings waits for the boot reconcile, so a legacy dump pins no tokens', async () => {
    const vault = makeVault({ '.settings': stringify(DEFAULTS) }, 'bismuth-setboot-')
    process.env.BISMUTH_NO_TASK_MIGRATE = '1'
    let server: ReturnType<typeof createServer>
    try {
        server = createServer({ vault, port: 0 })
    } finally {
        delete process.env.BISMUTH_NO_TASK_MIGRATE
    }
    try {
        // in-process, in the same tick as boot: the reconcile cannot have finished yet
        const res = await server.fetch(
            new Request(`http://localhost:${server.port}/settings`),
        )
        const body = (await res.json()) as any
        expect(body.appearance.tokens).toEqual({})
    } finally {
        server.stop(true)
    }
})
