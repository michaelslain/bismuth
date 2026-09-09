// app/src/editor/frontmatterUtils.ts
// Pure, DOM-free helper for locating the YAML frontmatter body in a document.
// NO CodeMirror imports, so it runs under `bun test` without a browser environment.
// Shared by frontmatter validation/autocomplete (yamlSchema) and Harper's body-skip.

/** Matches a closing `---` frontmatter fence at the start of a line (end-of-doc allowed). */
const CLOSE_FENCE_RE = /^---[ \t]*(?:\r?\n|$)/m

export interface FrontmatterRange {
    /** Document char offset where the YAML body starts (just after the opening fence). */
    from: number
    /** Document char offset where the YAML body ends (just before the closing fence). */
    to: number
    /** The YAML body text, i.e. doc.slice(from, to). */
    text: string
}

/**
 * Return the char-offset range of the YAML frontmatter body, or null if the document
 * has no well-formed frontmatter (no opening fence on line 1, or never closed).
 *
 * The returned range is the CONTENT between the fences — `to` is the end of the body
 * text, before the closing `---` fence (or === `from` for an empty body).
 */
export function extractFrontmatterBoundary(
    doc: string,
): FrontmatterRange | null {
    const open = /^---\r?\n/.exec(doc)
    if (!open) return null
    const from = open[0].length // first char after the opening fence + newline
    const after = doc.slice(from)
    const m = CLOSE_FENCE_RE.exec(after)
    if (!m) return null
    let to = from + m.index // immediate close (empty body) → to === from
    if (m.index > 0) {
        // trim the single newline before the closing fence
        const nl = /\r?\n$/.exec(doc.slice(from, to))
        if (nl) to -= nl[0].length
    }
    return { from, to, text: doc.slice(from, to) }
}

/**
 * Char range of the markdown *body* — everything after a leading YAML frontmatter block
 * (past the closing `---` fence + its newline), or the whole doc when there's no
 * frontmatter. Used by Harper's body-skip so property values aren't spell-checked.
 *
 * `extractFrontmatterBoundary` returns the frontmatter CONTENT range (`to` is the end of
 * the body text, before the closing fence). This advances past the closing `---\n` line.
 */
export function frontmatterBodyRange(doc: string): {
    from: number
    to: number
} {
    const fm = extractFrontmatterBoundary(doc)
    if (!fm) return { from: 0, to: doc.length }
    // Find the closing fence: the first `---` line at or after the content end. The slice
    // from fm.to begins with the (optional) newline that precedes the closing fence.
    const after = doc.slice(fm.to)
    const m = CLOSE_FENCE_RE.exec(after)
    if (!m) return { from: 0, to: doc.length } // shouldn't happen (boundary already matched)
    const from = fm.to + m.index + m[0].length // past the closing fence + its newline
    return { from, to: doc.length }
}

/**
 * The 1-based line number of the frontmatter's CLOSING `---`, or 0 when the document has none.
 *
 * Same boundary as `extractFrontmatterBoundary`, expressed in lines, because several callers
 * work in line numbers rather than char offsets: `drawBlock.ts`'s drop slots (a drawing must
 * never land above the opening `---`), `InkOverlay.tsx`'s run walk and seam table (the
 * frontmatter is never a block ink can be stored against), `inkCommit.ts`'s
 * `separateFromFrontmatter`, and the export's ink rewrite (`export/inkHtml.ts`).
 *
 * Recognising ONLY `---` is the point, not an omission: `core/src/frontmatter.ts`'s
 * FRONTMATTER_REGEX and `normalizeFrontmatter.ts` both close on `---` alone, so a helper that
 * also accepted YAML's `...` terminator would put this feature's line math out of step with the
 * parser whose frontmatter it is reasoning about — and with the normalizer whose rewrites
 * `separateFromFrontmatter` exists to stay ahead of.
 */
export function frontmatterCloseLine(doc: string): number {
    const fm = extractFrontmatterBoundary(doc)
    if (!fm) return 0
    // `fm.to` is the end of the YAML body, before the newline preceding the closing fence, so
    // the slice from there begins with that newline + the `---` line.
    const m = CLOSE_FENCE_RE.exec(doc.slice(fm.to))
    if (!m) return 0 // unreachable (the boundary already matched) — be defensive
    return doc.slice(0, fm.to + m.index).split('\n').length
}
