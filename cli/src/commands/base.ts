// Bases + rows command group for the `bismuth` CLI.
// Mirrors core's POST /rows and /row/* handlers: parse a base file's rows,
// resolve a SourceSpec to a uniform Row[], or mutate a base's GFM table rows.
// Mutating commands call core directly — the app's file watcher picks up the
// writes live, no HTTP server required.
import type { CommandMap } from '../types'
import { bool, fail, flag, out, positionals, requireVault, today } from '../args'
import {
    createEntry,
    listMarkdown,
    readNote,
    writeNote,
} from '../../../core/src/files'
import {
    setFrontmatterKey,
    parseFrontmatter,
} from '../../../core/src/frontmatter'
import { parseBaseFile } from '../../../core/src/bases/parse'
import { resolveSource, resolveBaseRows } from '../../../core/src/bases/source'
import { refToPath } from '../../../core/src/bases/sourceSpec'
import { parseQueryBlock } from '../../../core/src/bases/queryBlock'
import { looksLikeTaskDsl, translateTaskDsl } from '../../../core/src/bases/taskDsl'
import {
    upsertRow,
    deleteRow,
    reorderRow,
} from '../../../core/src/bases/rowOps'
import { fileBasename } from '../../../core/src/pathUtils'
import {
    VIEW_TYPES,
    isValidType,
    type SourceSpec,
    type FilterNode,
} from '../../../core/src/bases/types'
import { runView } from '../../../core/src/bases/query'
import {
    buildChartData,
    buildHeatmapWeeks,
} from '../../../core/src/bases/chart'
import { parseExpr } from '../../../core/src/bases/parser'
import {
    validatePropertyValue,
    declaredFormulas,
} from '../../../core/src/bases/properties'

// Mirrors editor/queryBlock.ts's QUERY_FENCE: the one embedded block that reads into a
// base/notes. Kept local rather than exported from core because this is the only other
// place that ever needs to find one in raw markdown (a one-off vault migration), and
// core has no dependency on the app's editor module.
const QUERY_FENCE = /```query[ \t]*\n([\s\S]*?)\n```/g

/** Locate the `tasks:` key's raw line range in a flat ```query block body — a single
 *  line (`tasks: not done`) or a YAML block scalar (`tasks: |-` + more-indented lines) —
 *  mirroring the block-scalar rule `parseQueryBlock` uses to read the same key. Returns
 *  the [from, to) line indices to splice out, or null when there is no `tasks:` key. */
function findTasksLineRange(
    lines: string[],
): { from: number; to: number } | null {
    const indentOf = (s: string): number =>
        s.length - s.replace(/^\s*/, '').length
    for (let idx = 0; idx < lines.length; idx++) {
        const raw = lines[idx]
        const l = raw.trim()
        if (!l) continue
        const i = l.indexOf(':')
        if (i <= 0) continue
        if (l.slice(0, i).trim() !== 'tasks') continue
        const val = l.slice(i + 1).trim()
        let end = idx
        if (/^[|>][+-]?$/.test(val)) {
            const keyIndent = indentOf(raw)
            while (end + 1 < lines.length) {
                const nx = lines[end + 1]
                if (nx.trim() === '') {
                    end++
                    continue
                }
                if (indentOf(nx) <= keyIndent) break
                end++
            }
        }
        return { from: idx, to: end + 1 }
    }
    return null
}

