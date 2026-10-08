// A Storybook-only in-memory Transport (app/src/api.ts's `Transport` interface — the same
// seam app/src/mobile/inProcessTransport.ts implements to run the whole app with no HTTP
// server on iPad, so an in-memory fake here is known-feasible). Lets a story call
// `setTransport(fakeTransport(...))` and then use the real `api` object (tree/read/write/
// resolveRows/...) against seeded in-memory data instead of a live backend. NOT a story file
// itself — the `*.stories.*` glob (see `.storybook/main.ts`) skips underscore-prefixed files.
//
// Covers the paths `api`'s most-used verbs hit: GET /tree, GET /file, PUT /file, POST /rows,
// POST /tasks/create, POST /row/update (incl. `index: null` = append a row), POST /set-properties
// (+ /set-property, /delete-property), POST /move (renames the row), and a PUT/checked write that
// CREATES a note (it becomes a row beside its folder's siblings — see `noteCreated`).
// The row-mutating ones write into the SAME Row objects `/rows` already handed back (see
// `indexRow`), so a table toggle, kanban move, multiselect edit or map pin sticks across a
// refetch — real, mutable state, not a canned ack. Every OTHER mutation (move/delete/toggle
// file-level ones, not row ones) gets a generic 200 ack rather than a per-route implementation —
// a story exercising those usually isn't asserting on the response. Opt into `versioned` to
// also have every mutation bump the server version the way `mutatingHandler` does (see
// `bumpFakeServerVersion`) — without it a refetch never leaves BaseView's version-gated cache.
// An unmapped GET throws
// instead of guessing a shape, since a silently-wrong response is worse than a loud "add a case
// here" error.
import type {
    ChatScope,
    ChatSearchHit,
    ChatSessionInfo,
    Transport,
    OpencodeProviderList,
} from '../api'
import type { ChatFrame } from '../../../core/src/chat'
import type { TreeEntry } from '../../../core/src/graph'
import type { Row, SourceSpec } from '../../../core/src/bases/types'
import { parseFrontmatter } from '../../../core/src/frontmatter'
import {
    setBaseConfigKey,
    deleteBaseConfigKey,
} from '../../../core/src/bases/baseFile'
import {
    start as startServerVersion,
    serverVersion,
    type StartDeps,
} from '../serverVersion'
import { sampleDaemonSnapshot, sampleActivity } from './_daemonFixtures'
import { EXAMPLE_THEMES_FEED } from './_themeFixtures'

/** The default opencode provider catalog a story gets: 2 connected, 12 available (api-key and
 *  OAuth methods mixed; one OAuth provider uses a paste-the-code method, the rest sign in
 *  automatically). Sorted by name, like the real `GET /opencode/providers`. */
export function sampleOpencodeProviders(): OpencodeProviderList {
    const api = [{ type: 'api' as const, label: 'API key' }]
    const auto = [{ type: 'oauth' as const, label: 'Browser sign-in' }]
    const code = [{ type: 'oauth' as const, label: 'Paste the code' }]
    return {
        connected: [
            { id: 'anthropic', name: 'anthropic', kind: 'oauth' },
            { id: 'opencode', name: 'opencode zen', kind: 'api' },
        ],
        available: [
            { id: 'azure', name: 'azure', methods: api },
            { id: 'cerebras', name: 'cerebras', methods: api },
            { id: 'deepseek', name: 'deepseek', methods: api },
            { id: 'fireworks', name: 'fireworks ai', methods: api },
            { id: 'github-copilot', name: 'github copilot', methods: auto },
            { id: 'google', name: 'google', methods: api },
            { id: 'groq', name: 'groq', methods: api },
            { id: 'huggingface', name: 'hugging face', methods: api },
            { id: 'mistral', name: 'mistral', methods: api },
            { id: 'openai', name: 'openai', methods: [...auto, ...api] },
            { id: 'openrouter', name: 'openrouter', methods: code },
            { id: 'xai', name: 'xai', methods: api },
        ],
    }
}

