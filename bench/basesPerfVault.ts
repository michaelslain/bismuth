// bench/basesPerfVault.ts — synthetic vault generator for the bases/tasks perf bench.
//
// Builds a throwaway vault of `noteCount` markdown notes (~40% carrying 1-3 checkbox
// tasks with due/scheduled dates spread across a year) plus two `type: base` files:
// a tasks-mode calendar base (regex filter + a declared formula property) and a base
// that composes over it (`source: { kind: base, ref: "[[...]]" }`). Every downstream
// task in this plan (`.claude/plans/2026-09-17-bases-perf.md`) runs `bun run
// bench:bases-perf` against a fresh vault from this module to prove its own delta.
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'

export interface PerfVaultOptions {
    noteCount?: number // default 1200
    outDir?: string // default a fresh dir under os.tmpdir()
}

export interface PerfVault {
    root: string // vault root, populated with notes
    calendarBasePath: string // vault-relative path of a `type: base` md: mode: tasks,
    // views: [{ type: calendar }], one regex-using filter, one declared formula
    composedBasePath: string // vault-relative path of a second base whose source is
    // { kind: 'base', ref: calendarBasePath } (exercises composition)
    cleanup(): Promise<void> // rm -rf outDir
}

const CALENDAR_BASE_NAME = 'PerfCalendar'
const COMPOSED_BASE_NAME = 'PerfComposed'

// A note carries tasks when its index falls in this band of every 10 — 4 of 10 is 40%.
const TASK_NOTE_MODULO = 10
const TASK_NOTE_THRESHOLD = 4

const DAY_MS = 24 * 60 * 60 * 1000

/** A date `daysFromNow` days from today, ISO `YYYY-MM-DD` (the bracket-field spelling
 *  `docs/tasks/syntax.md` requires). `daysFromNow` may be negative (past) or beyond
 *  365 (none here) — the caller controls the year-wide spread. */
function isoDate(daysFromNow: number): string {
    return new Date(Date.now() + daysFromNow * DAY_MS)
        .toISOString()
        .slice(0, 10)
}

/** Deterministic pseudo-spread across a year, keyed off the note+task index so two
 *  runs of the same noteCount produce the same shape (useful for eyeballing a diff)
 *  without needing an actual seeded RNG dependency. */
function spreadDay(seed: number): number {
    // -182..+182ish, walking the whole year band via a large odd stride mod 365.
    return ((seed * 137) % 365) - 182
}

function noteBody(i: number, taskCount: number): string {
    const lines: string[] = [
        '---',
        `title: Note ${i}`,
        `tags: [perf, group${i % 20}]`,
        '---',
        '',
        `# Note ${i}`,
        '',
        `Synthetic body text for the bases/tasks perf bench, note ${i} of the generated vault. ` +
            'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.',
        '',
    ]
    for (let t = 0; t < taskCount; t++) {
        const field = t % 2 === 0 ? 'due' : 'scheduled'
        const date = isoDate(spreadDay(i * 3 + t))
        lines.push(`- [ ] task ${i}-${t} for note ${i} [${field} ${date}]`)
    }
    return lines.join('\n') + '\n'
}

function calendarBaseText(): string {
    return [
        '---',
        'type: base',
        'source: tasks',
        'views:',
        '  - type: calendar',
        '    name: Calendar',
        '    mode: tasks',
        // Regex-using filter — a `/pattern/flags` REGEX LITERAL (docs/bases/filters.md),
        // not a quoted string, so this exercises the lexer's regex-literal path (the same
        // AST node task 2 in this plan adds compiled-regex caching for). Every generated
        // task description is literally "task N-T for note N", so this keeps every row.
        "filters: 'note.description.matches(/task \\d+-\\d+/)'",
        // A declared formula property (docs/bases/properties.md list form) — exercises
        // declaredFormulas() -> computeFormulas on every runView call, distinct from a
        // plain top-level `formulas:` map.
        'properties:',
        '  - name: urgency',
        '    type: formula',
        '    expr: \'note.priority == "high" ? 2 : 1\'',
        '---',
        '',
    ].join('\n')
}

function composedBaseText(): string {
    return [
        '---',
        'type: base',
        'source:',
        '  kind: base',
        `  ref: "[[${CALENDAR_BASE_NAME}]]"`,
        'views:',
        '  - type: table',
        '    name: Composed',
        '---',
        '',
    ].join('\n')
}

export async function buildPerfVault(
    opts?: PerfVaultOptions,
): Promise<PerfVault> {
    const noteCount = opts?.noteCount ?? 1200
    const outDir =
        opts?.outDir ??
        join(
            tmpdir(),
            `bismuth-perf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        )
    const root = join(outDir, 'vault')
    await mkdir(root, { recursive: true })

    const calendarBasePath = `${CALENDAR_BASE_NAME}.md`
    const composedBasePath = `${COMPOSED_BASE_NAME}.md`

    const writes: Array<() => Promise<void>> = []
    for (let i = 0; i < noteCount; i++) {
        const carriesTasks = i % TASK_NOTE_MODULO < TASK_NOTE_THRESHOLD
        const taskCount = carriesTasks ? 1 + (i % 3) : 0
        const content = noteBody(i, taskCount)
        const filePath = join(root, `note-${String(i).padStart(5, '0')}.md`)
        writes.push(() => writeFile(filePath, content, 'utf8'))
    }

    // Concurrency sized off the machine (build-sweeps-parallel), not a hardcoded constant
    // and not fully sequential: split the note list into that many slices, each written
    // by its own worker in order, all workers running together via one Promise.all batch.
    const workerCount = Math.max(2, cpus().length - 1)
    const workers: Array<() => Promise<void>>[] = Array.from(
        { length: workerCount },
        () => [],
    )
    writes.forEach((write, i) => workers[i % workerCount].push(write))
    await Promise.all(
        workers.map(async slice => {
            for (const write of slice) await write()
        }),
    )

    await writeFile(join(root, calendarBasePath), calendarBaseText(), 'utf8')
    await writeFile(join(root, composedBasePath), composedBaseText(), 'utf8')

    return {
        root,
        calendarBasePath,
        composedBasePath,
        cleanup: () => rm(outDir, { recursive: true, force: true }),
    }
}
