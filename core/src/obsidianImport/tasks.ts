// Tasks plugin conversion: emoji task lines to bracket fields, ```tasks fences to ```query
// blocks. Pure; docs/guides/converting-obsidian-to-bismuth/tasks.md is the format reference.
import { migrateContent } from '../taskMigrate'
import { migrateQueryBody } from '../bases/migrateQueries'
import { joinContinuationLines } from '../bases/taskDsl'
import { fenceInfoPerLine, findFences } from './textFences'
import type { FileEdit, ImportContext, ReportItem, StepResult, VaultText } from './types'

const TASK_LINE = /^\s*[-*+]\s\[.\]/
const NUMBERED_TASK = /^\s*\d+[.)]\s\[.\]/
const UNREAD_SIGNIFIERS = /[🏁⛔🆔]/u
const INSTRUCTION =
    /^(group by|limit|hide|show|short mode|full mode|explain|ignore global query)\b/i
// Fields a flat ```query block can group by (docs/bases/query-block.md).
const GROUP_FIELDS = new Set(['status', 'priority', 'due', 'scheduled'])

const quote = (line: string) => `"${line.trim()}"`

function groupField(raw: string): string | null {
    const key = raw.trim().toLowerCase()
    if (key === 'filename') return 'file.name'
    if (key === 'folder') return 'file.folder'
    return GROUP_FIELDS.has(key) ? key : null
}

type FenceOutcome = { lines: string[] | null; items: ReportItem[] }

const QUERY_FILE_PLACEHOLDER = /\{\{\s*query\.file\.(path|folder|filename|filenameWithoutExtension|root)\s*\}\}/
const QUERY_FILE_PLACEHOLDER_ALL = new RegExp(QUERY_FILE_PLACEHOLDER.source, 'g')

/** Replace each `{{query.file.<prop>}}` with the host note's value, in the Tasks plugin's own
 *  spelling: `folder` and `root` end in `/` (root is the top folder, `/` for the vault root),
 *  `filename` keeps `.md`. */
function fillQueryFile(line: string, path: string): string {
    const slash = path.lastIndexOf('/')
    const folder = slash === -1 ? '/' : path.slice(0, slash + 1)
    const filename = slash === -1 ? path : path.slice(slash + 1)
    const root = path.includes('/') ? path.slice(0, path.indexOf('/') + 1) : '/'
    const values: Record<string, string> = {
        path,
        folder,
        filename,
        filenameWithoutExtension: filename.replace(/\.md$/i, ''),
        root,
    }
    return line.replace(QUERY_FILE_PLACEHOLDER_ALL, (_, prop: string) => values[prop])
}

/** The Tasks plugin's named queries (`presets` in its settings): name → query text. */
function presetsOf(ctx: ImportContext): Record<string, string> {
    const data = ctx.config.pluginData['obsidian-tasks-plugin'] as Record<string, unknown> | undefined
    const raw = data?.presets
    if (!raw || typeof raw !== 'object') return {}
    return Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    )
}

/** Inline every `preset <name>` line and every one-line `{{preset.<name>}}` the plugin defines, as
 *  Tasks does when it runs the query; presets may use presets. A name the settings do not define
 *  is left as written, so the translator reports it. */
function expandPresets(body: string[], presets: Record<string, string>, depth = 0): string[] {
    if (depth > 8 || !Object.keys(presets).length) return body
    let changed = false
    const out: string[] = []
    for (const line of body) {
        const m = /^\s*preset\s+(\S+)\s*$/.exec(line)
        if (m && m[1] in presets) {
            out.push(...presets[m[1]].split('\n'))
            changed = true
            continue
        }
        const inline = line.replace(/\{\{\s*preset\.([\w-]+)\s*\}\}/g, (all, name: string) => {
            const text = presets[name]
            if (text === undefined || text.includes('\n')) return all
            changed = true
            return text
        })
        out.push(inline)
    }
    return changed ? expandPresets(out, presets, depth + 1) : out
}

