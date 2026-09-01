// A Storybook-only in-memory Transport (app/src/api.ts's `Transport` interface — the same
// seam app/src/mobile/inProcessTransport.ts implements to run the whole app with no HTTP
// server on iPad, so an in-memory fake here is known-feasible). Lets a story call
// `setTransport(fakeTransport(...))` and then use the real `api` object (tree/read/write/
// resolveRows/...) against seeded in-memory data instead of a live backend. NOT a story file
// itself — the `*.stories.*` glob (see `.storybook/main.ts`) skips underscore-prefixed files.
//
// Covers the paths `api`'s most-used verbs hit: GET /tree, GET /file, PUT /file, POST /rows.
// Every other mutation (move/create/delete/toggle/...) gets a generic 200 ack rather than a
// per-route implementation — a story exercising those usually isn't asserting on the response.
// An unmapped GET throws instead of guessing a shape, since a silently-wrong response is worse
// than a loud "add a case here" error.
import type { Transport } from '../api'
import type { TreeEntry } from '../../../core/src/graph'
import type { Row, SourceSpec } from '../../../core/src/bases/types'
import { parseFrontmatter } from '../../../core/src/frontmatter'

export interface FakeTransportSeed {
    /** Vault-relative path -> file contents. Drives GET/PUT /file and the default /tree. */
    files?: Record<string, string>
    /** GET /daemon/status — components that gate on the daemon being enabled read this on mount. */
    daemonStatus?: unknown
    /** GET /daemon/pages — the inbox. */
    daemonPages?: unknown
    /** GET /graph — Backlinks and anything deriving from the vault graph. */
    graph?: unknown
    /** GET /update/status — the update banner. */
    updateStatus?: unknown
    /** Overrides the /tree response derived from `files` (one flat file entry per key). */
    tree?: TreeEntry[]
    /** POST /rows (api.resolveRows): a fixed Row[] for every spec, or a resolver keyed by spec. */
    rows?: Row[] | ((spec: SourceSpec) => Row[])
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

/** Build an in-memory Transport over a plain `Map<path, contents>`. Call `setTransport
 *  (fakeTransport(...))` (app/src/api.ts) before rendering a component that calls `api.*` —
 *  e.g. in a story's `render`, or a decorator shared by every story in a file. */
export function fakeTransport(seed: FakeTransportSeed = {}): Transport {
    const files = new Map<string, string>(Object.entries(seed.files ?? {}))
    const tree =
        seed.tree ??
        [...files.keys()].map((path): TreeEntry => ({ path, kind: 'file' }))
    const resolveRows =
        typeof seed.rows === 'function' ? seed.rows : () => seed.rows ?? []

    return {
        getJson: async <T>(path: string): Promise<T> => {
            const { pathname, params } = splitPath(path)
            if (pathname === '/tree') return tree as unknown as T
            if (pathname === '/version') return { version: 1 } as unknown as T
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
            if (pathname === '/graph') {
                return (seed.graph ?? { nodes: [], edges: [] }) as unknown as T
            }
            if (pathname === '/update/status') {
                return (seed.updateStatus ?? {
                    current: '0.0.0',
                    latest: '0.0.0',
                    behind: 0,
                }) as unknown as T
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
            if (pathname === '/rows') {
                const { spec } = body as { spec: SourceSpec }
                return new Response(JSON.stringify(resolveRows(spec)), {
                    headers: { 'Content-Type': 'application/json' },
                })
            }
            return new Response('ok')
        },
        put: async (path: string, body: unknown): Promise<Response> => {
            const { pathname } = splitPath(path)
            if (pathname === '/file') {
                const { path: p, contents } = body as {
                    path: string
                    contents: string
                }
                files.set(p, contents)
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
            throw new Error(`fakeTransport: unhandled POST(json) ${path}`)
        },
        writeFileChecked: async (
            path: string,
            contents: string,
            baseText: string,
        ) => {
            const current = files.get(path) ?? ''
            if (current !== baseText)
                return { conflict: true as const, current }
            files.set(path, contents)
            return { conflict: false as const }
        },
        convertHeic: async () => {
            throw new Error('fakeTransport: convertHeic is not supported')
        },
        stageTmpFile: async () => {
            throw new Error('fakeTransport: stageTmpFile is not supported')
        },
        uploadAsset: async () => {
            throw new Error('fakeTransport: uploadAsset is not supported')
        },
        assetUrl: (target: string) => target,
        eventsUrl: () => '',
        base: () => 'fake://storybook',
    }
}
