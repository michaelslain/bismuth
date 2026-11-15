// Bases + rows command group for the `bismuth` CLI.
// Mirrors core's POST /rows and /row/* handlers: parse a base file's rows,
// resolve a SourceSpec to a uniform Row[], or mutate a base's GFM table rows.
// Mutating commands call core directly — the app's file watcher picks up the
// writes live, no HTTP server required.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { CommandMap } from '../types'
import {
    BOOLEAN_FLAGS,
    bool,
    fail,
    flag,
    out,
    parseJsonFlag,
    positionals,
    requireVault,
    today,
} from '../args'
import {
    createEntry,
    deleteEntry,
    fileExists,
    listMarkdown,
    readNote,
    writeNote,
} from '../../../core/src/files'
import { setFrontmatterKey } from '../../../core/src/frontmatter'
import { parseBaseFile, FRONTMATTER_RE } from '../../../core/src/bases/parse'
import {
    resolveSource,
    resolveBaseRows,
} from '../../../core/src/bases/source'
import {
    upsertRow,
    patchRowWhere,
    deleteRow,
    reorderRow,
} from '../../../core/src/bases/rowOps'
import {
    BASE_EXT,
    baseNameOf,
    convertMdBaseToJsonl,
    baseFormatOf,
    isBaseText,
    isBasePath,
    serializeBaseJsonl,
    mutateBaseConfig,
} from '../../../core/src/bases/baseFile'
import { loadAppConfig } from '../../../core/src/settings'
import { createError } from '../../../core/src/error'
import {
    readManifest,
    manifestKey,
    rekeyBaseSyncUnlocked,
} from '../../../core/src/gcal/manifest'
import { withSyncLock } from '../../../core/src/gcal/lock'
import { resolveBasePath, normalizeVaultPath } from '../baseResolve'
import {
    agentDenyEntries,
    filterByPath,
    isDeniedPath,
} from '../../../core/src/visibilityFilter'
import {
    VIEW_TYPES,
    isValidType,
    type SourceSpec,
} from '../../../core/src/bases/types'
import { runView } from '../../../core/src/bases/query'
import {
    buildChartData,
    buildHeatmapWeeks,
} from '../../../core/src/bases/chart'
import { metricResults } from '../../../core/src/bases/metrics'

import {
    validateBaseText,
    readsDeniedBase,
} from '../baseValidate'
import {
    findQueryFences,
    migrateQueryBody,
} from '../../../core/src/bases/migrateQueries'

// book.ts reads it from here.
export { readsDeniedBase }

const CHART_KINDS = new Set(['bar', 'line', 'stat', 'heatmap'])

/** Read a base file's note text + metadata (name, path) the way core does. */
async function readBase(
    vault: string,
    file: string,
): Promise<{ text: string; name: string }> {
    const text = await readNote(vault, file)
    return { text, name: baseNameOf(file) }
}

/** Parse a required `--json '{...}'` flag into a note record (the row's fields). */
function requireJson(args: string[]): Record<string, unknown> {
    return parseJsonFlag(args, 'json', { required: true })
}

/** Parse an integer positional, failing on a non-number. */
function intArg(raw: string | undefined, label: string): number {
    const n = Number(raw)
    if (raw === undefined || !Number.isInteger(n))
        fail(`${label} must be an integer`)
    return n
}