/** Rewrite one ```query block body's legacy `tasks: <dsl>` into `tasks:` + `where:` +
 *  `sort:`, via the same translateTaskDsl shim source.ts applies at read time. Every
 *  other line is left byte-for-byte alone (comments, unrelated keys, ordering).
 *
 *  Returns `{changed: false}` when there's nothing to migrate (no tasks: source, or the
 *  tasks: value is already a Bases expression / empty — i.e. already migrated, which is
 *  what makes running this twice a no-op). Returns `null` — "cannot convert" — in two
 *  cases, both left untouched and reported by the caller rather than guessed at:
 *  - the block already carries its OWN `where:`/`sort:` key: overwriting either would
 *    silently discard a per-view filter or sort a person wrote on purpose, and merging
 *    into it would guess at semantics (source-filter vs view-filter) this tool has no
 *    business guessing.
 *  - a `sort by priority` DSL line translates to a `note.priority` SortSpec. That sort
 *    only ranks by urgency (highest..lowest, not alphabetically) when applyTaskSort runs
 *    it — which happens for a legacy DSL `tasks:` value, at the SOURCE level. The modern
 *    `sort:` key runs through the view-level generic comparator instead (query.ts's
 *    runView), which has no such rank table, so writing `sort: note.priority` would
 *    silently reorder these rows alphabetically. There is no lossless modern spelling
 *    for a priority sort yet, so the block is left in its (still fully working, still
 *    rank-sorted) legacy form. */
function migrateQueryBody(
    body: string,
    todayIso: string,
): { body: string; changed: boolean } | null {
    const qb = parseQueryBlock(body)
    if (qb.source?.kind !== 'tasks' || !qb.source.where)
        return { body, changed: false }
    if (!looksLikeTaskDsl(qb.source.where)) return { body, changed: false }
    if (qb.where !== undefined || qb.sort !== undefined) return null

    const translated = translateTaskDsl(qb.source.where, todayIso)
    if (translated.sort?.some(s => s.property === 'note.priority')) return null

    const range = findTasksLineRange(body.split('\n'))
    if (!range) return { body, changed: false }

    const replacement: string[] = ['tasks:']
    if (translated.where) replacement.push(`where: ${translated.where}`)
    if (translated.sort?.length) {
        const sortStr = translated.sort
            .map(s => (s.direction === 'DESC' ? `${s.property} desc` : s.property))
            .join(', ')
        replacement.push(`sort: ${sortStr}`)
    }
    const lines = body.split('\n')
    const next = [
        ...lines.slice(0, range.from),
        ...replacement,
        ...lines.slice(range.to),
    ].join('\n')
    return { body: next, changed: true }
}

const CHART_KINDS = new Set(['bar', 'line', 'stat', 'heatmap'])

/** Read a base file's note text + metadata (name, path) the way core does. */
async function readBase(
    vault: string,
    file: string,
): Promise<{ text: string; name: string }> {
    const text = await readNote(vault, file)
    return { text, name: fileBasename(file) }
}

/** Parse a required `--json '{...}'` flag into a note record (the row's fields). */
function requireJson(args: string[]): Record<string, unknown> {
    const raw = flag(args, 'json')
    if (raw === undefined) fail("--json '{...}' required")
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return fail('--json is not valid JSON')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail('--json must be a JSON object')
    }
    return parsed as Record<string, unknown>
}

/** Parse an integer positional, failing on a non-number. */
function intArg(raw: string | undefined, label: string): number {
    const n = Number(raw)
    if (raw === undefined || !Number.isInteger(n))
        fail(`${label} must be an integer`)
    return n
}

/** Recursively collect bases-expression parse failures out of a FilterNode (a bare
 *  string expr, or an and/or/not tree of them) — the same expressions `passesFilter`
 *  (filters.ts) evaluates at render time, but silently: a parse failure there just
 *  makes the filter act as `false`, with no diagnostic anywhere. `label` is the
 *  JSON-path-ish prefix used in the reported error string. */
function collectExprErrors(
    node: FilterNode | undefined,
    label: string,
    errors: string[],
): void {
    if (node === undefined) return
    if (typeof node === 'string') {
        try {
            parseExpr(node)
        } catch (e) {
            errors.push(
                `${label}: "${node}" failed to parse — ${e instanceof Error ? e.message : String(e)}`,
            )
        }
        return
    }
    if ('and' in node)
        node.and.forEach((n, i) =>
            collectExprErrors(n, `${label}.and[${i}]`, errors),
        )
    else if ('or' in node)
        node.or.forEach((n, i) =>
            collectExprErrors(n, `${label}.or[${i}]`, errors),
        )
    else if ('not' in node)
        node.not.forEach((n, i) =>
            collectExprErrors(n, `${label}.not[${i}]`, errors),
        )
}

