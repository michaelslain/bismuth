import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    buildDaemonPersona,
    DAEMON_PERSONA_CHANNELS,
    DEFAULT_DAEMON_IDENTITY,
} from '../src/daemon/persona.ts'
import type { VaultContext } from '../src/lib/config.ts'
import { BACKEND_LIST } from '../../core/src/agentBackends/catalog.ts'

async function withIdentity(
    content: string | null,
    run: (ctx: VaultContext) => Promise<void>,
) {
    const dir = await mkdtemp(join(tmpdir(), 'persona-'))
    try {
        const identityFile = join(dir, 'identity.md')
        if (content !== null) await writeFile(identityFile, content)
        await run({ name: 'Atlas', identityFile } as unknown as VaultContext)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

test('persona uses the identity.md body under a You are <name> prefix', async () => {
    await withIdentity('---\nname: Atlas\n---\nBe terse.\n', async ctx => {
        expect(await buildDaemonPersona(ctx, [])).toBe(
            'You are Atlas.\n\nBe terse.',
        )
    })
})

test('persona falls back to the default identity when identity.md is absent or empty', async () => {
    const want = `You are Atlas.\n\n${DEFAULT_DAEMON_IDENTITY}`
    await withIdentity(null, async ctx => {
        expect(await buildDaemonPersona(ctx, [])).toBe(want)
    })
    await withIdentity('---\nname: Atlas\n---\n\n', async ctx => {
        expect(await buildDaemonPersona(ctx, [])).toBe(want)
    })
})

test('persona appends the advisory deny-list only when there are denied notes', async () => {
    await withIdentity(null, async ctx => {
        const none = await buildDaemonPersona(ctx, [])
        expect(none).not.toContain('off-limits')
        const some = await buildDaemonPersona(ctx, [
            { rel: 'secret/a.md' },
            { rel: 'b.md' },
        ] as never)
        expect(some).toContain('off-limits')
        expect(some).toContain('- secret/a.md\n- b.md')
    })
})

test('every daemon-capable catalog backend declares a persona channel', () => {
    const daemonIds = BACKEND_LIST.filter(b => b.capabilities.daemon).map(
        b => b.id,
    )
    expect(daemonIds.length).toBeGreaterThan(0)
    for (const id of daemonIds) {
        expect(DAEMON_PERSONA_CHANNELS[id]).toBeDefined()
    }
})
