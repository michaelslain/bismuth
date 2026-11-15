// `bismuth import obsidian`: copy an Obsidian vault, apply every fixed rewrite in memory, write the
// result and a conversion report beside it. The converters are pure (core/src/obsidianImport/);
// this file does all the I/O.
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fail } from './args'
import { validateBaseText } from './baseValidate'
import { setFolderIcon, setSettingInFile } from '../../core/src/settings'
import { migrateContent } from '../../core/src/taskMigrate'
import { extractTasks } from '../../core/src/taskParse'
import { findQueryFences, migrateQueryBody } from '../../core/src/bases/migrateQueries'
import { convertBases } from '../../core/src/obsidianImport/bases'
import { convertFlashcards } from '../../core/src/obsidianImport/flashcards'
import { inventory } from '../../core/src/obsidianImport/inventory'
import { rewriteLinks, unresolvedLinks } from '../../core/src/obsidianImport/links'
import { renderReport } from '../../core/src/obsidianImport/report'
import { scanUnconverted } from '../../core/src/obsidianImport/scan'
import { mapSettings } from '../../core/src/obsidianImport/settings'
import { collectVaultTags, normalizeTags } from '../../core/src/obsidianImport/tags'
import { convertTasks } from '../../core/src/obsidianImport/tasks'
import type {
    FileEdit,
    ImportContext,
    ObsidianConfig,
    ReportItem,
    ReportSection,
    VaultText,
} from '../../core/src/obsidianImport/types'

export type ImportResult = {
    out: string
    reportPath: string | null
    report: string
    counts: Record<ReportSection, number>
    validation: { ok: boolean; failures: number }
}

const SEED_ENTRIES = new Set(['.settings', '.daemon', '.git', '.DS_Store'])
const SKIP_TOP = new Set(['.obsidian', '.trash', '.git'])
const isText = (p: string) => p.endsWith('.md') || p.endsWith('.base')

/** Real path of `p`, or of its nearest existing parent plus the rest, so a not-yet-created out folder
 *  is compared by where it will really be (symlinks and letter case resolved). */
function realPathOfPlanned(p: string): string {
    const rest: string[] = []
    let cur = p
    while (!existsSync(cur)) {
        const up = dirname(cur)
        if (up === cur) break
        rest.unshift(basename(cur))
        cur = up
    }
    return join(realpathSync.native(cur), ...rest)
}

