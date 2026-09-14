// app/src/preview/companionDoc.ts
// Pure text split/join for a binary's tag-carrying companion note (`<file>.md`, see
// core/src/fileKinds.ts's companionPathFor). CompanionFrontmatter.tsx edits the frontmatter
// block as RAW TEXT through ui/MarkdownField (whose livePreview extension already renders
// `---` fences like a note's own frontmatter) — no YAML parsing here, just carving the file
// into "the fenced block" and "everything after it" so an edit never disturbs a body the user
// wrote into the companion by hand. Framework-free so it's unit-testable without a DOM.

// Mirrors core/src/frontmatter.ts's FRONTMATTER_REGEX (not imported from there: that module
// also drags in the `yaml` package for parsing/mutating structured data, which this file has no
// need for — it only ever treats the block as opaque text). Handles \r\n line endings too.
const FRONTMATTER_REGEX = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

/** The template written into a brand-new companion the first time the user touches the strip. */
export const EMPTY_FRONTMATTER = '---\ntags: []\n---\n'

/** Split a companion note's full text into its frontmatter block (fences included, `''` when
 *  the text has none) and everything after it — the body a user may have written by hand. */
export function splitCompanion(text: string): {
    frontmatter: string
    body: string
} {
    const m = text.match(FRONTMATTER_REGEX)
    if (!m) return { frontmatter: '', body: text }
    return { frontmatter: m[0], body: text.slice(m[0].length) }
}

/** Recombine an edited frontmatter block with the body, preserving the body verbatim. */
export function joinCompanion(frontmatter: string, body: string): string {
    return frontmatter + body
}

/** Whether an edit to the frontmatter strip is worth writing to disk. Lazy creation (plan
 *  "Design"): a companion that does not exist yet (`existing === ''` — GET /file's own
 *  "missing file" reading) and whose next frontmatter is still the untouched EMPTY_FRONTMATTER
 *  template (or blank, i.e. the user cleared it back out) would just create a file recording
 *  nothing the user actually set — skip the write so opening the strip on every image doesn't
 *  litter the vault with empty companions. Once a companion genuinely exists (`existing !==
 *  ''`), every edit writes, including clearing it back to the empty template — that is a real
 *  edit (removing the last tag), not an untouched default. */
export function shouldWriteCompanion(
    existing: string,
    nextFrontmatter: string,
): boolean {
    if (existing !== '') return true
    return nextFrontmatter !== '' && nextFrontmatter !== EMPTY_FRONTMATTER
}
