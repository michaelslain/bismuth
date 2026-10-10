import { join, resolve, sep } from 'path'
import { mkdir as fsMkdir, unlink } from 'fs/promises'
import { todayISO } from './dates'

// The memory dir is always supplied explicitly: the daemon passes the active vault's
// .daemon/memory, and the per-session MCP + relay hooks set BISMUTH_MEMORY_DIR. There is
// no machine-global default anymore — getMemoryDir() resolves the env var or throws so a
// missing dir fails loudly instead of silently reading the wrong place.
export function getMemoryDir(): string {
    const dir = process.env.BISMUTH_MEMORY_DIR
    if (!dir)
        throw new Error(
            'BISMUTH_MEMORY_DIR is not set — pass an explicit memory dir',
        )
    return dir
}

export type NoteType =
    'person' | 'project' | 'workflow' | 'fact' | 'preference' | 'daily' | 'auto' | 'profile' | 'hub'

export interface NoteFrontmatter {
    type: NoteType
    tags: string[]
    created: string
    updated: string
    /** AI visibility (core/src/visibility.ts's per-file scheme, applied to memory notes too — see
     *  docs/vault/visibility.md). Omitted for the common case (fully visible). Memory notes are
     *  flat under `.daemon/memory`, so there is no folder-cascade tier here, only this explicit
     *  per-note value — a documented simplification vs. the vault's file+folder cascade. */
    visibility?: 'chat-only' | 'hidden'
    /** One line saying what the note is about. Written by `remember`; recall prefers it over the
     *  note's first sentence (`noteDescription`). Omitted when empty. */
    description?: string
}

export interface MemoryNote {
    /** Folder-prefixed (`folder/name`) for non-root notes, bare name for root notes */
    name: string
    frontmatter: NoteFrontmatter
    content: string
    /** Names of notes linked via [[backlinks]] in the content (folder-agnostic) */
    backlinks: string[]
}

const ensuredDirs = new Set<string>()
async function ensureDir(dir: string): Promise<void> {
    if (ensuredDirs.has(dir)) return
    await fsMkdir(dir, { recursive: true })
    ensuredDirs.add(dir)
}

// Prevent directory traversal attacks
function sanitizeSegment(segment: string): string {
    return segment
        .replace(/[\/\\]/g, '-')
        .replace(/\.\./g, '')
        .replace(/^[.\-]+/, '')
        .replace(/[.\-]+$/, '')
        .replace(/-+/g, '-')
        .trim()
}

function sanitizeName(name: string): string {
    return sanitizeSegment(name)
}

/**
 * Sanitize a folder name. Same rules as sanitizeName — single segment, no
 * traversal. Returns "" for missing or fully sanitized-away input.
 */
export function sanitizeFolder(folder?: string): string {
    if (!folder) return ''
    return sanitizeSegment(folder)
}

/**
 * Split a folder-prefixed reference like "moltbook/foo" into its parts.
 * Bare names like "foo" return `{ name: "foo" }`. The .md extension is stripped.
 */
export function parseNoteRef(ref: string): { folder?: string; name: string } {
    const base = ref.replace(/\.md$/, '')
    const slashIdx = base.indexOf('/')
    if (slashIdx === -1) return { name: base }
    const folder = base.slice(0, slashIdx)
    const name = base.slice(slashIdx + 1)
    if (!folder) return { name }
    return { folder, name }
}

function notePath(dir: string, name: string, folder?: string): string {
    const safeName = sanitizeName(name)
    if (!safeName) throw new Error('Invalid note name')
    const fileName = safeName.endsWith('.md') ? safeName : `${safeName}.md`

    let full: string
    if (folder) {
        const safeFolder = sanitizeFolder(folder)
        if (!safeFolder) throw new Error('Invalid folder name')
        full = join(dir, safeFolder, fileName)
    } else {
        full = join(dir, fileName)
    }
    // Final check: resolved path must be inside the directory
    const resolvedFull = resolve(full)
    const resolvedDir = resolve(dir)
    if (
        resolvedFull !== resolvedDir &&
        !resolvedFull.startsWith(resolvedDir + sep)
    ) {
        throw new Error('Invalid note name')
    }
    return full
}

function extractBacklinks(content: string): string[] {
    const matches = content.matchAll(/\[\[([^\]]+)\]\]/g)
    const backlinks: string[] = []
    for (const match of matches) {
        const linked = match[1]?.trim()
        if (linked) backlinks.push(linked)
    }
    return [...new Set(backlinks)]
}