function walk(root: string, symlinks: string[], dir = ''): string[] {
    const out: string[] = []
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${e.name}` : e.name
        if (!dir && SKIP_TOP.has(e.name)) continue
        if (e.isSymbolicLink()) symlinks.push(rel)
        else if (e.isDirectory()) out.push(...walk(root, symlinks, rel))
        else if (e.isFile()) out.push(rel)
    }
    return out.sort()
}

function readJson(path: string): Record<string, unknown> | null {
    try {
        const v = JSON.parse(readFileSync(path, 'utf8'))
        return v && typeof v === 'object' && !Array.isArray(v) ? v : null
    } catch {
        return null
    }
}

function readObsidianConfig(src: string): ObsidianConfig {
    const dir = join(src, '.obsidian')
    const present = existsSync(dir)
    let plugins: string[] = []
    try {
        const v = JSON.parse(readFileSync(join(dir, 'community-plugins.json'), 'utf8'))
        if (Array.isArray(v)) plugins = v.filter((x): x is string => typeof x === 'string')
    } catch {
        /* absent or malformed: no plugins */
    }
    const pluginData: Record<string, unknown> = {}
    for (const id of plugins) {
        const d = readJson(join(dir, 'plugins', id, 'data.json'))
        if (d) pluginData[id] = d
    }
    return {
        present,
        plugins,
        app: readJson(join(dir, 'app.json')),
        dailyNotes: readJson(join(dir, 'daily-notes.json')),
        templates: readJson(join(dir, 'templates.json')),
        appearance: readJson(join(dir, 'appearance.json')),
        pluginData,
    }
}

function apply(files: VaultText, edits: FileEdit[]): void {
    for (const e of edits) {
        if (e.text === null) files.delete(e.path)
        else files.set(e.path, e.text)
    }
}

function todayLocal(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const taskCount = (files: VaultText) =>
    [...files].reduce((n, [p, t]) => n + (p.endsWith('.md') ? extractTasks(t, p).length : 0), 0)

export async function importObsidian(
    srcArg: string,
    opts: { out?: string; dryRun?: boolean; todayIso?: string } = {},
): Promise<ImportResult> {
    const src = resolve(srcArg)
    if (!existsSync(src) || !statSync(src).isDirectory())
        fail(`source folder not found: ${src}. Pass the Obsidian vault's folder, e.g. \`bismuth import obsidian ~/Documents/MyVault\``)
    const out = resolve(opts.out ?? `${src}-bismuth`)
    const rel = relative(realpathSync.native(src), realPathOfPlanned(out))
    if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)))
        fail(`output ${out} is inside the source folder. Pick a --out outside ${src}`)
    // a vault Bismuth just seeded (its own `.settings`, `.daemon`, `.git`) counts as empty
    if (existsSync(out) && readdirSync(out).some(n => !SEED_ENTRIES.has(n)))
        fail(`output folder ${out} is not empty. Pass a new or empty folder with --out <dir>, or a vault that holds only Bismuth's own .settings and .daemon`)

    const items: ReportItem[] = []
    const push = (section: ReportSection, area: ReportItem['area'], path: string, detail: string) =>
        items.push({ section, area, path, detail })

    // read
    const symlinks: string[] = []
    const srcFiles = walk(src, symlinks)
    for (const l of symlinks)
        push('decide', 'syntax', l, `symbolic link not copied; copy what it points to into the vault by hand: "${l}"`)
    if (existsSync(join(src, '.git')))
        push('defaults', 'plugins', '.git', "the source's git history is not copied; Bismuth starts its own snapshot history in the new vault")
    push('lossy', 'settings', '', 'file creation dates are the import time; modified dates are kept')
    const files: VaultText = new Map()
    for (const p of srcFiles) {
        if (!isText(p)) continue
        const raw = readFileSync(join(src, p), 'utf8')
        const text = raw.includes('\r') ? raw.replace(/\r\n?/g, '\n') : raw
        if (text !== raw) push('defaults', 'syntax', p, 'CRLF line endings converted to LF')
        files.set(p, text)
    }
    const binaries = srcFiles.filter(p => !isText(p))
    const config = readObsidianConfig(src)
    const ctxOf = (): ImportContext => ({
        config,
        allPaths: [...binaries, ...files.keys()].sort(),
    })
    const inv = inventory(files, ctxOf())
    const sourceTasks = taskCount(files)
    const unresolvedBefore = new Set(unresolvedLinks(files, ctxOf().allPaths).map(u => `${u.path}\0${u.target}`))

    // settings
    const mapped = mapSettings(config)
    items.push(...mapped.items)
    const obsidianFileOf = (key: string) =>
        key.startsWith('templates') ? 'templates.json' : key.startsWith('dailyNotes') ? 'daily-notes.json' : 'app.json'
    for (const s of mapped.settings) {
        const key = s.path.join('.')
        push('converted', 'settings', '.settings', `${key} = ${JSON.stringify(s.value)} (from .obsidian/${obsidianFileOf(key)})`)
    }
    for (const f of mapped.folderIcons)
        push('converted', 'settings', '.settings', `folder icon ${f.folder} = ${f.icon} (from the icon folder plugin data)`)
    if (existsSync(join(src, '.obsidian', 'hotkeys.json')))
        push('lossy', 'settings', '.obsidian/hotkeys.json', 'hotkeys.json: no automatic mapping to keybindings')
    const snippets = join(src, '.obsidian', 'snippets')
    if (existsSync(snippets))
        for (const f of readdirSync(snippets).filter(f => f.endsWith('.css')).sort())
            push('lossy', 'settings', `.obsidian/snippets/${f}`, 'css snippet is not imported, port its rules to a theme by hand')

    // converters
    for (const step of [
        () => normalizeTags(files),
        () => rewriteLinks(files, ctxOf()),
        () => convertBases(files, ctxOf(), collectVaultTags(files)),
        () => convertTasks(files, ctxOf(), opts.todayIso ?? todayLocal()),
        () => convertFlashcards(files, ctxOf()),
    ]) {
        const r = step()
        apply(files, r.edits)
        items.push(...r.items)
    }
    items.push(...scanUnconverted(files, ctxOf()))

    // write the copy (a dry run writes only the text files and `.settings` to a scratch dir that is
    // deleted after validation)
    const target = opts.dryRun ? mkdtempSync(join(tmpdir(), 'bismuth-import-dry-')) : out
    const keepDate = (p: string, from: string) => {
        try {
            const st = statSync(join(src, from))
            utimesSync(join(target, p), st.atime, st.mtime)
        } catch {
            /* no source file to take a date from: keep the import time */
        }
    }
    const dateSource = (p: string) =>
        srcFiles.includes(p) ? p : p.endsWith('.base.jsonl') ? p.replace(/\.jsonl$/, '') : p
    try {
        mkdirSync(target, { recursive: true })
        if (!opts.dryRun)
            for (const p of binaries) {
                mkdirSync(dirname(join(target, p)), { recursive: true })
                copyFileSync(join(src, p), join(target, p))
                keepDate(p, p)
            }
        for (const [p, text] of files) {
            mkdirSync(dirname(join(target, p)), { recursive: true })
            writeFileSync(join(target, p), text)
            keepDate(p, dateSource(p))
        }
        for (const s of mapped.settings) await setSettingInFile(target, s.path, s.value)
        for (const f of mapped.folderIcons) await setFolderIcon(target, f.folder, f.icon)
        // validation, on the in-memory copy that is about to be written
        const failures: string[] = []
        const fail1 = (area: 'validation', path: string, detail: string) => {
            failures.push(path)
            push('decide', area, path, detail)
        }
        for (const [p, text] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
            const isBaseNote = p.endsWith('.md') && /^---\n(?:[^\n]*\n)*?type:\s*['"]?base['"]?\s*\n(?:[^\n]*\n)*?---/.test(text)
            if (p.endsWith('.base.jsonl') || isBaseNote) {
                const errs = await validateBaseText(target, p, text)
                for (const e of errs) fail1('validation', p, `base validate: ${e}`)
            }
            if (!p.endsWith('.md')) continue
            const m = migrateContent(text)
            if (m.changed > 0) fail1('validation', p, `${m.changed} task line(s) still migrate, the task step missed them`)
            for (const f of findQueryFences(text)) {
                const r = migrateQueryBody(f.body, opts.todayIso ?? todayLocal())
                if (r?.changed) fail1('validation', p, 'a query block still holds a legacy tasks DSL line')
            }
        }
        const dangling = new Map<string, string[]>()
        for (const u of unresolvedLinks(files, ctxOf().allPaths)) {
            if (unresolvedBefore.has(`${u.path}\0${u.target}`)) {
                dangling.set(u.path, [...(dangling.get(u.path) ?? []), u.target])
                continue
            }
            fail1('validation', u.path, `unresolved link [[${u.target}]]`)
        }
        for (const [path, targets] of dangling)
            push('left', 'links', path, `unresolved in the source vault too: ${targets.map(t => `[[${t}]]`).join(', ')}`)
        const outTasks = taskCount(files)
        if (outTasks !== sourceTasks)
            fail1('validation', '', `task count changed: ${sourceTasks} checkbox tasks in the source, ${outTasks} in the copy`)
        if (!failures.length) push('left', 'validation', '', 'all checks passed: bases valid, tasks and query blocks migrated, no link the conversion broke, task count equal')

        const counts: Record<ReportSection, number> = { converted: 0, decide: 0, lossy: 0, defaults: 0, left: 0 }
        for (const i of items) if (!(i.area === 'validation' && i.section === 'left')) counts[i.section]++
        const report = renderReport({ source: src, out, inventory: inv, items })
        const reportPath = `${out}.conversion-report.md`
        const validation = { ok: failures.length === 0, failures: failures.length }
        if (opts.dryRun) return { out, reportPath: null, report, counts, validation }
        writeFileSync(reportPath, report)
        return { out, reportPath, report, counts, validation }
    } finally {
        if (opts.dryRun) rmSync(target, { recursive: true, force: true })
    }
}
