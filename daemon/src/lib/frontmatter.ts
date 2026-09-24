/**
 * Simple frontmatter parser for markdown files with YAML-like --- delimited headers.
 * Returns raw key-value pairs as strings + the body text.
 * Used by cron and process modules. Memory graph has its own typed parser.
 */
export function parseFrontmatter(content: string): {
    frontmatter: Record<string, string>
    body: string
} {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
    if (!match) return { frontmatter: {}, body: content.trim() }

    const frontmatter: Record<string, string> = {}
    for (const line of match[1]!.split(/\r?\n/)) {
        const colonIdx = line.indexOf(':')
        if (colonIdx === -1) continue
        const key = line.slice(0, colonIdx).trim()
        const value = line.slice(colonIdx + 1).trim()
        frontmatter[key] = unquote(value)
    }

    return { frontmatter, body: match[2]!.trim() }
}

/** Undo the quoting `frontmatterValue` applies on write, so a caller sees the plain display
 *  value regardless of which quote style (or none) is on disk. A value wrapped in matching
 *  `"…"` is JSON-decoded (falling back to a bare strip of the two quote chars if the JSON is
 *  malformed); a value wrapped in matching `'…'` is stripped, with an escaped `''` collapsing
 *  to a literal `'` (the classic YAML single-quote escape). Anything else — including a value
 *  starting with `[`/`{` (a JSON array/object literal, e.g. `args: ["x"]`) — is returned
 *  exactly as written. */
function unquote(value: string): string {
    if (value.length >= 2 && value[0] === '"' && value.endsWith('"')) {
        try {
            return JSON.parse(value)
        } catch {
            return value.slice(1, -1)
        }
    }
    if (value.length >= 2 && value[0] === "'" && value.endsWith("'")) {
        return value.slice(1, -1).replace(/''/g, "'")
    }
    return value
}

/** Leading characters that are unsafe for a bare (unquoted) frontmatter scalar — each one is
 *  either YAML-meaningful (`"'&*!|>%@` and the brackets `[{`) or would itself trigger the
 *  quote-stripping `unquote` above on the next read (`` ` `` included defensively alongside
 *  the two real quote characters). */
const UNSAFE_LEADING = /^["'[{&*!|>%@`]/

/**
 * `v` bare when it is safe as a plain YAML scalar AND survives `parseFrontmatter` unchanged:
 * no `:`/`#` anywhere (either would be ambiguous with this format's syntax), no unsafe leading
 * character, no leading/trailing whitespace (this parser's own `.trim()` would silently eat it
 * on the next read), not a bare YAML indicator character (`- `/`? `/`: ` or a lone leading
 * `,`/`]`/`}`, each of which makes a block a YAML alias/flow scalar to a real reader), not a
 * bare YAML scalar that would decode as boolean/null/numeric (`true`/`false`/`null`/`~`, an
 * int/float/hex/octal, `.inf`/`.nan`), and non-empty. Otherwise `JSON.stringify(v)`, which both
 * quotes and escapes it, and which `unquote` above reverses exactly via `JSON.parse`.
 */
export function frontmatterValue(v: string): string {
    if (
        v === '' ||
        v !== v.trim() ||
        v.includes(':') ||
        v.includes('#') ||
        UNSAFE_LEADING.test(v) ||
        /^[-?:,\]}](\s|$)|^[,\]}]/.test(v) ||
        /^(true|false|null|~|[-+]?(\d[\d_]*)?\.?\d+([eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|[-+]?\.(inf|nan))$/i.test(v)
    ) {
        return JSON.stringify(v)
    }
    return v
}