export interface FakeTransportSeed {
    /** GET /chat/sessions, GET /chat/session-messages, POST /chat/search — the chat history panel's
     *  past conversations, each with the frames a resume replays into the transcript. Unseeded: no
     *  past conversations, an empty list rather than a throw, because "nothing yet" is exactly what
     *  the real server answers for a fresh vault. */
    chatHistory?: { session: ChatSessionInfo; frames: ChatFrame[] }[]
    /** GET /opencode/providers (and the state the three `/opencode/*` writes mutate — a
     *  successful connect moves the provider from `available` to `connected`, so a refetch
     *  shows it). Defaults to `sampleOpencodeProviders()`. */
    opencodeProviders?: OpencodeProviderList
    /** `'loading'`: GET /opencode/providers never resolves (the popover's checking state).
     *  `'missing'`: every `/opencode/*` route answers 409 `opencode-missing`, like a machine
     *  with no opencode binary. */
    opencodeMode?: 'loading' | 'missing'
    /** Vault-relative path -> file contents. Drives GET/PUT /file and the default /tree. */
    files?: Record<string, string>
    /** GET /daemon/status — components that gate on the daemon being enabled read this on mount. */
    daemonStatus?: unknown
    /** GET /daemon/pages — the inbox. */
    daemonPages?: unknown
    /** GET /daemon/snapshot — the daemon page's crons + background services + liveness. */
    daemonSnapshot?: unknown
    /** GET /daemon/logs — the daemon page's activity log. */
    daemonLogs?: unknown
    /** GET /graph — Backlinks and anything deriving from the vault graph. */
    graph?: unknown
    /** GET /update/status — the update banner. */
    updateStatus?: unknown
    /** Overrides the /tree response derived from `files` (one flat file entry per key). */
    tree?: TreeEntry[]
    /** POST /rows (api.resolveRows): a fixed Row[] for every spec, or a resolver keyed by spec. */
    rows?: Row[] | ((spec: SourceSpec) => Row[])
    /** Called on every `uploadAsset(targetPath, bytes)` instead of throwing, so a story can
     *  CAPTURE what an upload flow (e.g. a file-tree OS drop) tried to write without a real
     *  backend. Return the path actually written (defaults to `targetPath`, matching the real
     *  transport's de-collision-free happy path) — a story asserting a rename/collision can
     *  return something else. Omitting it keeps the previous behaviour (throws), so every
     *  existing caller is unaffected. */
    onUpload?: (targetPath: string, bytes: ArrayBuffer) => string | void
    /** Behave like the real server's `mutatingHandler`: every mutating POST bumps the server
     *  version (driving `serverVersion` through its `StartDeps` seam, see
     *  `armFakeServerVersion`) AFTER the write lands, and `/rows` hands back a fresh copy of the
     *  rows (as JSON over the wire would) instead of the seed's own objects. Without the bump,
     *  BaseView's `rowCache.isFresh(key, serverVersion())` stays true forever in Storybook, so a
     *  view's `onChange` refetch resolves from cache and a write never shows. Off by default —
     *  every existing caller keeps its fixed version and shared Row references. */
    versioned?: boolean
}

// ---- a shared, bumpable server version for `versioned` transports ----------------------
//
// ONE module-level version + captured poll callback, shared by every versioned transport.
// `serverVersion.start()` is idempotent per page (`if (started) return dispose`) and Storybook's
// preview iframe keeps module state across story switches, so a start made while another story
// still owns it is a silent no-op — `setIntervalFn` never runs, the poll is never captured, and
// every bump does nothing. `armFakeServerVersion` detects that and takes the stream over
// (dispose the current owner, start again with these deps), so the capture is guaranteed.

let fakeVersion = 1
let fakePoll: (() => unknown) | undefined
let disposeFake: (() => void) | undefined

