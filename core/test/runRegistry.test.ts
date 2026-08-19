import { tempDir } from './helpers'
import { test, expect, beforeEach, afterEach } from 'bun:test'
import {
    rmSync,
    writeFileSync,
    mkdirSync,
    readdirSync,
    statSync,
    readFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
    writeRunRecord,
    readRunRecords,
    deleteRunRecord,
    resolveRunRegistryBase,
    runKey,
    runRecordPath,
} from '../src/runRegistry'

// A pid that's essentially guaranteed to be free (mirrors core/test/daemon.test.ts's convention).
const DEAD_PID = 2147483646

let dir: string
beforeEach(() => {
    dir = tempDir('bismuth-run-')
    process.env.BISMUTH_RUN_DIR = dir
})
afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.BISMUTH_RUN_DIR
})

// readRunRecords now filters dead pids (see the liveness-filter tests below), so every test of the
// write/read/resolve MECHANICS (independent of that filter) uses this test process's own pid — the
// one pid guaranteed alive for the test's duration — rather than an arbitrary small int.
const PID = process.pid

test('write then read a record', () => {
    writeRunRecord({ port: 4322, vault: '/v/one', pid: PID })
    const recs = readRunRecords()
    expect(recs).toHaveLength(1)
    expect(recs[0]).toEqual({ port: 4322, vault: '/v/one', pid: PID })
})

test("a record's optional token round-trips through write + read (ownerToken.ts's X-Bismuth-Token)", () => {
    writeRunRecord({ port: 4322, vault: '/v/one', pid: PID, token: 'abc123' })
    const recs = readRunRecords()
    expect(recs).toHaveLength(1)
    expect(recs[0]).toEqual({
        port: 4322,
        vault: '/v/one',
        pid: PID,
        token: 'abc123',
    })
})

test('runRecordPath names the exact file writeRunRecord creates, written 0600 (it now carries a secret)', () => {
    writeRunRecord({ port: 4322, vault: '/v/one', pid: PID, token: 'abc123' })
    const file = runRecordPath('/v/one')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8')).token).toBe('abc123')
})

test('re-writing the same vault overwrites its record (stable filename)', () => {
    writeRunRecord({ port: 1, vault: '/v/one', pid: PID })
    writeRunRecord({ port: 2, vault: '/v/one', pid: PID })
    const recs = readRunRecords()
    expect(recs).toHaveLength(1)
    expect(recs[0].port).toBe(2)
    expect(runKey('/v/one')).toBe(Buffer.from('/v/one').toString('base64url'))
})

test('resolveRunRegistryBase: by vault, single-match, ambiguous', () => {
    expect(resolveRunRegistryBase()).toBeUndefined() // none
    writeRunRecord({ port: 4322, vault: '/v/one', pid: PID })
    expect(resolveRunRegistryBase()).toBe('http://localhost:4322') // single → that one
    expect(resolveRunRegistryBase('/v/one')).toBe('http://localhost:4322')
    expect(resolveRunRegistryBase('/v/missing')).toBeUndefined()
    writeRunRecord({ port: 4323, vault: '/v/two', pid: PID })
    expect(resolveRunRegistryBase()).toBeUndefined() // ambiguous, no vault
    expect(resolveRunRegistryBase('/v/two')).toBe('http://localhost:4323') // exact still resolves
})

test('delete removes a record', () => {
    writeRunRecord({ port: 1, vault: '/v/one', pid: PID })
    deleteRunRecord('/v/one')
    expect(readRunRecords()).toHaveLength(0)
})

test('missing dir + malformed files are tolerated (never throws)', () => {
    delete process.env.BISMUTH_RUN_DIR
    process.env.BISMUTH_RUN_DIR = join(dir, 'does-not-exist')
    expect(readRunRecords()).toEqual([])
})

test('a zero-record dir reads as an empty list without throwing', () => {
    expect(readRunRecords()).toEqual([])
})

test('a malformed JSON file is skipped without throwing, and a truly empty registry still works', () => {
    writeFileSync(join(dir, 'broken.json'), 'not json{{{')
    expect(() => readRunRecords()).not.toThrow()
    expect(readRunRecords()).toEqual([])
})

test('readRunRecords filters a dead-pid record and prunes it from disk', () => {
    writeRunRecord({ port: 4322, vault: '/v/one', pid: DEAD_PID })
    expect(readRunRecords()).toEqual([])
    // Pruned opportunistically — the file is gone, not just filtered from the return value.
    expect(readdirSync(dir).filter(n => n.endsWith('.json'))).toEqual([])
})

test('readRunRecords keeps a record with a live pid', () => {
    writeRunRecord({ port: 4322, vault: '/v/one', pid: process.pid })
    const recs = readRunRecords()
    expect(recs).toHaveLength(1)
    expect(recs[0]).toEqual({ port: 4322, vault: '/v/one', pid: process.pid })
})

