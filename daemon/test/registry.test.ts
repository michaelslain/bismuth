// daemon/test/registry.test.ts
// The daemon half of the "last seen" contract.
//
// Core stamps a vault when a core boots against it (= the user opened it in the app) and retires
// anything unseen for 30 days. But the LONG-RUNNING consumer of the registry is this process: it
// iterates the list every cron tick, for vaults whose crons fire hourly and which the user may not
// open for months. Without the refresh below, "last seen" silently means "last app launch", and
// such a vault gets dropped on some other vault's next core boot — every one of its crons stopping
// forever.
//
// The stamps live in vaults-seen.json, a `{path: iso}` SIDECAR — never in vaults.json, whose
// element shape is a frozen contract with a separately-installed core/daemon pair. These tests pin
// the refresh's merge rule, its safety properties, and the fact that it never touches vaults.json.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import {
    mkdtempSync,
    rmSync,
    writeFileSync,
    readFileSync,
    existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    stampVaultsSeen,
    refreshVaultsSeen,
    resetVaultsSeenThrottle,
    VAULT_SEEN_REFRESH_MS,
} from '../src/lib/registry.ts'

const NOW = '2026-07-25T12:00:00.000Z'
const ANCIENT = '2026-01-01T00:00:00.000Z'

let dir: string
let file: string
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bismuth-vaults-'))
    file = join(dir, 'vaults-seen.json')
    resetVaultsSeenThrottle()
})
afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    resetVaultsSeenThrottle()
})

function write(seen: unknown): void {
    writeFileSync(file, JSON.stringify(seen))
}
function read(): Record<string, string> {
    return JSON.parse(readFileSync(file, 'utf-8'))
}

// ── stampVaultsSeen (pure) ────────────────────────────────────────────────────────────────────

test('stampVaultsSeen refreshes only the served roots, leaving every other stamp verbatim', () => {
    const { seen, changed } = stampVaultsSeen(
        { '/v/served': ANCIENT, '/v/other': ANCIENT },
        ['/v/served'],
        NOW,
    )
    expect(changed).toBe(true)
    expect(seen).toEqual({ '/v/served': NOW, '/v/other': ANCIENT })
})

test('stampVaultsSeen reports changed=false when every served root is already stamped now', () => {
    const { seen, changed } = stampVaultsSeen(
        { '/v/served': NOW },
        ['/v/served'],
        NOW,
    )
    expect(seen).toEqual({ '/v/served': NOW })
    expect(changed).toBe(false)
})

test('stampVaultsSeen tolerates junk: a non-object, an array, and non-string values', () => {
    expect(stampVaultsSeen(null, [], NOW)).toEqual({ seen: {}, changed: false })
    expect(stampVaultsSeen([1, 2], [], NOW)).toEqual({
        seen: {},
        changed: false,
    })
    const { seen } = stampVaultsSeen(
        { '/v/a': 42, '/v/b': '', '/v/c': ANCIENT },
        [],
        NOW,
    )
    expect(seen).toEqual({ '/v/c': ANCIENT })
})

// ── refreshVaultsSeen (IO) ────────────────────────────────────────────────────────────────────

test("refreshVaultsSeen stamps a served vault so core's TTL can never retire it out from under us", async () => {
    write({ '/v/served': ANCIENT })
    await refreshVaultsSeen(['/v/served'], { file, force: true })
    // The whole point: the stamp is now recent, so the 30-day TTL is nowhere near expiring.
    const stamp = read()['/v/served']
    expect(stamp).toBeDefined()
    expect(Date.now() - Date.parse(stamp!)).toBeLessThan(60_000)
})

test('refreshVaultsSeen is throttled — a 60s cron tick does not rewrite the file every minute', async () => {
    write({ '/v/served': ANCIENT })
    const t0 = Date.parse(NOW)
    await refreshVaultsSeen(['/v/served'], { file, now: t0 })
    expect(read()['/v/served']).toBe(NOW)

    // One minute later: inside the throttle window, so the file is untouched.
    await refreshVaultsSeen(['/v/served'], { file, now: t0 + 60_000 })
    expect(read()['/v/served']).toBe(NOW)

    // Past the window: stamped again.
    const later = t0 + VAULT_SEEN_REFRESH_MS + 1
    await refreshVaultsSeen(['/v/served'], { file, now: later })
    expect(read()['/v/served']).toBe(new Date(later).toISOString())
})

test('refreshVaultsSeen never CREATES the sidecar — core seeds it by baselining every vault', async () => {
    // If the daemon authored the first sidecar it would contain only the vaults IT serves, leaving
    // every other registered vault looking "never seen" to core's TTL. Declining keeps core's
    // absent-sidecar path (baseline everything, retire nothing) the one that runs.
    await refreshVaultsSeen(['/v/served'], { file, force: true })
    expect(existsSync(file)).toBe(false)
})

test('refreshVaultsSeen never throws, and leaves a corrupt sidecar exactly as found', async () => {
    writeFileSync(file, 'not json{{{')
    await refreshVaultsSeen(['/v/served'], { file, force: true })
    expect(readFileSync(file, 'utf-8')).toBe('not json{{{')

    // An array is not core's map either — refuse rather than replace it.
    write(['/v/served'])
    await refreshVaultsSeen(['/v/served'], { file, force: true })
    expect(readFileSync(file, 'utf-8')).toBe(JSON.stringify(['/v/served']))

    // No served vaults → nothing to say, and no write.
    write({ '/v/served': ANCIENT })
    await refreshVaultsSeen([], { file, force: true })
    expect(read()['/v/served']).toBe(ANCIENT)
})

test("refreshVaultsSeen leaves no temp file behind (temp-then-rename, like core's writer)", async () => {
    write({ '/v/served': ANCIENT })
    await refreshVaultsSeen(['/v/served'], { file, force: true })
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false)
})

// ── The frozen contract: the daemon must never touch vaults.json ──────────────────────────────

test("refreshVaultsSeen does not touch vaults.json — membership is core's alone, in its own format", async () => {
    // vaults.json is read by a core binary that may be older than this daemon by days. If the daemon
    // rewrote it, that older core (and this one) would have to agree on a format neither controls.
    // It doesn't rewrite it: the stamps go somewhere else entirely.
    const vaultsFile = join(dir, 'vaults.json')
    const original = JSON.stringify(['/v/served', '/v/other'], null, 2)
    writeFileSync(vaultsFile, original)
    write({ '/v/served': ANCIENT })
    await refreshVaultsSeen(['/v/served'], { file, force: true })
    expect(readFileSync(vaultsFile, 'utf-8')).toBe(original)
})