const fakeVersionDeps: Partial<StartDeps> = {
    eventSourceFactory: () => {
        throw new Error('no SSE in storybook')
    },
    fetchVersion: async () => ({ version: fakeVersion }),
    setIntervalFn: fn => {
        fakePoll = fn
        return 0 as unknown as ReturnType<typeof setInterval>
    },
    clearIntervalFn: () => {},
    setTimeoutFn: (fn, ms) =>
        setTimeout(fn, ms) as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: h => clearTimeout(h as unknown as number),
}

/** (Re)start `serverVersion` on the fake poll. Called by every `versioned` transport. */
function armFakeServerVersion(): void {
    fakePoll = undefined
    const dispose = startServerVersion(fakeVersionDeps)
    if (fakePoll) {
        disposeFake = dispose
        return
    }
    // Someone else already started it — take it over.
    dispose()
    disposeFake = startServerVersion(fakeVersionDeps)
}

/** True once a `versioned` transport has captured the poll — a story's play() asserts this so
 *  it cannot pass vacuously against a bump that silently went nowhere. */
export function fakeServerVersionArmed(): boolean {
    return fakePoll !== undefined
}

/** Release the fake `serverVersion` ownership `armFakeServerVersion` took — call from an
 *  `onCleanup` in any story that arms it (e.g. a gallery mounting many `versioned` tiles), so
 *  the NEXT story's own `startServerVersion` call is not a silent no-op against an owner that
 *  never let go. Without this, `started` stays true in the preview iframe past this story's
 *  unmount and the next versioned story's poll is never captured. */
export function disarmFakeServerVersion(): void {
    disposeFake?.()
    disposeFake = undefined
    fakePoll = undefined
}

/** What `mutatingHandler` does after a write: advance the version and deliver it. Always past
 *  the current `serverVersion()` — the poll only fires a change for a HIGHER version, and
 *  another story may have left it anywhere. */
async function bumpFakeServerVersion(): Promise<void> {
    fakeVersion = Math.max(fakeVersion, serverVersion()) + 1
    await fakePoll?.()
}

/** Mirrors core/src/taskCreate.ts's resolveTaskFilePath (the server-side resolution a real
 *  `POST /tasks/create` does): strip `[[`/`]]`, an EXACT match on the ref among the seeded
 *  paths wins (with or without a trailing `.md`), else a basename match, else `${ref}.md`
 *  names a brand-new note — same as a wikilink to a nonexistent note everywhere else.
 *  Deliberately simpler than core's `pickByBase`/`preferId` tie-break — a story seeding two
 *  notes with the same basename would resolve differently here; `core/test/taskCreate.test.ts`
 *  owns that case. */
function resolveTaskFilePath(ref: string, paths: Iterable<string>): string {
    const bare = ref.replace(/^\[\[/, '').replace(/\]\]$/, '').trim()
    const withoutExt = bare.endsWith('.md') ? bare.slice(0, -3) : bare
    const ids = [...paths].map(p => (p.endsWith('.md') ? p.slice(0, -3) : p))
    if (ids.includes(withoutExt)) return `${withoutExt}.md`
    const base = withoutExt.split('/').pop()
    const byBase = ids.find(id => id.split('/').pop() === base)
    if (byBase !== undefined) return `${byBase}.md`
    return `${withoutExt}.md`
}

function splitPath(pathAndQuery: string): {
    pathname: string
    params: URLSearchParams
} {
    const qIdx = pathAndQuery.indexOf('?')
    if (qIdx === -1)
        return { pathname: pathAndQuery, params: new URLSearchParams() }
    return {
        pathname: pathAndQuery.slice(0, qIdx),
        params: new URLSearchParams(pathAndQuery.slice(qIdx + 1)),
    }
}

/** Every `Row` object `/rows` has ever handed back, indexed by `file.path` (note rows) and by
 *  a synthetic `path::index` key (own-rows/stored rows, which share one path across many rows).
 *  `resolveRows` returns whatever array/object the seed's rows source already holds — the SAME
 *  Row references every time a given spec resolves — so mutating a row's `.note` in place here
 *  is enough to make a write "stick": the next `/rows` call returns the same, now-mutated,
 *  objects. This is what lets a hand-authored fixture array (`const PLACE_ROWS: Row[] = [...]`)
 *  serve as a gallery/story's REAL mutable row store with no separate store abstraction. */