export const commands: CommandMap = {
    'base create': {
        summary:
            'Create a new base (a `.base.jsonl` file; an explicit `.md` path makes a markdown base). A base has exactly one view',
        usage: '<path> --view <kind> [--source <spec>] [--group-by <property>] [--lat <property>] [--lng <property>] [--x <property>]',
        run: async args => {
            const vault = requireVault(args)
            const [path] = positionals(args)
            if (!path) fail('<path> required')
            const rel =
                /\.md$/i.test(path) || isBasePath(path)
                    ? path
                    : `${path}${BASE_EXT}`

            const view = flag(args, 'view')
            if (!view)
                fail(
                    `--view <kind> required — one of: ${VIEW_TYPES.join(', ')}`,
                )
            if (!isValidType(view))
                fail(
                    `invalid --view "${view}" — must be one of: ${VIEW_TYPES.join(', ')}`,
                )

            const source = flag(args, 'source') ?? 'notes'

            // Some view kinds render nothing (or a hint message) without their key config —
            // rather than silently omit it, write the key with a blank value AND report it
            // as `missing` in the result, so an agent creating a base sees exactly what it
            // still has to fill in.
            const viewKeys: Record<string, unknown> = {}
            const missing: string[] = []

            if (view === 'kanban') {
                const groupBy = flag(args, 'group-by')
                viewKeys.groupBy = { property: groupBy ?? '' }
                if (!groupBy) missing.push('groupBy')
            } else if (view === 'map') {
                const lat = flag(args, 'lat')
                const lng = flag(args, 'lng')
                viewKeys.lat = lat ?? ''
                viewKeys.lng = lng ?? ''
                if (!lat) missing.push('lat')
                if (!lng) missing.push('lng')
            } else if (CHART_KINDS.has(view)) {
                const x = flag(args, 'x')
                viewKeys.x = x ?? ''
                if (!x) missing.push('x')
            }

            // JSONL: the config is line 1. Markdown (explicit `.md` path): build the frontmatter via
            // the same yaml-preserving helper `prop set`/`row add` use, one key at a time.
            let text: string
            if (isBasePath(rel)) {
                text = serializeBaseJsonl(
                    { type: 'base', view, source, ...viewKeys },
                    [],
                )
            } else {
                text = setFrontmatterKey('', 'type', 'base')
                text = setFrontmatterKey(text, 'view', view)
                text = setFrontmatterKey(text, 'source', source)
                for (const [key, value] of Object.entries(viewKeys))
                    text = setFrontmatterKey(text, key, value)
            }

            // Reserve the path first (throws EEXIST if a file is already there — no clobbering
            // an existing note), then write the real config.
            createEntry(vault, rel, 'file')
            await writeNote(vault, rel, text)

            const result: Record<string, unknown> = {
                ok: true,
                path: rel,
                view,
                source,
            }
            if (missing.length) {
                result.missing = missing
                result.note = `This ${view} view needs ${missing.join(' and ')} set before it renders anything — edit ${rel} or run \`bismuth prop set\`.`
            }
            out(result, args)
        },
    },

    'base read': {
        summary: 'Parse a type:base note and print its config + table rows',
        usage: '<path>',
        run: async args => {
            const vault = requireVault(args)
            const [given] = positionals(args)
            if (!given) fail('<path> required')
            const path = resolveBasePath(vault, given)
            const { text, name } = await readBase(vault, path)
            const { config, rows } = parseBaseFile(text, { name, path })
            out({ config, rows }, args)
        },
    },

    'base validate': {
        summary:
            'Check a type:base note for structural problems (bad view types, invalid property defaults, unresolvable sources/filters) before rendering it',
        usage: '<path>',
        run: async args => {
            const vault = requireVault(args)
            const [given] = positionals(args)
            if (!given) fail('<path> required')
            const path = resolveBasePath(vault, given)
            const { text } = await readBase(vault, path)
            const errors = await validateBaseText(vault, path, text)

            const ok = errors.length === 0
            out({ ok, errors }, args)
            // A structured {ok:false, ...} on stdout is easy to miss in a script — the exit
            // code is what `&&`/CI/the MCP layer (a non-zero exit maps to isError) actually
            // gate on, so a broken base must fail loudly there too. `exitCode` (not `exit()`)
            // lets stdout finish flushing before the process actually exits.
            process.exitCode = ok ? 0 : 1
        },
    },

    'base render': {
        summary:
            "Resolve a base's rows and run a view's grouping/sorting/summary pipeline (chart views return a computed series instead of raw rows)",
        usage: '<path>',
        run: async args => {
            const vault = requireVault(args)
            const [given] = positionals(args)
            if (!given) fail('<path> required')
            const path = resolveBasePath(vault, given)

            const entries = await agentDenyEntries(vault)
            const { text, name } = await readBase(vault, path)
            const parsedBase = parseBaseFile(text, { name, path })
            // A hidden ref answers EXACTLY like a missing one (no rows), never a refusal: a distinct
            // answer would be an existence oracle for hidden base names.
            const hiddenRef = await readsDeniedBase(
                vault,
                parsedBase.config.source,
                entries,
            )

            // Same resolution the app uses to open THIS base file: its own inline table when it
            // declares no source, otherwise the source it declares (following composition) —
            // resolveBaseRows, not a spec built from `bismuth rows`' generic --of/--where/--tasks
            // flags, since we already have this one base's own parsed config to resolve from.
            // Filtered HERE, before runView: grouping, summaries, charts and metrics all
            // aggregate, so a hidden row dropped afterwards would still be inside every total.
            const rows = hiddenRef
                ? []
                : filterByPath(
                      await resolveBaseRows(path, {
                          root: vault,
                          today: today(),
                      }),
                      entries,
                      r => r.file.path,
                  )
            const result = runView(parsedBase.config, rows)

            if (CHART_KINDS.has(result.view.type)) {
                // Chart kinds (bar/line/stat/heatmap) compute an aggregated series over the view's
                // own filtered rows (grouping doesn't apply to a chart, so the groups are flattened
                // back out first) — the exact input BarView/LineView/StatView/HeatmapView
                // (app/src/bases/*.tsx) feed to buildChartData client-side.
                const flatRows = result.groups.flatMap(g => g.rows)
                const chart = buildChartData(flatRows, result.view)
                const payload: Record<string, unknown> = {
                    view: result.view,
                    chart,
                }
                if (result.view.type === 'heatmap')
                    payload.heatmapWeeks = buildHeatmapWeeks(chart.points).weeks
                if (result.view.type === 'stat')
                    payload.metrics = metricResults(
                        flatRows,
                        result.view,
                        today(),
                    )
                out(payload, args)
                return
            }

            out(result, args)
        },
    },

    rows: {
        summary:
            'Resolve a source (base | notes | files | tasks) to rows, following composition',
        usage: "[--of '[[Base]]' | --where EXPR | --files [EXPR] | --tasks DSL]",
        run: async args => {
            const vault = requireVault(args)
            const of = flag(args, 'of')
            const where = flag(args, 'where')
            const tasks = flag(args, 'tasks')
            // `--files` may stand alone (every file) or carry a where-expression.
            const filesArg = flag(args, 'files')
            const files = bool(args, 'files') || filesArg !== undefined
                ? filesArg && !filesArg.startsWith('--') ? filesArg : ''
                : undefined

            // Construct a SourceSpec from exactly one selector. `--of` composes another base;
            // `--tasks` runs a task DSL (its value is the where-expression); `--files` lists every
            // vault file (notes and attachments), its value an optional where-expression;
            // `--where` filters vault notes. With no selector, default to all vault notes.
            let spec: SourceSpec
            if (of !== undefined) spec = { kind: 'base', ref: of }
            else if (files !== undefined)
                spec = { kind: 'files', where: files || undefined }
            else if (tasks !== undefined)
                spec = { kind: 'tasks', where: tasks || undefined }
            else if (where !== undefined) spec = { kind: 'notes', where }
            else spec = { kind: 'notes' }

            const entries = await agentDenyEntries(vault)
            // Same as `base render`: a hidden ref looks exactly like a missing one.
            if (await readsDeniedBase(vault, spec, entries)) {
                out([], args)
                return
            }
            const resolved = filterByPath(
                await resolveSource(spec, {
                    root: vault,
                    today: today(),
                }),
                entries,
                r => r.file.path,
            )
            out(resolved, args)
        },
    },

    'row add': {
        summary: "Append a row to a base's table (fields from --json)",
        usage: "<basePath> --json '{...}'",
        run: async args => {
            const vault = requireVault(args)
            const [givenPath] = positionals(args)
            if (!givenPath) fail('<basePath> required')
            const basePath = resolveBasePath(vault, givenPath)
            const note = requireJson(args)
            const { text, name } = await readBase(vault, basePath)
            const next = upsertRow(text, { name, path: basePath }, null, note)
            await writeNote(vault, basePath, next)
            out({ ok: true }, args)
        },
    },

    'row update': {
        summary:
            "Replace the row at <index> in a base's table (fields from --json)",
        usage: "<basePath> <index> --json '{...}'",
        run: async args => {
            const vault = requireVault(args)
            const [givenPath, indexStr] = positionals(args)
            if (!givenPath) fail('<basePath> required')
            const basePath = resolveBasePath(vault, givenPath)
            const index = intArg(indexStr, '<index>')
            const note = requireJson(args)
            const { text, name } = await readBase(vault, basePath)
            const next = upsertRow(text, { name, path: basePath }, index, note)
            await writeNote(vault, basePath, next)
            out({ ok: true }, args)
        },
    },

    'row set': {
        summary:
            'Merge fields into the one row of a collection whose <field> equals <value>, keeping the fields not named; null in --json removes a field. Fails when no row or several rows match',
        usage: "<basePath> --match <field>=<value> --json '{...}'",
        run: async args => {
            const vault = requireVault(args)
            const [givenPath] = positionals(args)
            if (!givenPath) fail('<basePath> required')
            const match = flag(args, 'match')
            const eq = match?.indexOf('=') ?? -1
            if (!match || eq < 1) fail('--match <field>=<value> required')
            const basePath = resolveBasePath(vault, givenPath)
            const patch = requireJson(args)
            const { text, name } = await readBase(vault, basePath)
            const next = patchRowWhere(
                text,
                { name, path: basePath },
                match.slice(0, eq),
                match.slice(eq + 1),
                patch,
            )
            await writeNote(vault, basePath, next)
            out({ ok: true }, args)
        },
    },

    'row delete': {
        summary: "Remove the row at <index> from a base's table",
        usage: '<basePath> <index>',
        run: async args => {
            const vault = requireVault(args)
            const [givenPath, indexStr] = positionals(args)
            if (!givenPath) fail('<basePath> required')
            const basePath = resolveBasePath(vault, givenPath)
            const index = intArg(indexStr, '<index>')
            const { text, name } = await readBase(vault, basePath)
            const next = deleteRow(text, { name, path: basePath }, index)
            await writeNote(vault, basePath, next)
            out({ ok: true }, args)
        },
    },

    'row reorder': {
        summary: "Move a base's table row from one position to another",
        usage: '<basePath> <from> <to>',
        run: async args => {
            const vault = requireVault(args)
            const [givenPath, fromStr, toStr] = positionals(args)
            if (!givenPath) fail('<basePath> required')
            const basePath = resolveBasePath(vault, givenPath)
            const from = intArg(fromStr, '<from>')
            const to = intArg(toStr, '<to>')
            const { text, name } = await readBase(vault, basePath)
            const next = reorderRow(text, { name, path: basePath }, from, to)
            await writeNote(vault, basePath, next)
            out({ ok: true }, args)
        },
    },

    'base migrate': {
        summary:
            'Convert a markdown base to a `.base.jsonl` file (the .md goes to the vault trash). <basePath> or --all; --dry-run prints the plan and writes nothing',
        usage: '<basePath> | --all [--dry-run]',
        run: async args => {
            const vault = requireVault(args)
            const dryRun = bool(args, 'dry-run')
            const [given] = positionals(args, [...BOOLEAN_FLAGS, 'all'])
            const all = bool(args, 'all')
            if (!given && !all) fail('<basePath> or --all required')
            if (given && all) fail('pass <basePath> or --all, not both')
            const entries = await agentDenyEntries(vault)

            // Converts one base: returns the report line. Throws an AppError on a refusal.
            const migrateOne = async (rawFrom: string): Promise<string> => {
                const from = normalizeVaultPath(rawFrom)
                if (isDeniedPath(entries, from))
                    throw createError('EACCES', `not available: ${from}`, 403)
                if (!/\.md$/i.test(from))
                    throw createError(
                        'EINVAL',
                        `${from} is not a markdown base — base migrate converts \`.md\` bases to \`${BASE_EXT}\``,
                        400,
                    )
                const text = await readNote(vault, from)
                if (baseFormatOf(text) !== 'md' || !isBaseText(text))
                    throw createError(
                        'EINVAL',
                        `${from} is not a \`type: base\` markdown file`,
                        400,
                    )
                const to = `${from.replace(/\.md$/i, '')}${BASE_EXT}`
                if (fileExists(vault, to)) {
                    // A hidden target must not be confirmed to exist by name.
                    if (isDeniedPath(entries, to))
                        throw createError(
                            'EACCES',
                            `not available: ${from}`,
                            403,
                        )
                    throw createError(
                        'EEXIST',
                        `${to} already exists — move or delete it, then rerun \`bismuth base migrate ${from}\``,
                        409,
                    )
                }
                const jsonl = convertMdBaseToJsonl(text)
                const rows = jsonl.split('\n').filter(l => l.trim()).length - 1
                const bodyLines = (text.match(FRONTMATTER_RE)?.[3] ?? '')
                    .split('\n')
                    .filter(l => l.trim() !== '')
                // A GFM table with a header and separator but no rows is a valid empty base.
                const headerOnly =
                    bodyLines.length === 2 &&
                    /^\s*\|.*\|\s*$/.test(bodyLines[0]) &&
                    /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(
                        bodyLines[1],
                    )
                if (rows === 0 && bodyLines.length > 0 && !headerOnly)
                    throw createError(
                        'EINVAL',
                        `${from} has body text but no parseable rows — fix the table/list first`,
                        400,
                    )
                // Lines that are neither a table row nor a YAML list item or its continuation.
                const dropped = bodyLines.filter(
                    l => !/^(\||-|\s)/.test(l),
                ).length
                const droppedNote = headerOnly
                    ? ', dropped the table header (no rows)'
                    : dropped
                      ? `, dropped ${dropped} non-row lines`
                      : ''
                // The legacy global Google sync setting names this base by path; carry it onto the
                // migrated base so sync keeps matching after the rename.
                const gc = (await loadAppConfig(vault)).googleCalendar
                let outText = jsonl
                if (gc?.basePath && normalizeVaultPath(gc.basePath) === from)
                    outText = mutateBaseConfig(jsonl, raw => {
                        if (raw.googleCalendarSync === undefined)
                            raw.googleCalendarSync = !!gc.enabled
                        if (!raw.googleCalendarId && gc.calendarId?.trim())
                            raw.googleCalendarId = gc.calendarId.trim()
                    })
                if (!dryRun) {
                    // Google sync state is keyed by base path: carry it onto the new path, or the
                    // next sync starts with no links and duplicates every event on Google. The
                    // bare legacy key is claimed only by the installed app, exactly as core's
                    // sync does.
                    const claimLegacy = !!process.env.BISMUTH_APP_PATH
                    const oldKey = manifestKey(vault, from)
                    const peek = readManifest()
                    const linked = !!(
                        peek.bases[oldKey] ??
                        (claimLegacy ? peek.bases[from] : undefined)
                    )
                    createEntry(vault, to, 'file')
                    try {
                        // A held sync lock fails here, before anything is written; the lock then
                        // covers the write AND the re-key.
                        if (linked)
                            await withSyncLock(async () => {
                                await writeNote(vault, to, outText)
                                const r = rekeyBaseSyncUnlocked(
                                    vault,
                                    from,
                                    to,
                                    {
                                        claimLegacy,
                                    },
                                )
                                // Trash inside the lock: a failure puts the key back, and no
                                // queued sync can see Cal.md again under the old key.
                                try {
                                    deleteEntry(vault, from)
                                } catch (e) {
                                    r.restore()
                                    throw e
                                }
                            })
                        else await writeNote(vault, to, outText)
                    } catch (err) {
                        // Leave no half-made target behind, so a rerun succeeds.
                        rmSync(join(vault, to), { force: true })
                        throw err
                    }
                    if (!linked) deleteEntry(vault, from)
                }
                return `${dryRun ? 'would migrate' : 'migrated'} ${from} -> ${to} (${rows} rows${droppedNote})`
            }

            if (!all) {
                const from = resolveBasePath(vault, given)
                out(await migrateOne(from), args)
                return
            }
            const lines: string[] = []
            for (const rel of (await listMarkdown(vault)).sort()) {
                if (isDeniedPath(entries, rel)) continue
                let text: string
                try {
                    text = await readNote(vault, rel)
                } catch {
                    continue
                }
                if (baseFormatOf(text) !== 'md' || !isBaseText(text)) continue
                try {
                    lines.push(await migrateOne(rel))
                } catch (err) {
                    lines.push(
                        `skipped ${rel}: ${err instanceof Error ? err.message : String(err)}`,
                    )
                }
            }
            out(
                lines.length
                    ? lines.join('\n')
                    : 'no markdown bases to migrate',
                args,
            )
        },
    },

    'base migrate-queries': {
        summary:
            'Rewrite ```query blocks whose tasks: still holds legacy Tasks-DSL text into tasks: + where: + sort:. Optional — the translation shim reads the old form forever. --dry-run reports per-file counts and writes nothing',
        usage: '[--dry-run]',
        run: async args => {
            const vault = requireVault(args)
            const dryRun = bool(args, 'dry-run')
            // Skip restricted notes at the source, so neither a write nor the report names one.
            const rels = filterByPath(
                await listMarkdown(vault),
                await agentDenyEntries(vault),
                rel => rel,
            )
            const files: Array<{ file: string; changed: number }> = []
            const unconvertible: Array<{ file: string; block: number }> = []
            const degraded: Array<{
                file: string
                block: number
                leaves: string[]
            }> = []
            const skipped: Array<{ file: string; error: string }> = []
            let changed = 0
            const todayIso = today()
            // Each file's read/migrate/write is its own try/catch, exactly like `task
            // migrate` — one unreadable file cannot abort the run and leave the vault
            // half migrated.
            for (const rel of rels) {
                try {
                    const text = await readNote(vault, rel)
                    // findQueryFences walks lines split on `\n` — deliberately not
                    // taught to tolerate a stray `\r`, the way editor/queryBlock.ts's
                    // own fence matcher never sees CRLF either (CodeMirror normalizes
                    // line endings on load). That fails SAFE — nothing gets corrupted —
                    // but silently: every query block in the file would otherwise go
                    // unreported, reading as "nothing to migrate" rather than "couldn't
                    // check". Report it instead of matching by contorting the parser.
                    if (text.includes('\r\n')) {
                        skipped.push({
                            file: rel,
                            error: 'CRLF line endings — the query-fence scanner only supports LF, so this file was not checked for legacy query blocks. Convert to LF to migrate.',
                        })
                        continue
                    }
                    let changedHere = 0
                    let cursor = 0
                    const segments: string[] = []
                    findQueryFences(text).forEach((fence, block) => {
                        segments.push(text.slice(cursor, fence.bodyFrom))
                        const result = migrateQueryBody(fence.body, todayIso)
                        if (result === null) {
                            unconvertible.push({ file: rel, block })
                            segments.push(fence.body)
                        } else if (!result.changed) {
                            segments.push(fence.body)
                        } else {
                            changedHere++
                            const leaves = [
                                ...(result.unrecognized ?? []),
                                ...(result.ignored ?? []),
                            ]
                            if (leaves.length)
                                degraded.push({ file: rel, block, leaves })
                            segments.push(result.body)
                        }
                        cursor = fence.bodyTo
                    })
                    segments.push(text.slice(cursor))
                    const next = segments.join('')
                    if (changedHere > 0) {
                        if (!dryRun) await writeNote(vault, rel, next)
                        files.push({ file: rel, changed: changedHere })
                        changed += changedHere
                    }
                } catch (err) {
                    skipped.push({
                        file: rel,
                        error: err instanceof Error ? err.message : String(err),
                    })
                }
            }
            out({ changed, files, unconvertible, degraded, skipped }, args)
        },
    },
}
