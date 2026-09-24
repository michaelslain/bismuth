// In-process backend — the no-HTTP "server" for iPad/iOS, where the Bun
// HTTP server can't run. It reuses the exact same logic modules the HTTP server
// does (engine, bases, search, tasks, srs, frontmatter), but instead of
// Bun.serve it exposes `dispatch(method, path, body)` that the WebView calls
// directly (see app/src/mobile/inProcessTransport.ts). All vault IO goes through
// the active FileAccess (a tauri-plugin-fs impl on iOS), so nothing here statically
// imports Bun/node:fs.
//
// COVERED: the read path (graph, tree, file, meta, base, rows, tasks, cards,
// search, settings-defaults) and content-only writes (file, set/delete-property,
// row update/delete, tasks/toggle, cards/review, replace). NOT YET COVERED
// (throw NOT_SUPPORTED): structural fs ops (create/move/delete/restore),
// folder-icon + set-setting (settings.yaml writer), asset upload, backup/git,
// open-folder — these need FileAccess extended with create/move/delete + a
// settings writer, tracked as the next increment. Also NOT_SUPPORTED: every
// /daemon/* write (cron/process toggle, cron run, cron/process create, cron/process
// delete) — the HTTP server owner-gates these (they mutate the shared daemon
// machine dir, not the vault, and CORS is `*`), and the in-process transport has no
// notion of an owner channel at all, so it refuses them outright rather than
// silently running unauthenticated.
import { buildGraph } from './engine'
import { attachLayout, computeViewLayouts } from './layout-cache'
import { getFileAccess } from './fileAccess'
import {
    parseFrontmatter,
    setFrontmatterKey,
    setFrontmatterViewKey,
    deleteFrontmatterKey,
    deleteFrontmatterViewKey,
} from './frontmatter'
import { parseBaseFile } from './bases/parse'
import { resolveSource } from './bases/source'
import { upsertRow, upsertRows, deleteRow, reorderRow } from './bases/rowOps'
import { collectVaultTasks, toggleTaskLine } from './tasks'
import { reorderTaskBlocks } from './taskReorder'
import {
    collectDecks,
    dueCards,
    collectCards,
    noteCards,
    applyReview,
} from './srs/cards'
import { applyReviewToRow } from './srs/reviewRow'
import { DEFAULT_SRS } from './srs/scheduler'
import { buildVaultRows } from './basesData'
import { searchVault } from './search'
import { replaceInVault } from './replace'
import { todayISO } from './dates'
import { fileBasename } from './pathUtils'
import { AppError } from './error'
import { DEFAULTS as SETTINGS_DEFAULTS } from './schema/settingsSchema'
import type { SourceSpec } from './bases/types'
import type { ReviewResponse } from './srs/types'

