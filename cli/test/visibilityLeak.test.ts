import { test as bunTest, expect, describe } from 'bun:test'
import { parseBaseFile } from '../../core/src/bases/parse'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildDenyPaths } from '../../core/src/visibility'
import { gateCliArgs } from '../../core/src/visibilityCliGate'
import {
    TOKENS,
    makeLeakVault,
    runCli,
    expectVisibleFor,
    expectNamesHiddenFrom,
} from './visibilityLeak'

// This file proves the FIXTURE itself works — every note the leak tests assert against exists, is
// restricted the way its name says, and the runner reaches the CLI the way an agent does. The
// per-command leak tests live beside each command's own tests.
const SPAWN_TIMEOUT_MS = 30_000
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, SPAWN_TIMEOUT_MS)

describe('makeLeakVault', () => {
    test('the deny list per channel is exactly the restricted notes', async () => {
        const { vault } = makeLeakVault()
        const rels = async (channel: 'chat' | 'daemon') =>
            (await buildDenyPaths(vault, channel)).map(e => e.rel).sort()
        expect(await rels('daemon')).toEqual([
            'Private/Cal Secret.md',
            'Private/secret.md',
            'Vault Hidden/inner.md',
            'chatty.md',
            'templates/Secret Tpl.md',
        ])
        // chat sees chat-only notes, so the same list minus chatty.
        expect(await rels('chat')).toEqual([
            'Private/Cal Secret.md',
            'Private/secret.md',
            'Vault Hidden/inner.md',
            'templates/Secret Tpl.md',
        ])
    })

    test('both calendar bases parse as calendar bases with one event each', () => {
        const { vault } = makeLeakVault()
        for (const path of ['Cal.md', 'Private/Cal Secret.md']) {
            const base = parseBaseFile(readFileSync(join(vault, path), 'utf8'), {
                name: path,
                path,
            })
            expect(base.config.view.type).toBe('calendar')
            expect(base.rows).toHaveLength(1)
        }
    })

    test('every restricted note carries its own token and the open note carries OPENTOKEN', () => {
        const { vault } = makeLeakVault()
        const has = (p: string, t: string) =>
            readFileSync(join(vault, p), 'utf8').includes(t)
        expect(has('open.md', TOKENS.open)).toBe(true)
        expect(has('Private/secret.md', TOKENS.secret)).toBe(true)
        expect(has('chatty.md', TOKENS.chatty)).toBe(true)
        expect(has('Vault Hidden/inner.md', TOKENS.folder)).toBe(true)
    })
})

describe('runCli + the path-scoped gate', () => {
    test('the owner reading a hidden note sees SECRETTOKEN', async () => {
        makeLeakVault()
        const r = await runCli(['read', 'Private/secret.md'], {
            channel: 'owner',
        })
        expect(r.code).toBe(0)
        expect(r.stdout).toContain(TOKENS.secret)
    })

    test('daemon via cli is refused on that read, with no token and no body on stdout', async () => {
        makeLeakVault()
        const r = await runCli(['read', 'Private/secret.md'], {
            channel: 'daemon',
            via: 'cli',
        })
        expect(r.code).not.toBe(0)
        expect(r.stdout).not.toContain(TOKENS.secret)
        expect(r.stderr).toContain('Refused')
    })

    test('daemon via mcp is refused on that read through the spawned CLI (only BISMUTH_MCP_CHANNEL set)', async () => {
        makeLeakVault()
        const r = await runCli(['read', 'Private/secret.md'], {
            channel: 'daemon',
            via: 'mcp',
        })
        expect(r.code).not.toBe(0)
        expect(r.stdout).not.toContain(TOKENS.secret)
        expect(r.stderr).toContain('Refused')
    })

    test('daemon via mcp is refused at the MCP chokepoint (gateCliArgs) too', async () => {
        const { vault } = makeLeakVault()
        const d = await gateCliArgs(['read', 'Private/secret.md'], {
            BISMUTH_VAULT: vault,
            BISMUTH_MCP_CHANNEL: 'daemon',
        })
        expect(d.allowed).toBe(false)
    })

    test('--vault in args wins over the fixture default', async () => {
        const { vault } = makeLeakVault()
        makeLeakVault() // a second vault becomes the default
        const r = await runCli(['read', 'open.md', '--vault', vault], {
            channel: 'owner',
        })
        expect(r.code).toBe(0)
        expect(r.stdout).toContain(TOKENS.open)
    })
})

describe('expectVisibleFor', () => {
    const all = Object.values(TOKENS).join(' ')
    test('passes the right text per channel', () => {
        expectVisibleFor(`${all} secret chatty inner Secret Tpl Cal Secret`, 'owner')
        expectVisibleFor(`${TOKENS.open} ${TOKENS.chatty} chatty`, 'chat')
        expectVisibleFor(`${TOKENS.open}`, 'daemon')
    })
    test('fails on a leaked token, a missing token, and a leaked name', () => {
        expect(() => expectVisibleFor(all, 'daemon')).toThrow()
        expect(() => expectVisibleFor(`${TOKENS.open}`, 'owner')).toThrow()
        expect(() => expectVisibleFor(`${TOKENS.open} x`, 'chat')).toThrow()
        expect(() =>
            expectVisibleFor(`${TOKENS.open} Private/secret.md`, 'daemon'),
        ).toThrow()
        expect(() =>
            expectVisibleFor(`${TOKENS.open} chatty.md`, 'daemon'),
        ).toThrow()
    })
    test('a rows-shaped blob for open.md carrying its own link text is not a leak', () => {
        const row = `{"file.path":"open.md","file.links":["secret","chatty"],"links":["secret","chatty"],"body":"${TOKENS.open}"}`
        expectVisibleFor(row, 'daemon')
        expectVisibleFor(`${row} ${TOKENS.chatty}`, 'chat')
        expect(() =>
            expectVisibleFor(`${row} {"file.path":"chatty.md"}`, 'daemon'),
        ).toThrow()
    })
    test('link text inside the visible note is not a leak', () => {
        expectVisibleFor(`${TOKENS.open} links [[secret]] [[chatty]]`, 'daemon')
        expect(() => expectNamesHiddenFrom('Secret Tpl', 'chat')).toThrow()
    })
})
