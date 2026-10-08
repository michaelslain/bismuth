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
    resolveRefPath,
} from '../../../core/src/bases/source'
import {
    findCommentTruncations,
    type TruncatedScalar,
} from '../../../core/src/bases/yamlComment'
import { parseQueryBlock } from '../../../core/src/bases/queryBlock'
import {
    looksLikeTaskDsl,
    translateTaskDsl,
} from '../../../core/src/bases/taskDsl'
import {
    upsertRow,
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
    readBaseConfigRaw,
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
    type DenyEntry,
} from '../../../core/src/visibilityFilter'
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
import { metricResults } from '../../../core/src/bases/metrics'
import { parseExpr } from '../../../core/src/bases/parser'
import {
    validatePropertyValue,
    declaredFormulas,
} from '../../../core/src/bases/properties'

interface FenceMatch {
    from: number // start of the opening delimiter line
    to: number // end of the closing delimiter line (exclusive)
    bodyFrom: number // start of the body, just past the opening line's own newline
    bodyTo: number // end of the body, just before the closing line's own newline
    body: string
}

/** Find every TOP-LEVEL ```query fence in raw markdown text — a live block a rendered
 *  note would actually turn into a BaseView, as opposed to a ```query fence quoted
 *  INSIDE a larger fence to show a worked example (docs/bases/query-block.md does this
 *  throughout, via a ` ````markdown ` wrapper).
 *
 *  editor/queryBlock.ts's own QUERY_FENCE — `/^```query[ \t]*\n([\s\S]*?)\n```/gm` — is
 *  line-anchored but NOT nesting-aware: a 3-backtick "```query" still starts at column 0
 *  of its own line even when it's nested inside a 4-backtick wrapper, so that regex (and
 *  an earlier, non-anchored version of this function) matches — and this tool then
 *  REWRITES — the example instead of leaving it as documentation. CommonMark's actual
 *  rule is that a fence can only be closed by a run of backticks AT LEAST as long as the
 *  one that opened it, which is exactly what lets a longer run safely quote a shorter one
 *  as literal text. This walks the document tracking ONE open fence's backtick count at a
 *  time and applies that rule, so a ```query nested inside a ````-or-longer fence is
 *  correctly read as part of the OUTER fence's body, never as a live block of its own. */