function parseFrontmatterValue(value: string): string | string[] {
    const trimmed = value.trim()
    // Array syntax: [a, b, c]
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const inner = trimmed.slice(1, -1)
        if (inner.trim() === '') return []
        return inner
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0)
    }
    return trimmed
}

type ParsedVisibility = 'all' | 'chat-only' | 'hidden'

const VISIBILITY_STRICTNESS: Record<ParsedVisibility, number> = {
    all: 0,
    'chat-only': 1,
    hidden: 2,
}

/**
 * Read one `visibility:` value, FAILING CLOSED. This parser is hand-rolled (the memory package takes
 * no YAML dependency) while core reads the same files with real YAML, so every spelling YAML would
 * accept has to land on the same side of the line or an agent sees a note core would hide. Strips a
 * trailing ` # comment` and one pair of surrounding quotes, then matches `all|chat-only|hidden`
 * case-insensitively. ANYTHING else (an empty value whose real value sits on the next line, a flow
 * `[hidden]` / `{...}` form, a typo) is `hidden`.
 */
function parseVisibilityValue(raw: string): ParsedVisibility {
    let v = raw.replace(/\s+#.*$/, '').trim()
    const quoted = v.match(/^(['"])(.*)\1$/)
    if (quoted) v = (quoted[2] ?? '').trim()
    v = v.toLowerCase()
    return v === 'all' || v === 'chat-only' || v === 'hidden' ? v : 'hidden'
}

/** Read a `description:` value: one pair of surrounding quotes is removed (JSON escapes honoured
 *  for the double-quoted form `serializeFrontmatter` writes). */
function parseDescriptionValue(raw: string): string {
    const v = raw.trim()
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
        try {
            const parsed: unknown = JSON.parse(v)
            if (typeof parsed === 'string') return parsed.trim()
        } catch {
            // fall through to the plain strip
        }
        return v.slice(1, -1).trim()
    }
    if (v.length >= 2 && v.startsWith("'") && v.endsWith("'"))
        return v.slice(1, -1).replace(/''/g, "'").trim()
    return v
}

function parseFrontmatter(raw: string): NoteFrontmatter {
    const lines = raw.split('\n')
    const data: Record<string, string | string[]> = {}
    // The strictest `visibility` seen on ANY line wins, so a duplicate key (or an indented one inside
    // a block) can only ever tighten the note, never relax it.
    let visibility: ParsedVisibility = 'all'
    let description = ''

    for (const line of lines) {
        const colonIdx = line.indexOf(':')
        if (colonIdx === -1) continue
        const key = line
            .slice(0, colonIdx)
            .trim()
            .replace(/^(['"])(.*)\1$/, '$2')
        const value = line.slice(colonIdx + 1).trim()
        if (key === 'visibility') {
            const v = parseVisibilityValue(value)
            if (VISIBILITY_STRICTNESS[v] > VISIBILITY_STRICTNESS[visibility])
                visibility = v
            continue
        }
        if (key === 'description') {
            description = parseDescriptionValue(value)
            continue
        }
        if (key) {
            data[key] = parseFrontmatterValue(value)
        }
    }

    return {
        type: (data['type'] as NoteType) ?? 'fact',
        tags: Array.isArray(data['tags'])
            ? data['tags']
            : data['tags']
              ? [data['tags'] as string]
              : [],
        created: (data['created'] as string) ?? todayISO(),
        updated: (data['updated'] as string) ?? todayISO(),
        ...(description ? { description } : {}),
        ...(visibility !== 'all' ? { visibility } : {}),
    }
}

/** A description is one line. It is double-quoted (JSON, which is valid YAML) whenever a plain
 *  scalar would be misread — by this parser's `[a, b]` array form or by core's real YAML reader. */
function serializeDescription(description: string): string {
    const one = description.replace(/\s+/g, ' ').trim()
    if (!one) return ''
    const needsQuote =
        /^[\[\]{}"'&*!|>%@`#?:,-]/.test(one) || /: | #|\t/.test(one) || /:$/.test(one)
    return `\ndescription: ${needsQuote ? JSON.stringify(one) : one}`
}

function serializeFrontmatter(fm: NoteFrontmatter): string {
    const tagsStr = fm.tags.length > 0 ? `[${fm.tags.join(', ')}]` : '[]'
    const visibilityLine = fm.visibility ? `\nvisibility: ${fm.visibility}` : ''
    const descriptionLine = fm.description
        ? serializeDescription(fm.description)
        : ''
    return `---\ntype: ${fm.type}\ntags: ${tagsStr}\ncreated: ${fm.created}\nupdated: ${fm.updated}${descriptionLine}${visibilityLine}\n---`
}

/** Memory notes are flat under `.daemon/memory` (no folder cascade) — a note is restricted from
 *  daemon-facing recall when its OWN frontmatter says so. See docs/vault/visibility.md. */
export function isMemoryNoteVisibleToDaemon(note: MemoryNote): boolean {
    return (
        note.frontmatter.visibility !== 'chat-only' &&
        note.frontmatter.visibility !== 'hidden'
    )
}

const DESCRIPTION_MAX = 160

/** The note's one-line description: its frontmatter `description`, else its first prose sentence
 *  (headings, fences, tables and inline markup skipped), at most 160 chars. */
export function noteDescription(note: MemoryNote): string {
    const own = note.frontmatter.description?.replace(/\s+/g, ' ').trim()
    if (own) return clipDescription(own)
    let inFence = false
    for (const raw of note.content.split('\n')) {
        const line = raw.trim()
        if (/^(```|~~~)/.test(line)) {
            inFence = !inFence
            continue
        }
        if (inFence || !line) continue
        if (/^(#{1,6}\s|---+$|\*\*\*+$|\||>\s*$)/.test(line)) continue
        if (line.endsWith(':')) continue
        const prose = line
            .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
            .replace(/^>\s*/, '')
            .replace(/!?\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_m, a, _b, c) => c ?? a)
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/[*_`~]+/g, '')
            .trim()
        if (!prose || prose.endsWith(':')) continue
        // A short `Label:` prefix (Status, Last Updated, RULE) is not prose: keep what follows it.
        const body = prose
            .replace(/^(?:CRITICAL\s+)?(?:UPDATE|Updated|Last Updated|Status|Note|RULE|IMPORTANT)\b[^:]{0,40}:\s*/i, '')
            .replace(/^(?:\w+\s+){0,2}\w+:\s+(?=\S)/, '')
            .replace(/^\([^)]*\)\s*/, '')
            .trim()
        if (!body) continue
        const end = body.search(/[.!?](\s|$)/)
        return clipDescription(end === -1 ? body : body.slice(0, end + 1))
    }
    return ''
}

function clipDescription(s: string): string {
    return s.length <= DESCRIPTION_MAX ? s : `${s.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`
}

function parseNoteFile(name: string, raw: string): MemoryNote {
    // Split on --- delimiters
    const parts = raw.split(/^---\s*$/m)
    // Typical structure: ["", frontmatter, content]
    let frontmatter: NoteFrontmatter
    let content: string

    if (parts.length >= 3 && parts[0] !== undefined && parts[0].trim() === '') {
        frontmatter = parseFrontmatter(parts[1] ?? '')
        content = parts.slice(2).join('---').trim()
    } else if (parts.length === 2 && parts[0] !== undefined && parts[0].trim() === '') {
        // A `---` fence opened and never closed: the head is malformed, so what it would have said
        // about visibility is unknowable. Fail closed.
        frontmatter = {
            type: 'fact',
            tags: [],
            created: todayISO(),
            updated: todayISO(),
            visibility: 'hidden',
        }
        content = (parts[1] ?? '').trim()
    } else {
        // No frontmatter block found
        frontmatter = {
            type: 'fact',
            tags: [],
            created: todayISO(),
            updated: todayISO(),
        }
        content = raw.trim()
    }

    return {
        name,
        frontmatter,
        content,
        backlinks: extractBacklinks(content),
    }
}

/**
 * If `folder` is supplied, treat `name` as a bare name within that folder.
 * Otherwise, allow `name` to be folder-prefixed (e.g. "moltbook/foo").
 * If the inferred folder portion is unsafe (e.g. "../foo"), fall back to
 * treating the whole input as a flat name — sanitizeName will clean it.
 */
function resolveRef(
    name: string,
    folder?: string,
): { folder?: string; name: string } {
    if (folder !== undefined) return { folder: folder || undefined, name }
    const parsed = parseNoteRef(name)
    if (parsed.folder && !sanitizeFolder(parsed.folder)) return { name }
    return parsed
}

/**
 * List note references in the memory directory.
 *
 * - When `folder` is given: scans only that folder, returns folder-prefixed
 *   names (e.g. `moltbook/foo`).
 * - When omitted: scans recursively (single level only), returns
 *   folder-prefixed names for non-root notes and bare names for root notes.
 */
export async function listNotes(
    dir: string = getMemoryDir(),
    folder?: string,
): Promise<string[]> {
    await ensureDir(dir)

    if (folder !== undefined) {
        const safeFolder = sanitizeFolder(folder)
        if (!safeFolder) return []
        const folderPath = join(dir, safeFolder)
        const resolvedFolderPath = resolve(folderPath)
        const resolvedDir = resolve(dir)
        if (
            resolvedFolderPath !== resolvedDir &&
            !resolvedFolderPath.startsWith(resolvedDir + sep)
        ) {
            return []
        }
        const glob = new Bun.Glob('*.md')
        const names: string[] = []
        try {
            for await (const file of glob.scan(folderPath)) {
                names.push(`${safeFolder}/${file.replace(/\.md$/, '')}`)
            }
        } catch {
            // folder doesn't exist yet — return empty
        }
        return names
    }

    const glob = new Bun.Glob('**/*.md')
    const names: string[] = []
    for await (const file of glob.scan(dir)) {
        const noExt = file.replace(/\.md$/, '')
        // Single-level only — silently ignore deeper paths
        const slashCount = (noExt.match(/\//g) ?? []).length
        if (slashCount > 1) continue
        names.push(noExt)
    }
    return names
}

/** The on-disk path read/write/delete resolve `name` (+ `folder`) to, sanitisation included, for
 *  callers that must check that exact path against a deny list. Throws on an invalid name. */
export function memoryNotePath(
    name: string,
    dir: string,
    folder?: string,
): string {
    const ref = resolveRef(name, folder)
    return notePath(dir, ref.name, ref.folder)
}

/**
 * Read and parse a single note. `name` may be folder-prefixed
 * (e.g. "moltbook/foo") or bare. Pass `folder` explicitly to override.
 * Returns null if the note does not exist.
 */
export async function readNote(
    name: string,
    dir: string = getMemoryDir(),
    folder?: string,
): Promise<MemoryNote | null> {
    await ensureDir(dir)
    const ref = resolveRef(name, folder)
    const path = notePath(dir, ref.name, ref.folder)
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    const raw = await file.text()
    const baseName = ref.name.replace(/\.md$/, '')
    const finalName = ref.folder
        ? `${sanitizeFolder(ref.folder)}/${sanitizeName(baseName)}`
        : sanitizeName(baseName)
    return parseNoteFile(finalName, raw)
}

/**
 * Write (create or overwrite) a note. `name` may be folder-prefixed; pass
 * `folder` explicitly to override.
 */
export async function writeNote(
    name: string,
    frontmatter: NoteFrontmatter,
    content: string,
    dir: string = getMemoryDir(),
    folder?: string,
): Promise<void> {
    await ensureDir(dir)
    const ref = resolveRef(name, folder)
    const path = notePath(dir, ref.name, ref.folder)
    const serialized = `${serializeFrontmatter(frontmatter)}\n\n${content}\n`
    await Bun.write(path, serialized)
}

/**
 * Delete a note. `name` may be folder-prefixed; pass `folder` explicitly to override.
 * Returns true if the note existed and was deleted.
 */
export async function deleteNote(
    name: string,
    dir: string = getMemoryDir(),
    folder?: string,
): Promise<boolean> {
    await ensureDir(dir)
    const ref = resolveRef(name, folder)
    const path = notePath(dir, ref.name, ref.folder)
    const file = Bun.file(path)
    if (!(await file.exists())) return false
    await unlink(path)
    return true
}

/**
 * Load all notes in the memory directory. When `folder` is supplied, only
 * loads notes from that folder. Names on returned notes are folder-prefixed
 * for non-root notes.
 */
export async function loadAllNotes(
    dir: string = getMemoryDir(),
    folder?: string,
): Promise<MemoryNote[]> {
    const refs = await listNotes(dir, folder)
    const results = await Promise.all(
        refs.map(ref => {
            const parsed = parseNoteRef(ref)
            return readNote(parsed.name, dir, parsed.folder)
        }),
    )
    return results.filter((n): n is MemoryNote => n !== null)
}

/**
 * Find all notes containing a [[backlink]] to the given note.
 * Backlinks are folder-agnostic — the lookup matches by bare name across all folders.
 * Returned names are folder-prefixed where applicable.
 */
export async function findBacklinks(
    name: string,
    dir: string = getMemoryDir(),
): Promise<string[]> {
    const notes = await loadAllNotes(dir)
    const target = parseNoteRef(name).name
    return notes.filter(n => n.backlinks.includes(target)).map(n => n.name)
}
