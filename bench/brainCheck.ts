/**
 * bench/brainCheck.ts — end-to-end check of the vault brain against a real or generated vault.
 *
 *   bun bench/brainCheck.ts --vault <dir> [--json]
 *
 * Read-only: the vault's markdown, bases, settings and `.daemon/memory/*.md` are copied into a temp
 * dir and every check runs against the copy, which is deleted at the end. No LLM session runs.
 * Prints one PASS/FAIL line per check; exit 0 only when every check passes.
 */
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { brainHealth, formatBrainHealth, isMemoryNoteVisibleToDaemon, loadAllNotes } from '../memory/src/index'
import { composeBrain, invalidateBrain } from '../core/src/brain'
import { createRecallService } from '../core/src/memoryRecall'
import { buildVaultMap, formatVaultMap } from '../core/src/vaultMap'
import { buildDenyPaths } from '../core/src/visibility'
import { applyBrainReport, resolveBrainReport } from '../daemon/src/daemon/brainReport'
import { buildCronPrompt, loadCronJobs } from '../daemon/src/daemon/cron'
import { DEFAULT_CRONS } from '../daemon/src/daemon/defaultCrons'
import { CHANGED_SINCE_PLACEHOLDER, applyIncrementalPlaceholder } from '../daemon/src/daemon/incrementalCron'
import { resolveTier } from '../daemon/src/daemon/tier'
import { vaultPaths } from '../daemon/src/lib/config'
import { arg, has } from './args'

type Result = { id: number; name: string; ok: boolean; detail: string }
const results: Result[] = []
const check = (id: number, name: string, ok: boolean, detail: string) => results.push({ id, name, ok, detail })

const KEEP = (name: string) =>
    name.endsWith('.md') ||
    name.endsWith('.base.jsonl') ||
    name === '.settings' ||
    name === 'settings.yaml' ||
    name === 'settings.yml'

/** Copy the notes, bases, settings and daemon memory notes; nothing else (no .git, no binaries). */
async function copyVault(src: string, dest: string): Promise<number> {
    let copied = 0
    const walk = async (dir: string, inMemory: boolean): Promise<void> => {
        for (const e of await readdir(dir, { withFileTypes: true })) {
            const abs = join(dir, e.name)
            const rel = relative(src, abs)
            if (e.isDirectory()) {
                if (e.name === 'node_modules') continue
                const isDaemon = rel === '.daemon'
                const isMemory = rel === join('.daemon', 'memory')
                if (e.name.startsWith('.') && !isDaemon && !isMemory) continue
                if (rel.startsWith('.daemon') && !isDaemon && !isMemory && !inMemory) continue
                await walk(abs, inMemory || isMemory)
            } else if (e.isFile() && KEEP(e.name)) {
                if (rel.startsWith('.daemon') && !inMemory) continue
                await mkdir(join(dest, rel, '..'), { recursive: true })
                await cp(abs, join(dest, rel))
                copied++
            }
        }
    }
    await walk(src, false)
    return copied
}

async function topFoldersWithNotes(root: string): Promise<string[]> {
    const out: string[] = []
    const hasNotes = async (dir: string): Promise<boolean> => {
        for (const e of await readdir(dir, { withFileTypes: true })) {
            if (e.name.startsWith('.')) continue
            if (e.isFile() && e.name.endsWith('.md')) return true
            if (e.isDirectory() && (await hasNotes(join(dir, e.name)))) return true
        }
        return false
    }
    for (const e of await readdir(root, { withFileTypes: true }))
        if (e.isDirectory() && !e.name.startsWith('.') && (await hasNotes(join(root, e.name)))) out.push(e.name)
    return out.sort()
}

