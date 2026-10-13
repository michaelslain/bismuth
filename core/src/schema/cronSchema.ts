// core/src/schema/cronSchema.ts
// The frontmatter schema of a daemon cron file (`.daemon/crons/<name>.md`), as the daemon's own
// parser reads it (daemon/src/daemon/cron.ts parseCronFrontmatter). resolveNoteSchema hands a cron
// file this schema instead of the vault's note properties, so the editor lint and `bismuth prop
// check` flag what the daemon would skip or misread. Pure — no I/O, no framework imports.
import type { PropertyType, Schema } from './types'

const CRON_PATH_RE = /^\.daemon\/crons\/[^/]+\.md$/

/** True for a cron definition file, by its vault-relative path. */
export function isCronPath(path: string): boolean {
    return CRON_PATH_RE.test(path.replace(/^\.?\/+/, ''))
}

// The daemon compares these to the exact text `true`/`false`; the enum compares String(value), so
// YAML's boolean `false` and a quoted "false" both pass.
const FLAG: PropertyType = { kind: 'enum', values: ['true', 'false'] }

/**
 * The cron schema for a file with this frontmatter. `schedule` is required unless the cron fires on
 * file change, and `watch` is required when it does — the daemon skips the file otherwise.
 */
export function cronSchema(frontmatter: Record<string, unknown>): Schema {
    const onFileChange = String(frontmatter.on ?? '').trim() === 'file-change'
    return {
        name: {
            type: 'string',
            doc: 'Display name; keys the cron history, so renaming it orphans that history. Defaults to the file name.',
        },
        schedule: {
            type: 'cron',
            required: !onFileChange,
            doc: 'Five-field cron expression in local time: minute hour day-of-month month day-of-week.',
        },
        on: {
            type: { kind: 'enum', values: ['schedule', 'file-change'] },
            doc: '`file-change` fires when a file matching `watch` changes instead of on a schedule.',
        },
        watch: {
            type: { kind: 'path' },
            required: onFileChange,
            doc: 'Vault-relative path or glob a file-change cron watches.',
        },
        enabled: {
            type: FLAG,
            doc: 'Only the exact text `false` disables the cron.',
        },
        catchup: {
            type: FLAG,
            doc: 'Whether a missed schedule fires late. Schedule crons only.',
        },
        notify: { type: FLAG, doc: 'An OS notification per run.' },
        model: { type: 'string', doc: "The session's model. Defaults to haiku." },
        effort: {
            type: { kind: 'enum', values: ['low', 'medium', 'high'] },
            doc: 'Reasoning effort; any other value runs as medium.',
        },
        tier: {
            type: { kind: 'enum', values: ['fast', 'balanced', 'deep'] },
            doc: 'Picks model and effort for the backend; an explicit model or effort wins.',
        },
        timeout: {
            type: 'timeout',
            doc: 'Session limit in seconds; `none` or 0 means no limit. Defaults to 300.',
        },
        waitFor: {
            type: 'string',
            doc: 'A `pgrep -f` pattern to wait on after the session ends.',
        },
        incremental: {
            type: FLAG,
            doc: 'Skip runs when nothing relevant changed since the last success.',
        },
        checkpointDirs: {
            type: {
                kind: 'list',
                item: { kind: 'enum', values: ['vault', 'memory'] },
            },
            doc: 'Which areas an incremental cron checks: vault, memory, or both comma-separated.',
        },
        checkpointDir: {
            type: { kind: 'enum', values: ['vault', 'memory'] },
            doc: 'Single-value form of checkpointDirs.',
        },
    }
}

const FIELDS = [
    { name: 'minute', lo: 0, hi: 59 },
    { name: 'hour', lo: 0, hi: 23 },
    { name: 'day-of-month', lo: 1, hi: 31 },
    { name: 'month', lo: 1, hi: 12 },
    { name: 'day-of-week', lo: 0, hi: 6 },
] as const

const NUM_RE = /^\d+$/

/** What is wrong with one field, or null. `severity` is error unless the field still matches
 *  something the author may not expect (a range inside a list). */
function fieldProblem(
    field: string,
    spec: (typeof FIELDS)[number],
): { message: string; severity: 'error' | 'warning' } | null {
    const never = (why: string) => ({
        message: `${spec.name} field "${field}" never matches: ${why}`,
        severity: 'error' as const,
    })
    const inRange = (n: number) => n >= spec.lo && n <= spec.hi
    const range = `${spec.lo}-${spec.hi}`
    if (field === '*') return null
    if (field.startsWith('*/')) {
        const step = field.slice(2)
        if (!NUM_RE.test(step) || Number(step) === 0)
            return never('a step is */N with N a whole number above 0')
        return null
    }
    if (field.includes(',')) {
        const parts = field.split(',').map(p => p.trim())
        for (const p of parts) {
            if (NUM_RE.test(p)) {
                if (!inRange(Number(p)))
                    return never(`${p} is outside ${range}`)
                continue
            }
            if (/^\d+-\d+$/.test(p))
                return {
                    message: `${spec.name} field "${field}": a range inside a list counts as its first number only`,
                    severity: 'warning',
                }
            return never(`list items must be numbers`)
        }
        return null
    }
    if (field.includes('-')) {
        const m = field.match(/^(\d+)-(\d+)$/)
        if (!m) return never('a range is A-B with whole numbers')
        const a = Number(m[1])
        const b = Number(m[2])
        if (!inRange(a) || !inRange(b))
            return never(`the range must stay within ${range}`)
        if (a > b) return never('the range runs backwards')
        return null
    }
    if (!NUM_RE.test(field))
        return never(
            'only *, */N, A-B, A,B,C and numbers are supported (no names, macros or A-B/N)',
        )
    if (!inRange(Number(field))) return never(`outside ${range}`)
    return null
}

/** Why a cron schedule is malformed as the daemon reads it, or null when it is fine. */
export function cronScheduleProblem(
    value: unknown,
): { message: string; severity: 'error' | 'warning' } | null {
    const fields = String(value).trim().split(/\s+/)
    if (fields.length !== 5)
        return {
            message: `expected five fields (minute hour day-of-month month day-of-week), found ${fields.length}; the daemon skips this cron`,
            severity: 'error',
        }
    for (let i = 0; i < 5; i++) {
        const p = fieldProblem(fields[i], FIELDS[i])
        if (p) return p
    }
    return null
}

/** Why a cron timeout is not whole seconds or `none`, or null. */
export function cronTimeoutProblem(value: unknown): string | null {
    const s = String(value).trim()
    if (s === 'none' || NUM_RE.test(s)) return null
    return 'expected whole seconds, or none for no limit'
}
