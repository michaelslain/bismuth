// The task-line PARSER, split out of tasks.ts so the frontend can value-import it without
// dragging tasks.ts's `getFileAccess` -> `fileAccess.ts` -> (dynamically) `files.ts` ->
// `node:fs`/`node:path` into the WebView bundle.
//
// `app/src/bases/taskScope.ts` needs the REAL producer (`parseTaskLine`) so the prospective
// row it evaluates a view's filters against cannot drift from the row the vault scan itself
// would produce — see that file's own header comment. Before this module existed, nothing
// in app/ ever VALUE-imported anything from tasks.ts (only `import type`), so tasks.ts's
// node-coupled top-level import never entered the browser bundle's static graph. The first
// value import (`taskScope.ts` reaching for `parseTaskLine`) broke `vite build` with
// `"resolve" is not exported by "__vite-browser-external"`, imported by `core/src/files.ts` —
// a Rollup build-time failure that neither `bun test app` nor `bun run typecheck` can see,
// because both run under Bun's own Node-compatible runtime, where `node:path` resolves fine.
// `app/src/browserBundleGraph.test.ts` is the guard against this recurring silently.
//
// This module must import NOTHING with runtime IO. The imports below are: two other pure
// task modules (`taskFields`, `taskReorder` — both already documented as frontend-safe, for
// the identical reason), `./tags` (pure — see its own file), and a TYPE ONLY from `./tasks`
// (erased at build, so it does not recreate the very edge this file exists to avoid).
import type { TaskStatus, Priority } from './tasks'
import { parseFields } from './taskFields'
import { statusFromChar } from './taskReorder'
import { INLINE_TAG_REGEX } from './tags'

export interface Task {
    path: string // vault-relative file path
    line: number // 0-indexed line number within the file
    raw: string // the original full line (incl. indentation)
    indent: string // leading whitespace
    status: TaskStatus
    statusChar: string // the raw character between the brackets
    description: string // task text with bracket fields stripped, trimmed (tags kept)
    priority: Priority
    tags: string[] // #tags found in the description (without leading #)
    due?: string // [due YYYY-MM-DD]
    scheduled?: string // [scheduled YYYY-MM-DD]
    start?: string // [start YYYY-MM-DD]
    done?: string // [done YYYY-MM-DD]
    created?: string // [created YYYY-MM-DD]
    cancelled?: string // [cancelled YYYY-MM-DD]
    recurrence?: string // [every <rule>]
}

// `- `, `* `, or `+ ` bullet, then `[<one char>]`, then a space and the body.
// Exported so `core/src/taskLegacy.ts` reuses this one definition of the line grammar
// rather than holding a second copy that can drift out of step with it. Re-exported from
// `./tasks` for every existing `from "./tasks"` importer.
export const TASK_LINE = /^(\s*)[-*+] \[(.)\] (.*)\r?$/

export function parseTaskLine(
    line: string,
    path: string,
    lineNo: number,
): Task | null {
    const m = TASK_LINE.exec(line)
    if (!m) return null
    const [, indent, statusChar, body] = m

    // Bracket fields are the whole grammar. An emoji signifier is not read, not stripped
    // and not special in any way — it stays in the description as the literal text it is,
    // so nothing is silently eaten off a line this parser does not understand.
    const fields = parseFields(body)
    const rest = fields.rest
    const tags = [
        ...new Set([...rest.matchAll(INLINE_TAG_REGEX)].map(t => t[1])),
    ]
    const description = rest.replace(/\s+/g, ' ').trim()

    return {
        path,
        line: lineNo,
        raw: line,
        indent,
        status: statusFromChar(statusChar),
        statusChar,
        description,
        priority: fields.priority ?? 'none',
        tags,
        recurrence: fields.recurrence,
        ...fields.dates,
    }
}

export function extractTasks(content: string, path: string): Task[] {
    const out: Task[] = []
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
        const t = parseTaskLine(lines[i], path, i)
        if (t) out.push(t)
    }
    return out
}
