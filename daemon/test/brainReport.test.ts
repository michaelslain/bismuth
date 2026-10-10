// {{brainReport}} substitution: the mechanics only. What the report SAYS is @bismuth/memory's
// brainHealth/formatBrainHealth (faked through the deps seam), so these tests pin the placeholder handling, the
// failure line and the deny list.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildCronPrompt } from '../src/daemon/cron.ts'
import type { VaultContext } from '../src/lib/config.ts'
import {
    applyBrainReport,
    resolveBrainReport,
    BRAIN_REPORT_PLACEHOLDER,
    type BrainReportDeps,
} from '../src/daemon/brainReport.ts'

let seenNames: Set<string> | undefined
let failWith: Error | null = null
let notesLoaded = 0

const fakes: BrainReportDeps = {
    loadNotes: async () => {
        if (failWith) throw failWith
        notesLoaded++
        return []
    },
    health: (_notes, opts) => {
        seenNames = opts?.vaultNames
        return { notes: 0, bytes: 0, items: [] }
    },
    format: () => 'REPORT-BODY',
}

let root: string
let ctx: VaultContext

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bismuth-brainreport-'))
    ctx = { root, memoryDir: join(root, '.daemon', 'memory') } as unknown as VaultContext
    seenNames = undefined
    failWith = null
    notesLoaded = 0
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

test('the placeholder is {{brainReport}}', () => {
    expect(BRAIN_REPORT_PLACEHOLDER).toBe('{{brainReport}}')
})

test('a prompt with the placeholder gets the report, wherever it sits and however often it appears', async () => {
    const out = await applyBrainReport(ctx, 'a\n{{brainReport}}\nb {{brainReport}}', fakes)
    expect(out).toBe('a\nREPORT-BODY\nb REPORT-BODY')
})

test('a prompt without the placeholder is returned unchanged and loads nothing', async () => {
    const prompt = 'do the thing {{changedSinceLastRun}}'
    expect(await applyBrainReport(ctx, prompt, fakes)).toBe(prompt)
    expect(notesLoaded).toBe(0)
})

test('the report renders in the final cron prompt for a non-incremental body too', async () => {
    const body = await applyBrainReport(ctx, 'agenda: {{brainReport}}', fakes)
    const prompt = buildCronPrompt({
        jobName: 'x',
        body,
        memoryDir: ctx.memoryDir,
        notify: false,
    })
    expect(prompt).toContain('agenda: REPORT-BODY')
    expect(prompt).not.toContain('{{brainReport}}')
})

test('a failure renders one `brain report unavailable: <reason>` line instead of throwing', async () => {
    failWith = new Error('memory dir\nis unreadable')
    const out = await resolveBrainReport(ctx, fakes)
    expect(out).toBe('brain report unavailable: memory dir is unreadable')
    expect(await applyBrainReport(ctx, 'x {{brainReport}} y', fakes)).toBe(
        'x brain report unavailable: memory dir is unreadable y',
    )
})

test('vault basenames come from the vault markdown, skipping dot-dirs but keeping hidden notes resolvable', async () => {
    mkdirSync(join(root, 'sub'))
    mkdirSync(join(root, '.daemon'))
    writeFileSync(join(root, 'alpha.md'), '# a\n')
    writeFileSync(join(root, 'sub', 'beta.md'), '# b\n')
    writeFileSync(join(root, 'sub', 'image.png'), 'x')
    writeFileSync(join(root, '.daemon', 'internal.md'), '# i\n')
    writeFileSync(
        join(root, 'secret.md'),
        '---\nvisibility: hidden\n---\n\n# s\n',
    )
    await resolveBrainReport(ctx, fakes)
    expect([...seenNames!].sort()).toEqual(['alpha', 'beta', 'secret'])
})

test('the real health report names an oversized memory note end to end', async () => {
    mkdirSync(ctx.memoryDir, { recursive: true })
    const body = 'A long running log of what happened. '.repeat(120)
    writeFileSync(
        join(ctx.memoryDir, 'huge-note.md'),
        `---\ntype: fact\ntags: []\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# Huge\n${body}\n`,
    )
    const out = await resolveBrainReport(ctx)
    expect(out).toContain('oversized')
    expect(out).toContain('huge-note')
})

test('a hidden memory note never appears in the real report, and links to it are not broken', async () => {
    mkdirSync(ctx.memoryDir, { recursive: true })
    writeFileSync(
        join(ctx.memoryDir, 'secret-diary.md'),
        '---\nname: secret-diary\nvisibility: hidden\n---\n\n' + 'x'.repeat(5000) + '\n',
    )
    writeFileSync(
        join(ctx.memoryDir, 'open-note.md'),
        '---\nname: open-note\n---\n\nsee [[secret-diary]] (session 2026-01-01)\n',
    )
    const out = await resolveBrainReport(ctx)
    expect(out).not.toContain('secret-diary')
    expect(out).toContain('notes=1')
})

test('a memory note linking a daemon-denied vault note is not broken, and the denied name is never printed', async () => {
    writeFileSync(join(root, 'secret-vault-note.md'), '---\nvisibility: hidden\n---\n\n# s\n')
    mkdirSync(ctx.memoryDir, { recursive: true })
    writeFileSync(
        join(ctx.memoryDir, 'open-note.md'),
        '---\nname: open-note\n---\n\nsee [[secret-vault-note]] (session 2026-01-01)\n',
    )
    const out = await resolveBrainReport(ctx)
    expect(out).not.toContain('broken-link')
    expect(out).not.toContain('secret-vault-note')
})