function findQueryFences(text: string): FenceMatch[] {
    const lines = text.split('\n')
    const lineOffsets: number[] = []
    let offset = 0
    for (const line of lines) {
        lineOffsets.push(offset)
        offset += line.length + 1
    }

    const out: FenceMatch[] = []
    let openLen = 0 // backtick run length of the currently open fence; 0 = not in one
    let openIsQuery = false
    let openStartLine = -1

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (openLen === 0) {
            const m = line.match(/^(`{3,})(.*)$/)
            if (m) {
                openLen = m[1].length
                openIsQuery = m[2].trim() === 'query'
                openStartLine = i
            }
            continue
        }
        // A closing fence is a run of backticks with nothing after but whitespace, AT
        // LEAST as long as the run that opened it — a shorter run (or one followed by
        // other text) is just body content, exactly like inside a real editor.
        const m = line.match(/^(`{3,})\s*$/)
        if (m && m[1].length >= openLen) {
            if (openIsQuery) {
                const bodyFrom =
                    lineOffsets[openStartLine] + lines[openStartLine].length + 1
                const bodyTo = lineOffsets[i] - 1
                out.push({
                    from: lineOffsets[openStartLine],
                    to: lineOffsets[i] + line.length,
                    bodyFrom,
                    bodyTo,
                    body: text.slice(bodyFrom, bodyTo),
                })
            }
            openLen = 0
            openIsQuery = false
        }
    }
    return out
}

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
 *  `sort:`, via the same translateTaskDsl shim source.ts applies at read time — with
 *  `liveDates: true`, so a relative date word (`tomorrow`, `in 3 days`, …) is written out
 *  as a live `today()`-relative Bases expression instead of a resolved literal. A
 *  migration runs ONCE; baking today's answer into the file would freeze it forever,
 *  where the un-migrated form re-resolves fresh on every render. Every other line is
 *  left byte-for-byte alone (comments, unrelated keys, ordering).
 *
 *  Returns `{changed: false}` when there's nothing to migrate (no tasks: source, or the
 *  tasks: value is already a Bases expression / empty — i.e. already migrated, which is
 *  what makes running this twice a no-op). Returns `null` — "cannot convert" — in two
 *  cases, both left untouched and reported by the caller rather than guessed at:
 *  - the block already carries its OWN `where:`/`sort:` key: overwriting either would
 *    silently discard a per-view filter or sort a person wrote on purpose, and merging
 *    into it would guess at semantics (source-filter vs view-filter) this tool has no
 *    business guessing.
 *  - a date leaf names a weekday (`due friday`) — `translateTaskDsl({liveDates:true})`
 *    has no live Bases form for that and reports it via `TaskDslTranslation.blocked`
 *    rather than freezing it; this tool honors that the same way.
 *
 *  A `sort by priority` DSL line translates to a `note.priority` SortSpec and IS written
 *  as a modern `sort:` key — the general Bases sort path (query.ts's `compareForSort`)
 *  ranks priority by urgency the same way `applyTaskSort` always did, so this no longer
 *  needs its own refusal. */
function migrateQueryBody(
    body: string,
    todayIso: string,
): {
    body: string
    changed: boolean
    unrecognized?: string[]
    ignored?: string[]
} | null {
    const qb = parseQueryBlock(body)
    if (qb.source?.kind !== 'tasks' || !qb.source.where)
        return { body, changed: false }
    if (!looksLikeTaskDsl(qb.source.where)) return { body, changed: false }
    if (qb.where !== undefined || qb.sort !== undefined) return null

    const translated = translateTaskDsl(qb.source.where, todayIso, {
        liveDates: true,
    })
    if (translated.blocked) return null

    const range = findTasksLineRange(body.split('\n'))
    if (!range) return { body, changed: false }

    const replacement: string[] = ['tasks:']
    if (translated.where) replacement.push(`where: ${translated.where}`)
    if (translated.sort?.length) {
        const sortStr = translated.sort
            .map(s =>
                s.direction === 'DESC' ? `${s.property} desc` : s.property,
            )
            .join(', ')
        replacement.push(`sort: ${sortStr}`)
    }
    const lines = body.split('\n')
    const next = [
        ...lines.slice(0, range.from),
        ...replacement,
        ...lines.slice(range.to),
    ].join('\n')
    return {
        body: next,
        changed: true,
        unrecognized: translated.unrecognized,
        ignored: translated.ignored,
    }
}

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

/** The raw frontmatter BODY between the `---` delimiters, unparsed. Needed for
 *  findCommentTruncations, which has to see exactly what was written before YAML parsing
 *  (or parseFrontmatter's own malformed-tolerance) has resolved a value — by the time a
 *  parser has answered, the text a comment ate is gone from its output. Reuses parse.ts's
 *  own frontmatter-boundary regex (its capture group [2] is documented there as this exact
 *  slice) rather than writing a third frontmatter splitter. '' when there's no frontmatter
 *  block. */
function frontmatterText(text: string): string {
    return text.match(FRONTMATTER_RE)?.[2] ?? ''
}

/** How many newlines sit BEFORE the frontmatter body within the whole file — the number
 *  to add to a `findCommentTruncations` line (which is 1-based within the body slice
 *  `frontmatterText` returns, per its own documented contract) to get the line a reader
 *  would actually find in their editor. Derived from the real match rather than a
 *  hardcoded `+1`: it counts the newlines in whatever precedes the body inside the
 *  matched frontmatter block, so it stays correct even if that prefix were ever more than
 *  the single opening `---` line it is today. 0 when there's no frontmatter block. */
function frontmatterLineOffset(text: string): number {
    const m = text.match(FRONTMATTER_RE)
    if (!m) return 0
    const bodyStart = m[1].indexOf(m[2])
    if (bodyStart < 0) return 0
    return (m[1].slice(0, bodyStart).match(/\n/g) ?? []).length
}

/** Rebuild the value exactly as the user wrote it, for a scalar `findCommentTruncations`
 *  found truncated. `t.kept` has its trailing whitespace stripped by the YAML parser and
 *  `t.dropped` has its leading whitespace stripped by findCommentTruncations itself — so
 *  neither carries the run of whitespace that actually triggered the truncation, and a
 *  naive `t.kept + t.dropped` silently deletes it. That whitespace is real content when it
 *  sits inside the user's own expression (`contains("a  #b")`), so losing it produces a
 *  fix that parses but matches something else.
 *
 *  TruncatedScalar itself isn't touched — its shape is pinned by
 *  core/test/bases/yamlComment.test.ts — so this reconstructs from the pieces it already
 *  exposes: `t.line` plus the same frontmatter body text locates the raw source line, and
 *  a plain YAML scalar has no escaping, so `kept` and `dropped` both appear in it
 *  byte-for-byte. Falls back to the lossy join only if that ever isn't true. */
function reconstructTruncatedValue(
    frontmatterBody: string,
    t: TruncatedScalar,
): string {
    const rawLine = frontmatterBody.split(/\r?\n/)[t.line - 1] ?? ''
    const keptAt = rawLine.indexOf(t.kept)
    const droppedAt = rawLine.lastIndexOf(t.dropped)
    if (keptAt < 0 || droppedAt < keptAt + t.kept.length)
        return `${t.kept}${t.dropped}`
    return rawLine.slice(keptAt, droppedAt + t.dropped.length)
}

/** Wrap a value as a YAML single-quoted scalar, doubling any embedded `'` — YAML's own
 *  escape for one inside single quotes. Without it a truncated value containing an
 *  apostrophe pastes back as invalid YAML. */
function singleQuoteYaml(value: string): string {
    return `'${value.replace(/'/g, "''")}'`
}

/** The vault-relative wikilink `ref`/`from` a resolved SourceSpec names, or undefined
 *  when the spec carries neither (nothing for `base validate` to resolve-check). */
function sourceRefTarget(spec: SourceSpec): string | undefined {
    return spec.kind === 'base' ? spec.ref : spec.from
}

/** What an agent sees in place of a path it may not know exists. */
const NOT_VISIBLE = '<not visible>'

/**
 * True when `spec` (or any base it composes, however deep) reads a base the agent may not see.
 * `resolveBaseRows` follows `ref:`/`from:` with no visibility check, and a base's filters and
 * formulas shape which rows it yields, so a hidden base cannot be allowed to steer a visible one
 * even when every row it ends up returning is itself visible. Cycle-guarded by resolved path.
 * `entries` empty (the owner) never reads a file.
 */
async function readsDeniedBase(
    vault: string,
    spec: SourceSpec | undefined,
    entries: DenyEntry[],
    seen: Set<string> = new Set(),
): Promise<boolean> {
    if (entries.length === 0 || !spec) return false
    const ref = sourceRefTarget(spec)
    if (!ref) return false
    const refPath = await resolveRefPath(vault, ref)
    if (isDeniedPath(entries, refPath)) return true
    if (seen.has(refPath)) return false
    seen.add(refPath)
    let text: string
    try {
        text = await readNote(vault, refPath)
    } catch {
        return false
    }
    const { config } = parseBaseFile(text, {
        name: baseNameOf(refPath),
        path: refPath,
    })
    return readsDeniedBase(vault, config.source, entries, seen)
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
            // Throws when visibility cannot be determined: fail closed, never caught.
            const entries = await agentDenyEntries(vault)
            const { text, name } = await readBase(vault, path)
            const errors: string[] = []

            // 1. The view. `parseBaseFile`'s normalizer is malformed-YAML-tolerant — an
            // invalid `view:` kind (or a legacy `views[0].type`) silently downgrades to
            // "table" instead of throwing (parse.ts's normalizeView), which is exactly the
            // mistake this command exists to surface. Read the raw YAML directly to see what
            // was actually written, before that normalizing happens. A base has ONE view; a
            // legacy `views:` list is read (first entry) but more than one entry is an error.
            const raw = readBaseConfigRaw(text) ?? {}
            if (Array.isArray(raw.views)) {
                if (raw.views.length > 1)
                    errors.push(
                        `views: this base lists ${raw.views.length} views, but a base has one view — move each extra view into its own base file with \`source: base\` and \`ref: "[[${name}]]"\``,
                    )
                const first = raw.views[0]
                const t =
                    first && typeof first === 'object'
                        ? (first as Record<string, unknown>).type
                        : undefined
                if (t !== undefined && !isValidType(t)) {
                    errors.push(
                        `view: ${JSON.stringify(t)} is not a valid view type — must be one of: ${VIEW_TYPES.join(', ')}`,
                    )
                }
            } else if (typeof raw.view === 'string' && !isValidType(raw.view)) {
                errors.push(
                    `view: ${JSON.stringify(raw.view)} is not a valid view type — must be one of: ${VIEW_TYPES.join(', ')}`,
                )
            }

            // 1b. An expression a YAML COMMENT ate. `filters: tags.contains(" #book")` parses
            // to `tags.contains("` — the space before the `#` starts a comment, and the inner
            // quotes are not YAML quoting because the scalar did not START with one. Correct
            // YAML, silent, and it takes the whole filter with it. Detected against the RAW
            // frontmatter text, because by the time the parser has answered, the dropped half
            // is gone.
            const fm = frontmatterText(text)
            const lineOffset = frontmatterLineOffset(text)
            for (const t of findCommentTruncations(fm)) {
                // The suggested fix must NOT be printed as `key: value` — `key` is the
                // NEAREST ENCLOSING key, not necessarily this scalar's own (yamlComment.ts).
                // For a top-level `filters: expr` that happens to coincide with the scalar's
                // real key, but for a bare item inside an `and`/`or`/`not` tree `key` names
                // the LIST (e.g. "and"), and `and: '<value>'` reads as "replace the whole
                // list with this one string" — silently dropping every sibling condition,
                // exactly the shape this detector was rewritten across four review rounds to
                // attribute correctly. Printing only the quoted VALUE is correct to paste
                // over the truncated scalar in either shape, whether it sits after a `:` or
                // as a bare `-` item.
                //
                // `t.line` is 1-based WITHIN the frontmatter body `findCommentTruncations`
                // was handed, not the file — add `lineOffset` to name the line a reader
                // would actually find in their editor. The suggestion itself is rebuilt via
                // reconstructTruncatedValue (real internal whitespace survives) and quoted
                // via singleQuoteYaml (an embedded `'` survives too), rather than the naive
                // `t.kept + t.dropped` join, which drops the whitespace that caused the
                // truncation in the first place.
                const fixed = singleQuoteYaml(reconstructTruncatedValue(fm, t))
                errors.push(
                    `${t.key} (line ${t.line + lineOffset}): a YAML comment truncated this value at "${t.dropped}" — it parsed as ${JSON.stringify(t.kept)}. A "#" preceded by a space starts a comment even inside what looks like a quoted string. Quote the value so YAML keeps it whole: ${fixed}`,
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

            // 3. The source, if it names a base/note
            // which doesn't exist, or a `where` expression that fails to parse. resolveSource/
            // resolveBaseRows are deliberately tolerant here (an unresolvable ref just resolves
            // to zero rows, no throw — see source.ts) — validate exists to surface exactly the
            // failure that silent path hides.
            const spec = config.source
            if (spec) {
                const ref = sourceRefTarget(spec)
                if (ref) {
                    const refPath = await resolveRefPath(vault, ref)
                    // For an agent a hidden target and a missing one read IDENTICALLY, and
                    // neither names the ref or the path: any difference is an existence oracle.
                    const hiddenFromAgent =
                        entries.length > 0 &&
                        (isDeniedPath(entries, refPath) ||
                            (await readsDeniedBase(vault, spec, entries)))
                    try {
                        if (hiddenFromAgent) throw new Error('not visible')
                        await readNote(vault, refPath)
                    } catch {
                        errors.push(
                            entries.length > 0
                                ? `source: "${NOT_VISIBLE}" does not resolve to a file in the vault (looked for ${NOT_VISIBLE})`
                                : `source: "${ref}" does not resolve to a file in the vault (looked for ${refPath})`,
                        )
                    }
                }
                if (spec.kind !== 'base' && spec.where)
                    collectExprErrors(spec.where, 'source.where', errors)
            }

            // 4. A `taskFile` the query's own scope cannot see. `taskFile` names the one note
            // a "+ task" lands in — the right call, since a query over many notes has no
            // natural answer to "where does a new one go". But nothing checked that the
            // destination is INSIDE the query's scope, so with `from: [[Keep]]` and a
            // `taskFile` outside it the write succeeds and the task never appears.
            //
            // Only the `from:` half is answerable here, and it is exact: `resolveBaseRows`
            // scopes tasks by resolving that base's own rows and keeping their paths, so the
            // same resolution answers "would a task in this file be collected".
            //
            // A `where:` filter can strand a new task the same way and is NOT checked here —
            // a filter cannot be inverted in general. That case is caught at creation time,
            // where the concrete new row exists and can just be evaluated.
            if (
                spec &&
                spec.kind === 'tasks' &&
                spec.from &&
                config.view.taskFile
            ) {
                const dest = await resolveRefPath(vault, config.view.taskFile)
                // A `from` that reads a hidden base was already reported (as not visible) in
                // step 3; resolving it here would hand its rows to the scope check.
                if (!(await readsDeniedBase(vault, spec, entries))) {
                    const scoped = filterByPath(
                        await resolveBaseRows(
                            await resolveRefPath(vault, spec.from),
                            { root: vault, today: today() },
                        ),
                        entries,
                        r => r.file.path,
                    )
                    const paths = new Set(scoped.map(r => r.file.path))
                    const destHidden = isDeniedPath(entries, dest)
                    if (!paths.has(dest))
                        errors.push(
                            `taskFile: "${destHidden ? NOT_VISIBLE : config.view.taskFile}" is outside this base's source scope (from: "${spec.from}") — a task created here is written to ${destHidden ? NOT_VISIBLE : dest}, which "from" does not select, so it never appears in the view. Point taskFile at a note inside that scope, or drop "from" if new tasks should reach every file the base can see.`,
                        )
                }
            }

            // Bonus: the filters, and every formula (including a declared
            // `{type: formula}` property's `expr`) that fails to parse — passesFilter/
            // computeFormulas (query.ts) both swallow a parse error silently instead of
            // surfacing it.
            collectExprErrors(config.filters, 'filters', errors)
            // Stat view metrics (`stats[].value`) are metric expressions, not filter
            // expressions, but the same "does it even parse" check applies before anything
            // tries to evaluate them (metricResults nulls a bad metric at render time rather
            // than throwing, so validate is the only place this surfaces as an error).
            ;(config.view.stats ?? []).forEach((stat, j) => {
                try {
                    parseExpr(stat.value)
                } catch (e) {
                    errors.push(
                        `stats[${j}].value: "${stat.value}" failed to parse — ${e instanceof Error ? e.message : String(e)}`,
                    )
                }
            })
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