export interface LocalBackendConfig {
    vault: string
    memory?: string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT'

/** A change listener (replaces SSE). Fires after any mutating dispatch. */
export type ChangeListener = (evt: { version: number; paths: string[] }) => void

export function createLocalBackend(cfg: LocalBackendConfig) {
    const { vault, memory } = cfg
    let version = 0
    const listeners = new Set<ChangeListener>()

    // Lazy graph cache mirroring the HTTP server's behavior: rebuild on next read
    // after a mutation invalidates it. Tree/rows rebuild per call (cheap enough for
    // a first cut; lazy indexing is a documented follow-up for big vaults).
    let graph: Awaited<ReturnType<typeof buildGraph>> | null = null

    async function getGraph() {
        if (!graph)
            graph = await attachLayout(await buildGraph(vault, memory), vault)
        return graph
    }

    function emit(paths: string[]) {
        version++
        graph = null // structural-or-content change: rebuild graph lazily
        for (const cb of listeners) cb({ version, paths })
    }

    const fa = () => getFileAccess()

    /** Read a note, or null if it doesn't exist (parity with the server's exists() guard). */
    async function readOrNull(rel: string): Promise<string | null> {
        try {
            return await (await fa()).readNote(vault, rel)
        } catch {
            return null
        }
    }

    function notSupported(route: string): never {
        throw new AppError(
            'EINVAL',
            `${route} is not supported by the in-process backend yet`,
            501,
        )
    }

    /** Dispatch an api call (method + path + parsed JSON body) to its handler,
     *  returning the plain data (NOT a Response). Query params are parsed from `path`. */
    async function dispatch(
        method: HttpMethod,
        path: string,
        body?: unknown,
    ): Promise<unknown> {
        const url = new URL(path, 'http://local')
        const route = `${method} ${url.pathname}`
        const q = (name: string) => url.searchParams.get(name) ?? ''
        const b = (body ?? {}) as Record<string, any>
        const access = await fa()

        switch (route) {
            // ---- reads ----
            case 'GET /version':
                return { version }
            case 'GET /graph':
                return getGraph()
            case 'GET /graph/views': {
                const g = await getGraph()
                const views = await computeViewLayouts(g, vault)
                g.views = views
                return views
            }
            case 'GET /tree':
                return access.listTree(vault)
            case 'GET /vault-data':
                return buildVaultRows(vault)
            case 'GET /config':
                return { vault, memory: memory ?? null }
            case 'GET /settings':
                // First cut: schema defaults (no settings.yaml reconcile/merge yet — a
                // documented follow-up). The app store seeds from these and stays usable.
                return SETTINGS_DEFAULTS
            case 'GET /schema':
                return { properties: {} }
            case 'GET /templates':
                return [] // listTemplates needs a dir walk — follow-up
            case 'GET /file': {
                return (await readOrNull(q('path'))) ?? ''
            }
            case 'GET /meta': {
                const text = (await readOrNull(q('path'))) ?? ''
                return parseFrontmatter(text).data
            }
            case 'GET /base': {
                const file = q('file')
                const text = await readOrNull(file)
                if (text === null)
                    throw new AppError('ENOENT', 'not found', 404)
                return parseBaseFile(text, {
                    name: fileBasename(file),
                    path: file,
                })
            }
            case 'GET /tasks':
                return collectVaultTasks(vault)
            case 'GET /cards/decks':
                return collectDecks(vault, todayISO())
            case 'GET /cards/all':
                return collectCards(vault)
            case 'GET /cards/note':
                return noteCards(vault, q('path'))
            case 'GET /cards/due':
                return dueCards(
                    vault,
                    todayISO(),
                    url.searchParams.get('deck') ?? undefined,
                )

            // ---- reads via POST (body carries args) ----
            case 'POST /rows':
                return resolveSource(b.spec as SourceSpec, {
                    root: vault,
                    today: todayISO(),
                })
            case 'POST /search':
                return searchVault(vault, b.query as string, b.opts, {
                    snippetLimit: b.snippetLimit,
                })

            // ---- content-only writes ----
            case 'PUT /file': {
                await access.writeNote(vault, b.path, b.contents)
                emit([b.path])
                return 'ok'
            }
            case 'POST /set-property': {
                const raw = await readOrNull(b.path)
                if (raw === null)
                    throw new AppError('ENOENT', 'note not found', 404)
                const next =
                    typeof b.viewIndex === 'number'
                        ? setFrontmatterViewKey(
                              raw,
                              b.viewIndex,
                              b.key,
                              b.value,
                          )
                        : setFrontmatterKey(raw, b.key, b.value)
                await access.writeNote(vault, b.path, next)
                emit([b.path])
                return 'ok'
            }
            case 'POST /set-properties': {
                // Batches per-note like server.ts's handler: fold every write to the same
                // path into one read-modify-write, skip a note that vanished rather than
                // failing the whole batch, emit each written path once.
                const writes = (b.writes ?? []) as Array<{
                    path: string
                    key: string
                    value: unknown
                }>
                const byPath = new Map<
                    string,
                    Array<{ key: string; value: unknown }>
                >()
                for (const w of writes) {
                    const list = byPath.get(w.path) ?? []
                    list.push({ key: w.key, value: w.value })
                    byPath.set(w.path, list)
                }
                const written: string[] = []
                for (const [path, ops] of byPath) {
                    const raw = await readOrNull(path)
                    if (raw === null) continue // skip a note that vanished; don't fail the batch
                    let next = raw
                    for (const op of ops)
                        next = setFrontmatterKey(next, op.key, op.value)
                    await access.writeNote(vault, path, next)
                    written.push(path)
                }
                emit(written)
                return 'ok'
            }
            case 'POST /delete-property': {
                const raw = await readOrNull(b.path)
                if (raw === null)
                    throw new AppError('ENOENT', 'note not found', 404)
                const next =
                    typeof b.viewIndex === 'number'
                        ? deleteFrontmatterViewKey(raw, b.viewIndex, b.key)
                        : deleteFrontmatterKey(raw, b.key)
                await access.writeNote(vault, b.path, next)
                emit([b.path])
                return 'ok'
            }
            case 'POST /row/update': {
                // A MISSING index is not an append. A caller building this body from a row
                // with no write-back handle (Row.index) simply leaves the key out, and
                // `b.index ?? null` used to turn that into an append — silently DUPLICATING
                // the row the user was editing instead of updating it. Only an explicit null
                // means append. Same guard as `POST /row/update` in server.ts: this is the
                // same write path over a different transport, and on iPad it is the ONLY
                // one. It lives here rather than in `upsertRow` because only the dispatch
                // boundary can tell an omitted key from a deliberate null.
                if (
                    b.index !== null &&
                    (typeof b.index !== 'number' || !Number.isInteger(b.index))
                )
                    throw new AppError(
                        'EINVAL',
                        `row index must be an integer or null to append, got ${JSON.stringify(b.index)}`,
                        400,
                    )
                const text = (await readOrNull(b.file)) ?? ''
                const name = fileBasename(b.file)
                await access.writeNote(
                    vault,
                    b.file,
                    upsertRow(
                        text,
                        { name, path: b.file },
                        b.index ?? null,
                        b.note,
                    ),
                )
                emit([b.file])
                return 'ok'
            }
            case 'POST /rows/update': {
                // Same missing-key hazard as /row/update, batched: this is the row analogue
                // of /set-properties on the in-process transport, for the same reason server.ts
                // has one — a kanban drop is inherently a batch of row writes and looping the
                // single-row case would rewrite the file once per row.
                if (!Array.isArray(b.updates))
                    throw new AppError(
                        'EINVAL',
                        'updates must be an array',
                        400,
                    )
                for (const u of b.updates)
                    if (
                        u.index !== null &&
                        (typeof u.index !== 'number' ||
                            !Number.isInteger(u.index))
                    )
                        throw new AppError(
                            'EINVAL',
                            `row index must be an integer or null to append, got ${JSON.stringify(u.index)}`,
                            400,
                        )
                const text = (await readOrNull(b.file)) ?? ''
                const name = fileBasename(b.file)
                await access.writeNote(
                    vault,
                    b.file,
                    upsertRows(
                        text,
                        { name, path: b.file },
                        b.updates.map(
                            (u: {
                                index?: number | null
                                note: Record<string, unknown>
                            }) => ({
                                index: u.index ?? null,
                                note: u.note,
                            }),
                        ),
                    ),
                )
                emit([b.file])
                return 'ok'
            }
            case 'POST /row/delete': {
                // Same missing-key hazard as /row/update, and worse: deleteRow's bounds check
                // `index < 0 || index >= rows.length` is FALSE for undefined (every
                // comparison with NaN is false), so it fell through to
                // `rows.splice(undefined, 1)` — which coerces to `splice(0, 1)` and removed
                // the FIRST row whichever one the user actually meant.
                if (typeof b.index !== 'number' || !Number.isInteger(b.index))
                    throw new AppError(
                        'EINVAL',
                        `row index must be an integer, got ${JSON.stringify(b.index)}`,
                        400,
                    )
                const text = await readOrNull(b.file)
                if (text === null)
                    throw new AppError('ENOENT', 'note not found', 404)
                const name = fileBasename(b.file)
                await access.writeNote(
                    vault,
                    b.file,
                    deleteRow(text, { name, path: b.file }, b.index),
                )
                emit([b.file])
                return 'ok'
            }
            case 'POST /row/reorder': {
                const text = await readOrNull(b.file)
                if (text === null)
                    throw new AppError('ENOENT', 'note not found', 404)
                const name = fileBasename(b.file)
                await access.writeNote(
                    vault,
                    b.file,
                    reorderRow(text, { name, path: b.file }, b.from, b.to),
                )
                emit([b.file])
                return 'ok'
            }
            case 'POST /tasks/toggle': {
                const content = await readOrNull(b.path)
                if (content === null)
                    throw new AppError('ENOENT', 'note not found', 404)
                const lines = content.split('\n')
                if (b.line < 0 || b.line >= lines.length)
                    throw new AppError('EINVAL', 'line out of range', 400)
                lines[b.line] = toggleTaskLine(lines[b.line], todayISO())
                await access.writeNote(
                    vault,
                    b.path,
                    reorderTaskBlocks(lines.join('\n')),
                )
                emit([b.path])
                return 'ok'
            }
            case 'POST /cards/review': {
                if (b.file != null && b.index != null) {
                    const text = await readOrNull(b.file)
                    if (text === null)
                        throw new AppError('ENOENT', 'note not found', 404)
                    const name = fileBasename(b.file)
                    const { rows } = parseBaseFile(text, { name, path: b.file })
                    const row = rows[b.index]
                    if (!row)
                        throw new AppError(
                            'EINVAL',
                            `row not found: ${b.file}#${b.index}`,
                            400,
                        )
                    const note = applyReviewToRow(
                        row.note,
                        b.response as ReviewResponse,
                        todayISO(),
                        DEFAULT_SRS,
                    )
                    await access.writeNote(
                        vault,
                        b.file,
                        upsertRow(text, { name, path: b.file }, b.index, note),
                    )
                    emit([b.file])
                    return 'ok'
                }
                if (!b.id) throw new AppError('EINVAL', 'missing cardId', 400)
                await applyReview(
                    vault,
                    b.id,
                    b.response as ReviewResponse,
                    todayISO(),
                    b.question,
                    DEFAULT_SRS,
                )
                emit([])
                return 'ok'
            }
            case 'POST /replace': {
                const result = await replaceInVault(
                    vault,
                    b.query,
                    b.replacement,
                    b.opts,
                    b.scope,
                )
                emit(b.scope && b.scope !== 'vault' ? [b.scope] : [])
                return result
            }

            // ---- structural ops: not in this increment (need FileAccess create/move/
            // delete + a settings.yaml writer + binary asset IO) ----
            case 'POST /move':
            case 'POST /delete':
            case 'POST /restore':
            case 'POST /create':
            case 'POST /set-setting':
            case 'POST /folder-icon':
            case 'POST /daily-note':
            case 'POST /backup':
            case 'POST /open-folder':
            // ---- daemon writes: owner-gated on the HTTP server; this transport has no
            // owner-channel concept at all, so refuse rather than run unauthenticated ----
            case 'POST /daemon/cron/toggle':
            case 'POST /daemon/cron/run':
            case 'POST /daemon/process/toggle':
            case 'POST /daemon/cron/delete':
            case 'POST /daemon/process/delete':
                return notSupported(route)

            default:
                throw new AppError(
                    'ENOENT',
                    `no in-process handler for ${route}`,
                    404,
                )
        }
    }

    return {
        dispatch,
        /** Subscribe to change events; returns an unsubscribe fn. */
        subscribe(cb: ChangeListener): () => void {
            listeners.add(cb)
            return () => listeners.delete(cb)
        },
        getVersion: () => version,
    }
}

export type LocalBackend = ReturnType<typeof createLocalBackend>
