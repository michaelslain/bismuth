// core/src/imageDescribe.ts
// Image descriptions: Claude Haiku writes a plain description of an image (visible text included)
// into the image's companion note frontmatter (`description`, plus `describedHash`, the content hash of
// the bytes it described). The vault index reads that `description` as the image's text, so an image
// becomes findable by semantic search and recall. One-shot Agent SDK query() on the user's own claude
// login, the searchPrompt.ts pattern; the SDK call sits behind `imageDescribeDeps.describe` so tests
// never reach Claude.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { AppError } from './error'
import { FRONTMATTER_REGEX, mutateFrontmatter, parseFrontmatterData } from './frontmatter'
import { companionPathFor, extOfPath, isImagePath } from './fileKinds'
import { readDescribeImagesSync, readEmbeddingsEnabledSync } from './embeddingsSetting'
import { resolveInVault, walkDir, writeNote } from './files'
import { findDeniedEntry, resolveDenyPlan } from './visibility'

export type DescribeResult = {
    path: string
    companion: string
    description: string
    skipped?: string
}

const HAIKU_MODEL = 'claude-haiku-4-5'
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_DESCRIPTION_CHARS = 600
const TIMEOUT_MS = 120_000

const MEDIA_TYPES: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
}

const SYSTEM_PROMPT =
    'You describe one image for a search index. Reply with a plain description of what the image ' +
    `shows, and transcribe any text visible in it. At most ${MAX_DESCRIPTION_CHARS} characters. ` +
    'No preamble, no markdown, no quotes around the reply.'

export type Describer = (input: {
    bytes: Buffer
    mediaType: string
    path: string
    signal?: AbortSignal
}) => Promise<string>

/** Writes to a vault file are marked so the watcher drops its own echo. The server installs its
 *  selfWriteMarks here; the CLI has no watcher and leaves it unset. */
export type WriteMarks = {
    mark(paths: string[]): void
    rearm(paths: string[]): void
    unmark(paths: string[]): void
}

export const imageDescribeDeps: {
    describe: Describer
    whichClaude: () => Promise<string | null> | string | null
    marks: WriteMarks | null
    /** Called with the companion path after it is written; the server wires it to `invalidate`. */
    written: ((paths: string[]) => void | Promise<void>) | null
    /** The daemon deny plan, a full vault walk: one call per describeImage, one per drain pass. */
    denyPlan: typeof resolveDenyPlan
} = {
    describe: defaultDescribe,
    whichClaude: async () => (await import('./claudeWhich')).whichClaude(),
    marks: null,
    written: null,
    denyPlan: resolveDenyPlan,
}

const NO_CLAUDE = 'Image descriptions need Claude Code installed: install it, run `claude` once to log in, then retry'

async function defaultDescribe(input: Parameters<Describer>[0]): Promise<string> {
    const bin = await imageDescribeDeps.whichClaude()
    if (!bin) throw new AppError('EINVAL', NO_CLAUDE, 400)
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const { claudeSpawnEnv } = await import('./claudeWhich')
    const abort = new AbortController()
    input.signal?.addEventListener('abort', () => abort.abort(), { once: true })
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
    const message = {
        type: 'user' as const,
        parent_tool_use_id: null,
        session_id: '',
        message: {
            role: 'user' as const,
            content: [
                {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: input.mediaType,
                        data: input.bytes.toString('base64'),
                    },
                },
                { type: 'text', text: 'Describe this image.' },
            ],
        },
    }
    async function* prompt() {
        yield message
    }
    try {
        const stream = query({
            prompt: prompt() as never,
            options: {
                model: HAIKU_MODEL,
                pathToClaudeCodeExecutable: bin,
                cwd: process.cwd(),
                env: claudeSpawnEnv(),
                tools: [],
                maxTurns: 1,
                persistSession: false,
                settingSources: [],
                systemPrompt: SYSTEM_PROMPT,
                abortController: abort,
            },
        }) as unknown as AsyncIterable<{ type: string; subtype?: string; result?: string }>
        let text: string | undefined
        for await (const m of stream) {
            if (m.type === 'result' && m.subtype === 'success') text = m.result
        }
        if (!text?.trim())
            throw new AppError(
                'INTERNAL_ERROR',
                'Claude returned no description: check that `claude` is installed and logged in',
                500,
            )
        return text
    } catch (e) {
        if (e instanceof AppError) throw e
        throw new AppError('INTERNAL_ERROR', `Image description failed: ${(e as Error).message}`, 500)
    } finally {
        clearTimeout(timer)
    }
}

const contentHash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

function tidy(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim()
    return flat.length > MAX_DESCRIPTION_CHARS ? flat.slice(0, MAX_DESCRIPTION_CHARS).trimEnd() : flat
}

