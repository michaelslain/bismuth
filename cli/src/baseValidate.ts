// Structural checks for a base file's text: shared by `bismuth base validate` and any
// writer (the Obsidian importer) that must confirm a base it produced is sound.
import { readNote } from '../../core/src/files'
import { parseBaseFile, FRONTMATTER_RE } from '../../core/src/bases/parse'
import { resolveBaseRows, resolveRefPath } from '../../core/src/bases/source'
import {
    findCommentTruncations,
    type TruncatedScalar,
} from '../../core/src/bases/yamlComment'
import { baseNameOf, readBaseConfigRaw } from '../../core/src/bases/baseFile'
import {
    agentDenyEntries,
    filterByPath,
    isDeniedPath,
    type DenyEntry,
} from '../../core/src/visibilityFilter'
import {
    VIEW_TYPES,
    isValidType,
    type SourceSpec,
    type FilterNode,
} from '../../core/src/bases/types'
import { parseExpr } from '../../core/src/bases/parser'
import {
    validatePropertyValue,
    declaredFormulas,
} from '../../core/src/bases/properties'
import { today } from './args'

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
export async function readsDeniedBase(
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

/** Every structural problem in a base file's text, as the error strings `bismuth base
 *  validate` prints (empty = valid). `path` is the vault-relative path the text lives at
 *  (or will live at); its name feeds `parseBaseFile` and the extra-views advice. Hidden
 *  paths answer as a missing file, never by name (agent visibility). */
export async function validateBaseText(
    vault: string,
    path: string,
    text: string,
): Promise<string[]> {
    // Throws when visibility cannot be determined: fail closed, never caught.
    const entries = await agentDenyEntries(vault)
    const name = baseNameOf(path)
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

    return errors
}