async function main(): Promise<void> {
    const vaultArg = arg('vault')
    if (!vaultArg) {
        console.error('usage: bun bench/brainCheck.ts --vault <dir> [--json]')
        process.exit(2)
    }
    if (!(await stat(vaultArg).catch(() => null))?.isDirectory()) {
        console.error(`not a directory: ${vaultArg}`)
        process.exit(2)
    }
    const tmp = await mkdtemp(join(tmpdir(), 'brain-check-'))
    const vault = join(tmp, 'vault')
    await mkdir(vault, { recursive: true })
    const memoryDir = join(vault, '.daemon', 'memory')
    try {
        const copied = await copyVault(vaultArg, vault)
        await mkdir(memoryDir, { recursive: true })
        const notes = await loadAllNotes(memoryDir)
        const visibleNotes = notes.filter(isMemoryNoteVisibleToDaemon)
        const hasProfile = visibleNotes.some(n => n.name === 'user-profile')
        const header = `copied ${copied} files; ${notes.length} memory notes${hasProfile ? ' (user-profile present)' : ''}`

        // 1. vault map
        const denyDaemon = await buildDenyPaths(vault, 'daemon')
        let t = performance.now()
        const map = await buildVaultMap(vault, { deny: denyDaemon })
        const mapMs = performance.now() - t
        const mapText = formatVaultMap(map, 3000)
        const folders = await topFoldersWithNotes(vault)
        const notNamed = folders.filter(f => !mapText.includes(f))
        check(
            1,
            'vault map: cold build < 3000 ms, format <= 3000 chars, names every top-level folder with notes',
            mapMs < 3000 && mapText.length <= 3000 && notNamed.length === 0,
            `${map.notes} notes, ${mapMs.toFixed(0)} ms, ${mapText.length} chars, ${folders.length} folders` +
                (notNamed.length ? `, not named: ${notNamed.join(', ')}` : ''),
        )

        // 2. composeBrain per channel
        for (const channel of ['chat', 'daemon'] as const) {
            invalidateBrain(vault)
            t = performance.now()
            const cold = await composeBrain({ vaultDir: vault, memoryDir, channel, waitMs: 10_000 })
            const coldMs = performance.now() - t
            t = performance.now()
            const warm = await composeBrain({ vaultDir: vault, memoryDir, channel })
            const warmMs = performance.now() - t
            const deny = await buildDenyPaths(vault, channel)
            const text = cold ?? ''
            const needs = ['# Vault map', '# Memory index', ...(hasProfile ? ['# Who you are working with'] : [])]
            const absent = needs.filter(h => !text.includes(h))
            const leaked = deny.filter(d => text.includes(d.rel) || text.includes(d.abs)).map(d => d.rel)
            check(
                2,
                `composeBrain(${channel}): <= 9500 chars, sections present, warm < 50 ms, no denied path`,
                cold !== null && text.length <= 9500 && absent.length === 0 && warmMs < 50 && warm === cold && leaked.length === 0,
                `${text.length} chars, cold ${coldMs.toFixed(0)} ms, warm ${warmMs.toFixed(1)} ms, ${deny.length} denied paths` +
                    (cold === null ? ', returned null' : '') +
                    (absent.length ? `, missing: ${absent.join(' | ')}` : '') +
                    (warm !== cold ? ', warm call differs from cold' : '') +
                    (leaked.length ? `, LEAKED: ${leaked.slice(0, 5).join(', ')}` : ''),
            )
        }

        // 3. recall session-start == chat brain
        invalidateBrain(vault)
        const chatBrain = await composeBrain({ vaultDir: vault, memoryDir, channel: 'chat', waitMs: 10_000 })
        const svc = createRecallService({
            memoryDir: () => memoryDir,
            settings: () => ({ enabled: true, midTurn: false, semantic: false }),
            embedder: () => null,
            vault,
        })
        const rec = await svc.recall({ mode: 'session-start', sessionId: 'brain-check' })
        check(
            3,
            'recall session-start context equals the chat brain block',
            chatBrain !== null && rec.context === chatBrain,
            rec.context === null ? `context null (${rec.reason ?? 'no reason'})` : `${rec.context.length} chars vs ${chatBrain?.length ?? 'null'}`,
        )

        // 4. brain health
        const vaultNames = new Set<string>()
        const walkNames = async (dir: string): Promise<void> => {
            for (const e of await readdir(dir, { withFileTypes: true })) {
                if (e.name.startsWith('.')) continue
                if (e.isDirectory()) await walkNames(join(dir, e.name))
                else if (e.name.endsWith('.md')) vaultNames.add(e.name.slice(0, -3))
            }
        }
        await walkNames(vault)
        const health = brainHealth(notes, { vaultNames })
        const healthText = formatBrainHealth(health, 3000)
        check(
            4,
            'brainHealth: >= 1 item, formatBrainHealth <= 3000 chars',
            health.items.length >= 1 && healthText.length <= 3000,
            `${health.items.length} items (${[...new Set(health.items.map(i => i.kind))].join(', ') || 'none'}), ${healthText.length} chars`,
        )

        // 5. stock dream prompt, both placeholders resolved
        const cronsDir = join(tmp, 'crons')
        await mkdir(cronsDir, { recursive: true })
        const dream = DEFAULT_CRONS.find(c => c.name === 'dream')
        if (!dream) check(5, 'stock dream prompt has no unresolved placeholders', false, 'no stock dream cron')
        else {
            await writeFile(join(cronsDir, 'dream.md'), dream.content)
            const ctx = { ...vaultPaths(vault), cronsDir }
            const job = (await loadCronJobs(ctx)).find(j => j.name === 'dream')
            if (!job) check(5, 'stock dream prompt has no unresolved placeholders', false, 'stock dream did not parse')
            else {
                const withReport = await applyBrainReport(ctx, job.prompt)
                const resolved = applyIncrementalPlaceholder(withReport, `Vault notes changed since 2026-01-01:\n- example.md`)
                const prompt = buildCronPrompt({ jobName: job.name, body: resolved, memoryDir, notify: job.notify })
                const left = ['{{brainReport}}', CHANGED_SINCE_PLACEHOLDER].filter(p => prompt.includes(p))
                const hadBoth = job.prompt.includes('{{brainReport}}') && job.prompt.includes(CHANGED_SINCE_PLACEHOLDER)
                const report = await resolveBrainReport(ctx)
                const unavailable = report.startsWith('brain report unavailable')
                check(
                    5,
                    'stock dream prompt has no unresolved placeholders',
                    left.length === 0 && hadBoth && !unavailable,
                    `${prompt.length} chars` +
                        (left.length ? `, unresolved: ${left.join(' ')}` : '') +
                        (hadBoth ? '' : ', stock body lacks one of the two placeholders') +
                        (unavailable ? `, ${report}` : ''),
                )
            }
        }

        // 6. tiers
        const claude = resolveTier('claude', 'balanced', {})
        const codex = resolveTier('codex', 'balanced', {})
        check(
            6,
            "resolveTier: claude balanced -> sonnet; codex balanced -> effort medium, no model",
            claude.model === 'sonnet' && codex.effort === 'medium' && codex.model === undefined,
            `claude ${JSON.stringify(claude)}, codex ${JSON.stringify(codex)}`,
        )

        // output
        const failed = results.filter(r => !r.ok).length
        if (has('json')) console.log(JSON.stringify({ vault: vaultArg, header, results, failed }, null, 2))
        else {
            console.log(`brainCheck ${vaultArg}\n${header}`)
            for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  #${r.id} ${r.name}\n      ${r.detail}`)
            console.log(`${results.length - failed}/${results.length} passed`)
        }
        process.exitCode = failed ? 1 : 0
    } finally {
        await rm(tmp, { recursive: true, force: true })
    }
}

main().catch(e => {
    console.error(e)
    process.exit(2)
})