function indexRow(index: Map<string, Row>, row: Row): void {
    index.set(row.file.path, row)
    if (row.index !== undefined)
        index.set(`${row.file.path}::${row.index}`, row)
}

/** Build an in-memory Transport over a plain `Map<path, contents>`. Call `setTransport
 *  (fakeTransport(...))` (app/src/api.ts) before rendering a component that calls `api.*` —
 *  e.g. in a story's `render`, or a decorator shared by every story in a file. */
/** Mirrors core/src/chat.ts's scope filter: `user` = everything not minted by the daemon. */
function inChatScope(s: ChatSessionInfo, scope: ChatScope): boolean {
    if (scope === 'all') return true
    return scope === 'daemon' ? s.origin === 'daemon' : s.origin !== 'daemon'
}

/** POST /chat/search over seeded history: a case-insensitive substring match on the title and
 *  every user/assistant text frame, with a snippet cut around the first body match. */
function searchChatHistory(
    history: { session: ChatSessionInfo; frames: ChatFrame[] }[],
    query: string,
    scope: ChatScope,
): ChatSearchHit[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const hits: ChatSearchHit[] = []
    for (const { session, frames } of history) {
        if (!inChatScope(session, scope)) continue
        const body = frames
            .map(f =>
                f.type === 'user-message' || f.type === 'assistant-text'
                    ? f.text
                    : '',
            )
            .join(' ')
            .replace(/\s+/g, ' ')
        const inTitle = session.summary.toLowerCase().includes(q)
        const at = body.toLowerCase().indexOf(q)
        if (!inTitle && at < 0) continue
        const from = Math.max(0, at - 40)
        const snippet =
            at < 0
                ? body.slice(0, 120)
                : `${from > 0 ? '…' : ''}${body.slice(from, at + 120)}${at + 120 < body.length ? '…' : ''}`
        hits.push({ ...session, snippet, inTitle })
    }
    return hits
}