/** Best-effort raw YAML frontmatter object, for checks that need to see what was
 *  ACTUALLY written before `parseBaseFile`'s malformed-tolerant normalizer silently
 *  downgrades a bad value — e.g. an unrecognized `views[].type` becomes "table"
 *  (parse.ts's `normalizeView`), which would hide exactly the mistake `base validate`
 *  exists to catch. `{}` when there's no frontmatter block or it isn't valid YAML
 *  (parseFrontmatter's own malformed-YAML tolerance — see frontmatter.ts). */
function rawFrontmatter(text: string): Record<string, unknown> {
    return parseFrontmatter(text).data
}

/** The vault-relative wikilink `ref`/`from` a resolved SourceSpec names, or undefined
 *  when the spec carries neither (nothing for `base validate` to resolve-check). */
function sourceRefTarget(spec: SourceSpec): string | undefined {
    return spec.kind === 'base' ? spec.ref : spec.from
}

export const commands: CommandMap = {
    'base create': {
        summary: 'Create a new type:base note with a single view',
        usage: '<path> --view <kind> [--source <spec>] [--title <t>] [--group-by <property>] [--lat <property>] [--lng <property>] [--x <property>]',
        run: async args => {
            const vault = requireVault(args)
            const [path] = positionals(args)
            if (!path) fail('<path> required')
            const rel = path.endsWith('.md') ? path : `${path}.md`

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
            const title = flag(args, 'title') ?? fileBasename(rel)

            // Some view kinds render nothing (or a hint message) without their key config —
            // rather than silently omit it, write the key with a blank value AND report it
            // as `missing` in the result, so an agent creating a base sees exactly what it
            // still has to fill in.
            const viewConfig: Record<string, unknown> = {
                type: view,
                name: title,
            }
            const missing: string[] = []

            if (view === 'kanban') {
                const groupBy = flag(args, 'group-by')
                viewConfig.groupBy = { property: groupBy ?? '' }
                if (!groupBy) missing.push('groupBy')
            } else if (view === 'map') {
                const lat = flag(args, 'lat')
                const lng = flag(args, 'lng')
                viewConfig.lat = lat ?? ''
                viewConfig.lng = lng ?? ''
                if (!lat) missing.push('lat')
                if (!lng) missing.push('lng')
            } else if (
                view === 'bar' ||
                view === 'line' ||
                view === 'stat' ||
                view === 'heatmap'
            ) {
                const x = flag(args, 'x')
                viewConfig.x = x ?? ''
                if (!x) missing.push('x')
            }

            // Build the frontmatter via the same yaml-preserving helper `prop set`/`row add`
            // use, one key at a time, rather than hand-rolling YAML serialization here.
            let text = setFrontmatterKey('', 'type', 'base')
            text = setFrontmatterKey(text, 'source', source)
            text = setFrontmatterKey(text, 'views', [viewConfig])

            // Reserve the path first (throws EEXIST if a file is already there — no clobbering
            // an existing note), then write the real config.
            createEntry(vault, rel, 'file')
            await writeNote(vault, rel, text)

            const result: Record<string, unknown> = {
                ok: true,
                path: rel,
                view,
                source,
                title,
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
            const [path] = positionals(args)
            if (!path) fail('<path> required')
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
            const [path] = positionals(args)
            if (!path) fail('<path> required')
            const { text, name } = await readBase(vault, path)
            const errors: string[] = []

            // 1. Unknown view types. `parseBaseFile`'s normalizer is malformed-YAML-tolerant —
            // an invalid `views[i].type` (or the `view: <type>` shorthand) silently downgrades
            // to "table" instead of throwing (parse.ts's normalizeView), which is exactly the
            // mistake this command exists to surface. Read the raw YAML directly to see what
            // was actually written, before that normalizing happens.
            const raw = rawFrontmatter(text)
            if (Array.isArray(raw.views)) {
                raw.views.forEach((v, i) => {
                    const t =
                        v && typeof v === 'object'
                            ? (v as Record<string, unknown>).type
                            : undefined
                    if (t !== undefined && !isValidType(t)) {
                        errors.push(
                            `views[${i}].type: ${JSON.stringify(t)} is not a valid view type — must be one of: ${VIEW_TYPES.join(', ')}`,
                        )
                    }
                })
            } else if (typeof raw.view === 'string' && !isValidType(raw.view)) {
                errors.push(
                    `view: ${JSON.stringify(raw.view)} is not a valid view type — must be one of: ${VIEW_TYPES.join(', ')}`,
                )
            }

            const { config } = parseBaseFile(text, { name, path })

            // 2. Declared properties: each `default` value — a value written directly inside the
            // `properties:` block — must satisfy validatePropertyValue for its declared `type`.
            // This is the "not yet wired into write paths" validator (properties.ts) getting its
            // first caller.
            if (config.properties) {
                for (const [propName, def] of Object.entries(
                    config.properties,
                )) {
                    if (!def.type || def.default === undefined) continue
                    const diag = validatePropertyValue(def.type, def.default)
                    if (diag)
                        errors.push(
                            `properties.${propName}.default: ${diag.message}`,
                        )
                }
            }

            // 3. Sources (base-level default + any per-view override) that name a base/note
            // which doesn't exist, or a `where` expression that fails to parse. resolveSource/
            // resolveBaseRows are deliberately tolerant here (an unresolvable ref just resolves
            // to zero rows, no throw — see source.ts) — validate exists to surface exactly the
            // failure that silent path hides.
            const sourcesToCheck: { label: string; spec: SourceSpec }[] = []
            if (config.source)
                sourcesToCheck.push({ label: 'source', spec: config.source })
            config.views.forEach((v, i) => {
                if (v.source)
                    sourcesToCheck.push({
                        label: `views[${i}].source`,
                        spec: v.source,
                    })
            })
            for (const { label, spec } of sourcesToCheck) {
                const ref = sourceRefTarget(spec)
                if (ref) {
                    const refPath = refToPath(ref)
                    try {
                        await readNote(vault, refPath)
                    } catch {
                        errors.push(
                            `${label}: "${ref}" does not resolve to a file in the vault (looked for ${refPath})`,
                        )
                    }
                }
                if (spec.kind !== 'base' && spec.where)
                    collectExprErrors(spec.where, `${label}.where`, errors)
            }

            // Bonus: global + per-view filters, and every formula (including a declared
            // `{type: formula}` property's `expr`) that fails to parse — passesFilter/
            // computeFormulas (query.ts) both swallow a parse error silently instead of
            // surfacing it.
            collectExprErrors(config.filters, 'filters', errors)
            config.views.forEach((v, i) =>
                collectExprErrors(v.filters, `views[${i}].filters`, errors),
            )
            const formulas = { ...declaredFormulas(config), ...config.formulas }
            for (const [formulaName, src] of Object.entries(formulas)) {
                try {
                    parseExpr(src)
                } catch (e) {
                    errors.push(
                        `formulas.${formulaName}: "${src}" failed to parse — ${e instanceof Error ? e.message : String(e)}`,
                    )
                }
            }

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
        usage: '<path> [--view <n>]',
        run: async args => {
            const vault = requireVault(args)
            const [path] = positionals(args)
            if (!path) fail('<path> required')

            const viewFlag = flag(args, 'view')
            const viewIndex = viewFlag === undefined ? 0 : Number(viewFlag)
            if (!Number.isInteger(viewIndex) || viewIndex < 0)
                fail('--view must be a non-negative integer')

            const { text, name } = await readBase(vault, path)
            const { config } = parseBaseFile(text, { name, path })
            if (viewIndex >= config.views.length) {
                fail(
                    `--view ${viewIndex} out of range — this base has ${config.views.length} view(s): 0-${config.views.length - 1}`,
                )
            }

            // Same resolution the app uses to open THIS base file: its own inline table when it
            // declares no source, otherwise the source it declares (following composition) —
            // resolveBaseRows, not a spec built from `bismuth rows`' generic --of/--where/--tasks
            // flags, since we already have this one base's own parsed config to resolve from.
            const rows = await resolveBaseRows(path, {
                root: vault,
                today: today(),
            })
            const result = runView(config, rows, viewIndex)

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
                out(payload, args)
                return
            }

            out(result, args)
        },
    },

    rows: {
        summary:
            'Resolve a source (base | notes | tasks) to rows, following composition',
        usage: "[--of '[[Base]]' | --where EXPR | --tasks DSL]",
        run: async args => {
            const vault = requireVault(args)
            const of = flag(args, 'of')
            const where = flag(args, 'where')
            const tasks = flag(args, 'tasks')

            // Construct a SourceSpec from exactly one selector. `--of` composes another base;
            // `--tasks` runs a task DSL (its value is the where-expression); `--where` filters
            // vault notes. With no selector, default to all vault notes (kind: notes).
            let spec: SourceSpec
            if (of !== undefined) spec = { kind: 'base', ref: of }
            else if (tasks !== undefined)
                spec = { kind: 'tasks', where: tasks || undefined }
            else if (where !== undefined) spec = { kind: 'notes', where }
            else spec = { kind: 'notes' }

            const resolved = await resolveSource(spec, {
                root: vault,
                today: today(),
            })
            out(resolved, args)
        },
    },

    'row add': {
        summary: "Append a row to a base's table (fields from --json)",
        usage: "<basePath> --json '{...}'",
        run: async args => {
            const vault = requireVault(args)
            const [basePath] = positionals(args)
            if (!basePath) fail('<basePath> required')
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
            const [basePath, indexStr] = positionals(args)
            if (!basePath) fail('<basePath> required')
            const index = intArg(indexStr, '<index>')
            const note = requireJson(args)
            const { text, name } = await readBase(vault, basePath)
            const next = upsertRow(text, { name, path: basePath }, index, note)
            await writeNote(vault, basePath, next)
            out({ ok: true }, args)
        },
    },

    'row delete': {
        summary: "Remove the row at <index> from a base's table",
        usage: '<basePath> <index>',
        run: async args => {
            const vault = requireVault(args)
            const [basePath, indexStr] = positionals(args)
            if (!basePath) fail('<basePath> required')
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
            const [basePath, fromStr, toStr] = positionals(args)
            if (!basePath) fail('<basePath> required')
            const from = intArg(fromStr, '<from>')
            const to = intArg(toStr, '<to>')
            const { text, name } = await readBase(vault, basePath)
            const next = reorderRow(text, { name, path: basePath }, from, to)
            await writeNote(vault, basePath, next)
            out({ ok: true }, args)
        },
    },

    'base migrate-queries': {
        summary:
            'Rewrite ```query blocks whose tasks: still holds legacy Tasks-DSL text into tasks: + where: + sort:. Optional — the translation shim reads the old form forever. --dry-run reports per-file counts and writes nothing',
        usage: '[--dry-run]',
        run: async args => {
            const vault = requireVault(args)
            const dryRun = bool(args, 'dry-run')
            const rels = await listMarkdown(vault)
            const files: Array<{ file: string; changed: number }> = []
            const unconvertible: Array<{ file: string; block: number }> = []
            const skipped: Array<{ file: string; error: string }> = []
            let changed = 0
            const todayIso = today()
            // Each file's read/migrate/write is its own try/catch, exactly like `task
            // migrate` — one unreadable file cannot abort the run and leave the vault
            // half migrated.
            for (const rel of rels) {
                try {
                    const text = await readNote(vault, rel)
                    let changedHere = 0
                    let block = -1
                    const next = text.replace(QUERY_FENCE, (whole, body: string) => {
                        block++
                        const result = migrateQueryBody(body, todayIso)
                        if (result === null) {
                            unconvertible.push({ file: rel, block })
                            return whole
                        }
                        if (!result.changed) return whole
                        changedHere++
                        return '```query\n' + result.body + '\n```'
                    })
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
            out({ changed, files, unconvertible, skipped }, args)
        },
    },
}
