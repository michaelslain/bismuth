// {{nowFacts}} — the facts the dream's `now` note needs, computed by the daemon so the model copies
// them instead of surveying for them: tasks due in the next 7 days, the vault folders touched in
// the last 7 days, and the 3 newest day notes. Substituted into any cron prompt that carries the
// placeholder (cron.ts), the way {{brainReport}} is. Everything is read through the daemon
// channel's rules: a denied vault path and a hidden memory note never appear.
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
    addDaysISO,
    isDigestNote,
    isMemoryNoteVisibleToDaemon,
    loadAllNotes,
    parseDigestName,
    todayISO,
} from '@bismuth/memory'
import { dueTasks, isDeniedPath } from '../lib/coreTasks.js'
import { buildDenyPaths } from '../lib/visibility.ts'

export const NOW_FACTS_PLACEHOLDER = '{{nowFacts}}'

const MAX_CHARS = 2500
const DAY_MS = 86_400_000

/** Vault-relative paths of markdown notes modified at or after `since`, dot-entries skipped. */
async function recentNotes(vault: string, since: number): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string, rel: string): Promise<void> => {
        let entries
        try {
            entries = await readdir(dir, { withFileTypes: true })
        } catch {
            return
        }
        for (const e of entries) {
            if (e.name.startsWith('.')) continue
            const r = rel ? `${rel}/${e.name}` : e.name
            if (e.isDirectory()) await walk(join(dir, e.name), r)
            else if (e.name.endsWith('.md')) {
                try {
                    if ((await stat(join(dir, e.name))).mtimeMs >= since) out.push(r)
                } catch {}
            }
        }
    }
    await walk(vault, '')
    return out
}

function clip(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/** Whole lines only, at most `max` characters: a line that does not fit is dropped, never cut. */
function clipLines(lines: string[], max: number): string {
    const kept: string[] = []
    let len = 0
    for (const line of lines) {
        const next = len + line.length + (kept.length ? 1 : 0)
        if (next > max) break
        kept.push(line)
        len = next
    }
    return kept.join('\n')
}

/** Markdown facts for the dream's `now` note, at most 2,500 characters. Never throws on a missing
 *  vault or memory dir: an unreadable section reads `(none)`. */
export async function nowFacts(
    vault: string,
    memoryDir: string,
    now: Date,
): Promise<string> {
    const deny = await buildDenyPaths(vault)
    const today = todayISO(now)
    const horizon = addDaysISO(today, 7)

    let dueLines: string[] = []
    try {
        const due = await dueTasks(vault, { before: horizon, deny })
        // Today or later first (they are what the note lists), overdue after; each group stays earliest first.
        const upcoming = due.filter(t => t.due >= today)
        const overdue = due.filter(t => t.due < today)
        dueLines = [...upcoming, ...overdue].map(t => `- ${t.text} [due ${t.due}] — [[${t.path.replace(/\.md$/, '')}]]`)
    } catch {}

    const folders = new Map<string, number>()
    try {
        for (const rel of await recentNotes(vault, now.getTime() - 7 * DAY_MS)) {
            if (isDeniedPath(deny, rel)) continue
            const slash = rel.indexOf('/')
            const folder = slash === -1 ? '(vault root)' : rel.slice(0, slash)
            folders.set(folder, (folders.get(folder) ?? 0) + 1)
        }
    } catch {}
    const folderLines = [...folders.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .map(([f, n]) => `- ${f}: ${n} note${n === 1 ? '' : 's'}`)

    let dayLines: string[] = []
    try {
        dayLines = (await loadAllNotes(memoryDir))
            .filter(
                n =>
                    parseDigestName(n.name)?.period === 'day' &&
                    isDigestNote(n) &&
                    isMemoryNoteVisibleToDaemon(n),
            )
            .sort((a, b) => (a.name < b.name ? 1 : -1))
            .slice(0, 3)
            .map(n => `- [[${n.name}]] ${n.frontmatter.description ?? ''}`.trimEnd())
    } catch {}

    const section = (title: string, lines: string[], cap: number, whole = false): string => {
        const body = lines.length ? (whole ? clipLines(lines, cap) : clip(lines.join('\n'), cap)) : '(none)'
        return `### ${title}\n${body}`
    }
    return clip(
        [
            section(`Tasks due before ${horizon} (today is ${today})`, dueLines, 1100, true),
            section('Vault folders with notes modified in the last 7 days', folderLines, 700),
            section('Newest day notes', dayLines, 600),
        ].join('\n\n'),
        MAX_CHARS,
    )
}