export function fakeTransport(seed: FakeTransportSeed = {}): Transport {
    const files = new Map<string, string>(Object.entries(seed.files ?? {}))
    const tree =
        seed.tree ??
        [...files.keys()].map((path): TreeEntry => ({ path, kind: 'file' }))
    const seedRows = seed.rows
    const rowsSource: (spec: SourceSpec) => Row[] =
        typeof seedRows === 'function' ? seedRows : () => seedRows ?? []
    // Every row `/rows` has ever resolved, so a later `/row/update`/`/set-properties`/
    // `/set-property`/`/delete-property` can find the SAME Row object and mutate it in place —
    // see `indexRow` above for why that's what makes state stick across a refetch.
    const rowIndex = new Map<string, Row>()
    // An ARRAY seed is known up front, so index it now: a component handed those same rows
    // directly (a MapView story renders `sampleViewResult(rows)` with no `/rows` call of its own)
    // can still write into them and see the write on its next re-render.
    if (Array.isArray(seedRows))
        for (const row of seedRows) indexRow(rowIndex, row)
    // Every row ARRAY the seed has handed out (the array seed up front, each resolver result as it
    // is first seen) — where a CREATED row has to go for the next read to include it. A new note
    // joins every array already holding a note in its folder (the shape of a folder-scoped base,
    // which is what a `from:` source resolves to in practice); an appended stored row joins the
    // array holding its base file's other stored rows.
    const knownArrays = new Set<Row[]>()
    const createdNotes: Row[] = []
    const adopt = (arr: Row[], row: Row): void => {
        if (arr.includes(row)) return
        if (
            !arr.some(
                r => r.index === undefined && r.file.folder === row.file.folder,
            )
        )
            return
        if (arr.some(r => r.file.path === row.file.path)) return
        arr.push(row)
    }
    const noteFromText = (path: string, text: string): Row | undefined => {
        if (!path.endsWith('.md')) return undefined
        const name = path.split('/').pop()!.replace(/\.md$/, '')
        const folder = path.includes('/')
            ? path.slice(0, path.lastIndexOf('/'))
            : ''
        return {
            file: {
                name,
                basename: name,
                path,
                folder,
                ext: 'md',
                size: text.length,
                ctime: 0,
                mtime: 0,
                tags: [],
                links: [],
            },
            note: parseFrontmatter(text).data as Record<string, unknown>,
            formula: {},
        }
    }
    /** A write that CREATES a note (nothing indexed at that path yet) makes it a row, the way the
     *  real server's next `/rows` would find the new file. */
    const noteCreated = (path: string, text: string): void => {
        if (rowIndex.has(path)) return
        const row = noteFromText(path, text)
        if (!row) return
        indexRow(rowIndex, row)
        createdNotes.push(row)
        for (const arr of knownArrays) adopt(arr, row)
    }
    if (Array.isArray(seedRows)) knownArrays.add(seedRows)
    const resolveRows = (spec: SourceSpec): Row[] => {
        const rows = rowsSource(spec)
        if (!knownArrays.has(rows)) {
            knownArrays.add(rows)
            for (const row of createdNotes) adopt(rows, row)
        }
        for (const row of rows) indexRow(rowIndex, row)
        // A versioned transport answers like the wire: a fresh copy, so a refetch after a write
        // is a NEW array Solid sees change, while the index above keeps the seed objects the
        // writes mutate.
        return seed.versioned
            ? (JSON.parse(JSON.stringify(rows)) as Row[])
            : rows
    }
    if (seed.versioned) armFakeServerVersion()
    // The opencode provider catalog, copied so a connect in one story never leaks into the next.
    const opencode = structuredClone(
        seed.opencodeProviders ?? sampleOpencodeProviders(),
    )
    const opencodeFail = (error: string, message: string): never => {
        throw new Error(JSON.stringify({ error, message }))
    }
    const opencodeGuard = (): void => {
        if (seed.opencodeMode === 'missing')
            opencodeFail(
                'opencode-missing',
                'opencode is not installed — install it, then reopen this panel.',
            )
    }
    /** Mirrors a successful connect: the provider leaves `available` for `connected`. */
    const opencodeConnect = (id: string, kind: 'api' | 'oauth'): void => {
        const i = opencode.available.findIndex(p => p.id === id)
        if (i === -1) return opencodeFail('bad-request', `unknown provider ${id}`)
        const [p] = opencode.available.splice(i, 1)
        opencode.connected.push({ id: p.id, name: p.name, kind })
    }
    const bump = async (pathname: string) => {
        if (seed.versioned && pathname !== '/rows')
            await bumpFakeServerVersion()
    }

    /** Every plain-`post` route; `post` below runs this, then bumps the version for a
     *  versioned transport — AFTER the write, so the refetch the bump triggers reads it. */
    const handlePost = async (
        pathname: string,
        body: unknown,
    ): Promise<Response> => {
        if (pathname === '/rows') {
            const { spec } = body as { spec: SourceSpec }
            return new Response(JSON.stringify(resolveRows(spec)), {
                headers: { 'Content-Type': 'application/json' },
            })
        }
        // Own-rows write-back (kanban drag, task status, a map pin on an inline row): the
        // real server addresses the row by `index` within `file`; here that's the same
        // `path::index` key `indexRow` registered the last time `/rows` resolved it.
        if (pathname === '/row/update') {
            const { file, index, note } = body as {
                file: string
                index: number | null
                note: Record<string, unknown>
            }
            if (index === null) {
                // Append (api.rowCreate): the real server upserts a new row at the END of the
                // file's own table, so its index is one past the last stored row.
                for (const arr of knownArrays) {
                    const siblings = arr.filter(
                        r => r.file.path === file && r.index !== undefined,
                    )
                    if (!siblings.length) continue
                    const created: Row = {
                        file: { ...siblings[0].file },
                        note,
                        formula: {},
                        index: Math.max(...siblings.map(r => r.index!)) + 1,
                    }
                    arr.push(created)
                    indexRow(rowIndex, created)
                    break
                }
                return new Response('ok')
            }
            const row = rowIndex.get(`${file}::${index}`)
            if (row) row.note = note
            return new Response('ok')
        }
        // A rename (a row editor's title field on a note row): the SAME Row object moves, so every
        // array holding it reads the new name on its next resolve.
        if (pathname === '/move') {
            const { from, to } = body as { from: string; to: string }
            const raw = files.get(from)
            if (raw !== undefined) {
                files.delete(from)
                files.set(to, raw)
            }
            const row = rowIndex.get(from)
            if (row) {
                const name = to.split('/').pop()!.replace(/\.md$/, '')
                row.file = { ...row.file, path: to, name, basename: name }
                rowIndex.delete(from)
                indexRow(rowIndex, row)
            }
            return new Response('ok')
        }
        // Batch property writes (kanban multi-card reorder, a map pin's lat+lng in one
        // request): each write targets a NOTE row by its file path.
        if (pathname === '/set-properties') {
            const { writes } = body as {
                writes: Array<{ path: string; key: string; value: unknown }>
            }
            const skipped = new Set<string>()
            for (const w of writes) {
                const raw = files.get(w.path)
                if (raw === undefined && !rowIndex.has(w.path))
                    skipped.add(w.path)
                if (raw !== undefined)
                    files.set(w.path, setBaseConfigKey(w.path, raw, w.key, w.value))
                const row = rowIndex.get(w.path)
                if (row) row.note[w.key] = w.value
            }
            return Response.json({ skipped: [...skipped] })
        }
        // Mirror the real server: a base's view keys live at the TOP LEVEL of its frontmatter
        // (`flattenBaseViews` first rewrites a legacy `views:` list into that flat form), so a
        // property write edits the SEEDED FILE TEXT, not only a row. Without this,
        // `armFakeServerVersion`'s bump still fires but the next `/file` read (BaseView's doc
        // refetch) hands back the same unedited text, so a gallery tile's kanban column
        // rename/delete looks acked but never shows.
        if (pathname === '/set-property') {
            const {
                path: p,
                key,
                value,
            } = body as {
                path: string
                key: string
                value: unknown
            }
            const raw = files.get(p)
            if (raw !== undefined) files.set(p, setBaseConfigKey(p, raw, key, value))
            const row = rowIndex.get(p)
            if (row) row.note[key] = value
            return new Response('ok')
        }
        if (pathname === '/delete-property') {
            const { path: p, key } = body as { path: string; key: string }
            const raw = files.get(p)
            if (raw !== undefined) files.set(p, deleteBaseConfigKey(p, raw, key))
            const row = rowIndex.get(p)
            if (row) delete row.note[key]
            return new Response('ok')
        }
        return new Response('ok')
    }

    const transport: Transport = {
        getJson: async <T>(path: string): Promise<T> => {
            const { pathname, params } = splitPath(path)
            if (pathname === '/tree') return tree as unknown as T
            if (pathname === '/version')
                return {
                    version: seed.versioned ? fakeVersion : 1,
                } as unknown as T
            // Read-only status/graph routes that components hit on mount. Without these a story renders
            // its error state instead of the component — InboxPageView did exactly that, failing on
            // `unhandled GET /daemon/status`. `seed` overrides win so a story can pose a specific state
            // (daemon off, an update available) rather than always the happy path.
            if (pathname === '/daemon/status') {
                return (seed.daemonStatus ?? {
                    enabled: true,
                    running: true,
                    crons: [],
                    processes: [],
                    // Present because the REAL response carries them and consumers read them. Omitting them
                    // made the default fixture a shape the server never sends, which is how
                    // InboxPageView's undefined-vs-null bug stayed invisible.
                    owner: null,
                    thisDeviceId: 'story-device',
                }) as unknown as T
            }
            if (pathname === '/daemon/pages')
                return (seed.daemonPages ?? []) as unknown as T
            if (pathname === '/daemon/snapshot')
                return (seed.daemonSnapshot ??
                    sampleDaemonSnapshot()) as unknown as T
            if (pathname === '/daemon/logs')
                return (seed.daemonLogs ?? sampleActivity()) as unknown as T
            if (pathname === '/themes') return EXAMPLE_THEMES_FEED as unknown as T
            if (pathname === '/graph') {
                return (seed.graph ?? { nodes: [], edges: [] }) as unknown as T
            }
            if (pathname === '/chat/sessions') {
                const scope = (params.get('scope') ?? 'user') as ChatScope
                const sessions = (seed.chatHistory ?? [])
                    .map(h => h.session)
                    .filter(x => inChatScope(x, scope))
                return { sessions } as unknown as T
            }
            if (pathname === '/chat/session-messages') {
                const id = params.get('id')
                const frames =
                    seed.chatHistory?.find(h => h.session.sessionId === id)
                        ?.frames ?? []
                return { frames } as unknown as T
            }
            if (pathname === '/update/status') {
                return (seed.updateStatus ?? {
                    current: '0.0.0',
                    latest: '0.0.0',
                    behind: 0,
                }) as unknown as T
            }
            if (pathname === '/opencode/providers') {
                // Never settles: the popover's "checking providers…" state, with no timer.
                if (seed.opencodeMode === 'loading')
                    return new Promise<T>(() => {})
                opencodeGuard()
                return structuredClone(opencode) as unknown as T
            }
            // An embedded ```query block (BaseView's hostMeta resource) fetches the HOST note's
            // own frontmatter to expose it as `this.*` in filters — real GET /meta parses it off
            // the note's own text (core/src/server.ts), so this mirrors that off the seeded file
            // rather than faking a shape: a missing path parses as `""`, same as a new/unsaved note.
            if (pathname === '/meta') {
                const p = params.get('path') ?? ''
                return parseFrontmatter(files.get(p) ?? '').data as unknown as T
            }
            // Deliberately THROWS rather than returning empty: a silent {} lets a component render a
            // blank shell that looks like a passing story. A loud failure names the missing route.
            throw new Error(`fakeTransport: unhandled GET ${path}`)
        },
        getText: async (path: string): Promise<string> => {
            const { pathname, params } = splitPath(path)
            if (pathname === '/file')
                return files.get(params.get('path') ?? '') ?? ''
            throw new Error(`fakeTransport: unhandled GET(text) ${path}`)
        },
        post: async (path: string, body: unknown): Promise<Response> => {
            const { pathname } = splitPath(path)
            if (!seed.versioned) return handlePost(pathname, body)
            const res = await handlePost(pathname, body)
            await bump(pathname)
            return res
        },
        put: async (path: string, body: unknown): Promise<Response> => {
            const { pathname } = splitPath(path)
            if (pathname === '/file') {
                const { path: p, contents } = body as {
                    path: string
                    contents: string
                }
                const isNew = !files.has(p)
                files.set(p, contents)
                if (isNew) noteCreated(p, contents)
                return new Response('ok')
            }
            return new Response('ok')
        },
        postJson: async <T>(path: string, body: unknown): Promise<T> => {
            const { pathname } = splitPath(path)
            if (pathname === '/rows') {
                const { spec } = body as { spec: SourceSpec }
                return resolveRows(spec) as unknown as T
            }
            // Mirrors core/src/taskCreate.ts's appendTaskLine: resolve `file` against the
            // seeded vault paths, then append `- [ ] <body>`, inserting the separating newline
            // only when the file doesn't already end in one.
            if (pathname === '/tasks/create') {
                const { file, body: taskBody } = body as {
                    file: string
                    body: string
                }
                const path = resolveTaskFilePath(file, files.keys())
                const text = files.get(path) ?? ''
                const sep = text.length === 0 || text.endsWith('\n') ? '' : '\n'
                files.set(path, `${text}${sep}- [ ] ${taskBody}\n`)
                await bump(pathname)
                return { path } as unknown as T
            }
            // api.del posts JSON (unlike move/create/restore, which use the plain `post` verb
            // above and already fall through to a generic 200 ack) — give it the same generic
            // ack this file's header comment already promises for "delete", so a story can
            // drive a real FileTree delete + Cmd+Z undo round trip.
            if (pathname === '/chat/search') {
                const { query, scope } = body as {
                    query: string
                    scope?: ChatScope
                }
                const hits = searchChatHistory(
                    seed.chatHistory ?? [],
                    query,
                    scope ?? 'user',
                )
                return { hits } as unknown as T
            }
            // Mirrors core's POST /feedback: an id for a payload with a title and a body, else core's
            // 400 text — so the feedback page's host story drives a real send round trip.
            if (pathname === '/feedback') {
                const { title, body: text } = body as { title?: string; body?: string }
                if (!title?.trim()) throw new Error('title is required')
                if (!text?.trim()) throw new Error('body is required')
                return { id: 'fb_story' } as unknown as T
            }
            if (pathname === '/delete') {
                const { path: p } = body as { path: string }
                await bump(pathname)
                return { trashPath: `.trash/${p}` } as unknown as T
            }
            if (pathname.startsWith('/opencode/')) {
                opencodeGuard()
                const b = body as {
                    id: string
                    key?: string
                    method?: number
                    code?: string
                }
                const provider = opencode.available.find(p => p.id === b.id)
                // A key spelled `bad…` is the story's rejected key; the message never echoes it.
                if (pathname === '/opencode/auth') {
                    if (b.key?.startsWith('bad'))
                        opencodeFail('bad-request', 'opencode rejected that key')
                    opencodeConnect(b.id, 'api')
                    return { ok: true } as unknown as T
                }
                const method = provider?.methods[b.method ?? 0]
                if (pathname === '/opencode/oauth/authorize') {
                    if (!method)
                        opencodeFail('bad-request', `unknown provider ${b.id}`)
                    const paste = /code/i.test(method?.label ?? '')
                    return {
                        url: `https://example.test/oauth/${b.id}`,
                        method: paste ? 'code' : 'auto',
                        instructions: paste
                            ? 'Sign in, then paste the code shown on the final page.'
                            : 'Finish signing in in your browser.',
                    } as unknown as T
                }
                if (pathname === '/opencode/oauth/callback') {
                    if (b.code?.startsWith('bad'))
                        opencodeFail('bad-request', 'that code was not accepted')
                    opencodeConnect(b.id, 'oauth')
                    return { ok: true } as unknown as T
                }
            }
            throw new Error(`fakeTransport: unhandled POST(json) ${path}`)
        },
        writeFileChecked: async (
            path: string,
            contents: string,
            baseText: string,
        ) => {
            // A path an indexed ROW already holds is taken even with no seeded file text — the
            // real server reads that note off disk, so a create aimed at it must conflict.
            const current =
                files.get(path) ?? (rowIndex.has(path) ? '---\n---\n' : '')
            if (current !== baseText)
                return { conflict: true as const, current }
            const isNew = !files.has(path) && !rowIndex.has(path)
            files.set(path, contents)
            if (isNew) {
                // A brand-new note is a structural change the real watcher reports, so a
                // versioned transport advances the version too (an ordinary autosave does not).
                noteCreated(path, contents)
                await bump('/file')
            }
            return { conflict: false as const }
        },
        convertHeic: async () => {
            throw new Error('fakeTransport: convertHeic is not supported')
        },
        stageTmpFile: async () => {
            throw new Error('fakeTransport: stageTmpFile is not supported')
        },
        uploadAsset: async (
            targetPath: string,
            bytes: ArrayBuffer,
        ): Promise<string> => {
            if (seed.onUpload)
                return seed.onUpload(targetPath, bytes) || targetPath
            throw new Error('fakeTransport: uploadAsset is not supported')
        },
        fetchAsset: async (_url: string, targetPath: string): Promise<string> =>
            targetPath,
        assetUrl: (target: string) => target,
        eventsUrl: () => '',
        base: () => 'fake://storybook',
    }
    return transport
}