// LIVENESS IS THE ONLY LICENCE TO DELETE. A temp-dir vault is not evidence the core is dead —
// verification servers, sandbox/preview cores and `bun run dev` against a scratch vault all run
// there. Deleting a LIVE core's record makes it permanently undiscoverable, so `bismuth app …`
// falls through to :4321 and drives the WRONG window, with nothing left on disk to recover from.
test("a LIVE pid's record survives even on a temp path — and is still returned", () => {
    const tempVault = tempDir('bismuth-vault-')
    try {
        writeRunRecord({ port: 4322, vault: tempVault, pid: process.pid }) // alive, temp-dir vault
        expect(readRunRecords()).toEqual([
            { port: 4322, vault: tempVault, pid: process.pid },
        ])
        // The file is STILL THERE — a second reader (a later CLI call) must find it too.
        expect(readdirSync(dir).filter(n => n.endsWith('.json'))).toHaveLength(
            1,
        )
        expect(readRunRecords()).toHaveLength(1)
    } finally {
        rmSync(tempVault, { recursive: true, force: true })
    }
})

test('a live temp-path core is reachable by exact vault — positive identification beats the path shape', () => {
    const tempVault = tempDir('bismuth-vault-')
    try {
        writeRunRecord({ port: 4399, vault: tempVault, pid: process.pid })
        expect(resolveRunRegistryBase(tempVault)).toBe('http://localhost:4399')
    } finally {
        rmSync(tempVault, { recursive: true, force: true })
    }
})

test("a DEAD pid's record on a temp path is still pruned — liveness, not the path, decides", () => {
    const tempVault = tempDir('bismuth-vault-')
    try {
        writeRunRecord({ port: 4322, vault: tempVault, pid: DEAD_PID })
        expect(readRunRecords()).toEqual([])
        expect(readdirSync(dir).filter(n => n.endsWith('.json'))).toEqual([])
    } finally {
        rmSync(tempVault, { recursive: true, force: true })
    }
})

test('the no-vault guess prefers a persistent vault over a live sandbox core', () => {
    const tempVault = tempDir('bismuth-vault-')
    try {
        writeRunRecord({ port: 4322, vault: tempVault, pid: process.pid })
        // A lone sandbox core IS the answer when it's all that's running.
        expect(resolveRunRegistryBase()).toBe('http://localhost:4322')
        // Add the user's real vault: the bare `bismuth app …` guess must land on THAT, not the sandbox.
        writeRunRecord({ port: 4321, vault: '/v/real', pid: process.pid })
        expect(resolveRunRegistryBase()).toBe('http://localhost:4321')
        // …while the sandbox stays addressable by name, and on disk.
        expect(resolveRunRegistryBase(tempVault)).toBe('http://localhost:4322')
        expect(readdirSync(dir).filter(n => n.endsWith('.json'))).toHaveLength(
            2,
        )
    } finally {
        rmSync(tempVault, { recursive: true, force: true })
    }
})

test('two live persistent cores stay ambiguous with no vault named', () => {
    writeRunRecord({ port: 1, vault: '/v/one', pid: process.pid })
    writeRunRecord({ port: 2, vault: '/v/two', pid: process.pid })
    expect(resolveRunRegistryBase()).toBeUndefined()
})

// The cap used to bound the wrong operation: readdir+read+JSON.parse runs over EVERY record (the
// multi-second part) while only 200 unlinks were allowed per call, so a 33k backlog needed ~165
// calls that EACH paid the full stall. One pass must drain it.
test('a large dead backlog drains completely in ONE readRunRecords call', () => {
    for (let i = 0; i < 1200; i++) {
        writeFileSync(
            join(dir, `dead-${i}.json`),
            JSON.stringify({
                port: 5000 + i,
                vault: `/v/dead-${i}`,
                pid: DEAD_PID,
            }),
        )
    }
    writeRunRecord({ port: 4321, vault: '/v/alive', pid: process.pid })
    expect(readRunRecords()).toEqual([
        { port: 4321, vault: '/v/alive', pid: process.pid },
    ])
    // Every dead record is gone after a SINGLE call — only the live one is left on disk.
    expect(readdirSync(dir).filter(n => n.endsWith('.json'))).toHaveLength(1)
})

test('readRunRecords keeps a live-pid, real-path record alongside pruning a dead one', () => {
    writeRunRecord({ port: 1, vault: '/v/dead', pid: DEAD_PID })
    writeRunRecord({ port: 2, vault: '/v/alive', pid: process.pid })
    const recs = readRunRecords()
    expect(recs).toEqual([{ port: 2, vault: '/v/alive', pid: process.pid }])
})

test('a malformed-shape record (wrong field types) is skipped without being pruned from disk', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
        join(dir, 'weird.json'),
        JSON.stringify({ port: 'not-a-number', vault: 123 }),
    )
    expect(readRunRecords()).toEqual([])
    // Conservative: an unrecognized shape is left alone rather than deleted.
    expect(readdirSync(dir).filter(n => n.endsWith('.json'))).toContain(
        'weird.json',
    )
})