function convertFence(body: string[], path: string, todayIso: string, presets: Record<string, string>): FenceOutcome {
    const items: ReportItem[] = []
    body = expandPresets(body, presets)
    const first = quote(body.find(l => l.trim()) ?? '')
    const dsl: string[] = []
    // Lines that change nothing about which tasks match, listed in ONE item per query.
    const dropped: string[] = []
    let group: string | undefined
    let limit: string | undefined
    for (const line of joinContinuationLines(body)) {
        const t = line.trim()
        if (!INSTRUCTION.test(t)) {
            dsl.push(line)
            continue
        }
        const g = /^group by\s+(.+)$/i.exec(t)
        const l = /^limit\s+(\d+)$/i.exec(t)
        const field = g ? groupField(g[1]) : null
        if (g && field) group = field
        else if (l) limit = l[1]
        else dropped.push(t)
    }
    // `{{query.file.*}}` names the note the query sits in. Bismuth's `this` holds only the host
    // note's properties, not its path, so the importer writes the host's current path in: exact
    // until that note is renamed or moved, which the lossy item says.
    const placeheld = dsl.some(l => QUERY_FILE_PLACEHOLDER.test(l))
    if (placeheld) {
        for (let i = 0; i < dsl.length; i++) dsl[i] = fillQueryFile(dsl[i], path)
        items.push({
            section: 'lossy',
            area: 'queries',
            path,
            detail: 'query names this note through {{query.file…}}: written as its current path, so a renamed or moved note keeps matching the old one',
        })
    }
    let out: string[]
    const text = dsl.join('\n').trim()
    if (!text) out = ['tasks:']
    else {
        const asBlock = 'tasks: |-\n' + dsl.map(l => (l.length ? `  ${l}` : '')).join('\n')
        // A ```tasks fence is Tasks text by definition, so no looksLikeTaskDsl guess.
        const res = migrateQueryBody(asBlock, todayIso, { assumeDsl: true })
        if (!res || !res.changed) {
            items.push({
                section: 'decide',
                area: 'queries',
                path,
                detail: `tasks query left as written, it has no Bismuth translation: ${first}`,
            })
            return { lines: null, items }
        }
        // The recognised part is real, so the query is still written; what could not be
        // translated widens it, and that is the one thing the user has to look at.
        if (res.unrecognized?.length)
            items.push({
                section: 'decide',
                area: 'queries',
                path,
                detail: `query filter not translated, matches more tasks than before: ${res.unrecognized.map(quote).join(', ')}`,
            })
        dropped.push(...(res.ignored ?? []))
        out = res.body.split('\n')
    }
    if (dropped.length)
        items.push({
            section: 'lossy',
            area: 'queries',
            path,
            detail: `query lines dropped, no Bismuth equivalent: ${dropped.map(quote).join(', ')}`,
        })
    if (group) out.push(`group: ${group}`)
    if (limit) out.push(`limit: ${limit}`)
    items.push({
        section: 'converted',
        area: 'queries',
        path,
        detail: `tasks query became a query block: ${first}`,
    })
    return { lines: out, items }
}

export function convertTasks(files: VaultText, ctx: ImportContext, todayIso: string): StepResult {
    const edits: FileEdit[] = []
    const items: ReportItem[] = []
    let emojiTasks = 0

    for (const [path, original] of files) {
        if (!path.endsWith('.md')) continue
        let text = original
        const lines = original.split('\n')
        const inFence = fenceInfoPerLine(lines)

        lines.forEach((line, i) => {
            if (inFence[i] !== null) return
            if (NUMBERED_TASK.test(line))
                items.push({
                    section: 'lossy',
                    area: 'tasks',
                    path,
                    detail: `numbered task is not a task in Bismuth: ${quote(line)}`,
                })
            else if (TASK_LINE.test(line) && UNREAD_SIGNIFIERS.test(line))
                items.push({
                    section: 'lossy',
                    area: 'tasks',
                    path,
                    detail: `🏁 ⛔ 🆔 are kept as plain text: ${quote(line)}`,
                })
        })

        const migrated = migrateContent(text)
        if (migrated.changed) {
            emojiTasks += migrated.changed
            text = migrated.content
            items.push({
                section: 'converted',
                area: 'tasks',
                path,
                detail: `${migrated.changed} emoji task line(s) rewritten to bracket fields`,
            })
            for (const idx of migrated.flagged)
                items.push({
                    section: 'decide',
                    area: 'tasks',
                    path,
                    detail: `task did not round-trip, check it: ${quote(lines[idx] ?? '')}`,
                })
        }

        const cur = text.split('\n')
        const fences = findFences(cur).filter(f => f.closed && f.info === 'tasks')
        for (const f of fences.reverse()) {
            const res = convertFence(f.body, path, todayIso, presetsOf(ctx))
            items.push(...res.items)
            if (!res.lines) continue
            cur.splice(f.startLine, f.endLine - f.startLine + 1, '```query', ...res.lines, '```')
        }
        const next = cur.join('\n')
        if (next !== original) edits.push({ path, text: next })
    }

    if (emojiTasks > 0 && !ctx.config.plugins.includes('obsidian-tasks-plugin'))
        items.push({
            section: 'defaults',
            area: 'tasks',
            path: '',
            detail: `${emojiTasks} emoji task line(s) migrated although obsidian-tasks-plugin is not installed`,
        })
    return { edits, items }
}
