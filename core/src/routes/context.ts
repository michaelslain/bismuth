import { AppError } from '../error'
import type { CoreConfig } from '../server'
import type { createSseRegistry } from '../sse'
import type { AsyncCache } from '../asyncCache'
import type { GraphData, TreeEntry } from '../graph'
import type { Row } from '../bases/types'
import type { MigrationReport } from '../taskMigrateRun'
import type { AppConfig } from '../settings'
import type { createStatusRunner } from '../statusBarRun'
import type { normalizeStatusBar } from '../statusBarItems'
import type { RequestChannel } from '../ownerToken'
import type { DenyEntry } from '../visibility'

/** Request handler type. */
export type Handler = (
    req: Request,
    url: URL,
    cfg: CoreConfig,
) => Promise<Response> | Response

/** Everything a route handler reads from createServer's closure. Mutable createServer locals are
 *  exposed as getters, so a handler always reads the live value — never destructure those three
 *  (appConfig, version, taskMigration) out of the context, read them as `ctx.x` at the point of use. */
export type RouteContext = {
    cfg: CoreConfig
    appConfig: AppConfig
    readonly version: number
    readonly server: { readonly port: number | undefined }
    readonly taskMigration: MigrationReport | null
    sse: ReturnType<typeof createSseRegistry>
    graphCache: AsyncCache<GraphData>
    treeCache: AsyncCache<TreeEntry[]>
    rowsCache: AsyncCache<Row[]>
    tasksCache: AsyncCache<Row[]>
    bootReconcile: Promise<void>
    statusRunner: ReturnType<typeof createStatusRunner>
    statusItems: () => Promise<ReturnType<typeof normalizeStatusBar>>
    invalidate: (...paths: string[]) => Promise<void>
    markSelfWritten: (paths: string[]) => void
    rearmSelfWritten: (paths: string[]) => void
    unmarkSelfWritten: (paths: string[]) => void
    readNoteOrEmpty: (vault: string, path: string) => Promise<string>
    readNoteOrNull: (vault: string, path: string) => Promise<string | null>
    requestChannel: (req: Request) => RequestChannel
    denyEntriesForRequest: (req: Request) => Promise<DenyEntry[]>
    mutatingHandler: (
        run: (req: Request, url: URL) => Promise<Response> | Response,
        pathOf?: (body: any) => string | string[] | undefined,
    ) => Handler
}

// Access-Control-Allow-Headers must name every custom request header a real client actually
// attaches, or the browser's preflight refuses the follow-up request outright (the request never
// even reaches this server — Bun's `fetch` in tests doesn't enforce this, which is exactly how
// this gap went uncaught; see the OPTIONS-preflight test in ownerToken.test.ts).
// X-Bismuth-Token: attached by every app/src/api.ts transport call once an owner token is resolved
// (ownerTokenHeaders()) — the sole reason this fix exists. X-Bismuth-Channel is NOT listed here on
// purpose: nothing in this codebase sends it over an actual cross-origin HTTP request today (it
// only appears in server-side tests that call resolveRequestChannel/fetch directly); add it here
// the moment a real client starts sending it, not before.
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Bismuth-Token',
    // Lets the browser cache a preflight response instead of re-sending OPTIONS before every
    // request to a new URL — each one otherwise costs a full round trip AND occupies one of the
    // browser's 6 per-host connections. 600s (10min) is the value itself: WebKit/Safari caps
    // Access-Control-Max-Age at 600 regardless of what's sent, so anything higher is a no-op there.
    'Access-Control-Max-Age': '600',
}

/** True if `rel` is a safe attachment destination: a vault-relative path of plain
 *  (non-dot) segments with no traversal. Rejecting dot-segments blocks writing into
 *  `.git/` (whose hooks would execute on the next git-backed save), `.obsidian/`, etc. */
export function isSafeAssetTarget(rel: string): boolean {
    const segs = rel.split('/')
    return (
        segs.length > 0 &&
        segs.every(
            s => s !== '' && s !== '.' && s !== '..' && !s.startsWith('.'),
        )
    )
}

/** Standardized success response: JSON data or plain "ok". */
export function ok(data?: unknown): Response {
    return data !== undefined ? Response.json(data) : new Response('ok')
}

/** Standardized error response: message + HTTP status code. `headers` lets a call site opt
 *  into e.g. `Cache-Control: no-store` (see GET /asset's 404 below) without every other
 *  error() caller having to think about caching. */
export function error(
    message: string,
    statusCode: number = 400,
    headers?: HeadersInit,
): Response {
    return new Response(message, {
        status: statusCode,
        ...(headers && { headers }),
    })
}

export function withCors(res: Response): Response {
    const headers = new Headers(res.headers)
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
    return new Response(res.body, { status: res.status, headers })
}

export function requireQueryParam(url: URL, param: string): string {
    const value = url.searchParams.get(param)
    if (!value) throw new AppError('EINVAL', `missing ?${param}=`, 400)
    return value
}