function readCompanion(vault: string, companion: string): string {
    try {
        return readFileSync(resolveInVault(vault, companion), 'utf8')
    } catch {
        return ''
    }
}

function frontmatterOf(md: string): Record<string, unknown> {
    const m = md.match(FRONTMATTER_REGEX)
    return (m && parseFrontmatterData(m[1])) || {}
}

/** Describe one image into its companion note. Skips (`skipped` set) rather than throws for an
 *  unchanged, oversized, unsupported or daemon-hidden image. */
export async function describeImage(
    vault: string,
    path: string,
    opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<DescribeResult> {
    return describeWith(vault, path, opts, await imageDescribeDeps.denyPlan(vault, 'daemon'))
}

type DenyPlan = Awaited<ReturnType<typeof resolveDenyPlan>>

// `describeImage` with the deny plan already resolved, so a drain pass walks the vault once.
async function describeWith(
    vault: string,
    path: string,
    opts: { force?: boolean; signal?: AbortSignal },
    plan: DenyPlan,
): Promise<DescribeResult> {
    if (!isImagePath(path))
        throw new AppError('BAD_REQUEST', `Not an image: ${path}`, 400)
    const abs = resolveInVault(vault, path)
    if (!existsSync(abs)) throw new AppError('ENOENT', `No such file: ${path}`, 404)
    const companion = companionPathFor(path)
    const existing = readCompanion(vault, companion)
    const fm = frontmatterOf(existing)
    const prior = typeof fm.description === 'string' ? fm.description : ''
    const skip = (why: string): DescribeResult => ({ path, companion, description: prior, skipped: why })

    if (!plan.determined || findDeniedEntry(plan.entries, path)) return skip('hidden')
    if (statSync(abs).size > MAX_IMAGE_BYTES) return skip('too-large')
    const mediaType = MEDIA_TYPES[extOfPath(path)]
    if (!mediaType) return skip('unsupported')

    const bytes = readFileSync(abs)
    const hash = contentHash(bytes)
    if (!opts.force && fm.describedHash === hash && prior) return skip('unchanged')

    const description = tidy(
        await imageDescribeDeps.describe({ bytes, mediaType, path, signal: opts.signal }),
    )
    if (!description)
        throw new AppError('INTERNAL_ERROR', 'Claude returned an empty description', 500)

    // Re-read right before writing: the note may have changed while Claude worked.
    const fresh = readCompanion(vault, companion)
    const next = mutateFrontmatter(fresh, (doc, data) => {
        for (const [k, v] of [['description', description], ['describedHash', hash]] as const) {
            if (doc.set) doc.set(k, v)
            else data[k] = v
        }
        return { keep: true, result: '' }
    })
    const marks = imageDescribeDeps.marks
    marks?.mark([companion])
    try {
        await writeNote(vault, companion, next)
    } catch (e) {
        marks?.unmark([companion])
        throw e
    }
    marks?.rearm([companion])
    await imageDescribeDeps.written?.([companion])
    return { path, companion, description }
}

// One queue per vault, drained one image at a time in the background.
type Queue = { pending: Set<string>; running: boolean }
const queues = new Map<string, Queue>()

async function allImages(vault: string): Promise<string[]> {
    const found = await walkDir(vault, (d, rel) => !d.isDirectory() && isImagePath(rel))
    return found.filter(e => !e.isDir).map(e => e.rel)
}

async function drain(vault: string, q: Queue): Promise<void> {
    q.running = true
    let plan: DenyPlan | null = null
    try {
        while (q.pending.size > 0) {
            if (!readDescribeImagesSync(vault) || !readEmbeddingsEnabledSync(vault)) {
                q.pending.clear()
                break
            }
            const path = q.pending.values().next().value as string
            q.pending.delete(path)
            try {
                plan ??= await imageDescribeDeps.denyPlan(vault, 'daemon')
                await describeWith(vault, path, {}, plan)
            } catch {
                // One failed image (no claude, bad bytes) must not stop the rest; the next change retries.
            }
        }
    } finally {
        q.running = false
    }
}

/** Queue images for description. A no-op unless `embeddings.describeImages` and `embeddings.enabled`
 *  are both on; with `changedPaths` absent it queues every image in the vault (boot). */
export function syncImageDescriptions(vault: string, changedPaths?: string[]): void {
    const q = queues.get(vault)
    if (!readDescribeImagesSync(vault) || !readEmbeddingsEnabledSync(vault)) {
        q?.pending.clear()
        return
    }
    const queue = q ?? { pending: new Set<string>(), running: false }
    queues.set(vault, queue)
    const start = (paths: string[]) => {
        for (const p of paths) queue.pending.add(p)
        if (!queue.running && queue.pending.size > 0) void drain(vault, queue)
    }
    if (changedPaths) start(changedPaths.filter(isImagePath))
    else void allImages(vault).then(start, () => {})
}
