import { readNote, writeNote } from '../files'
import { AppError } from '../error'
import { parseBaseFile } from '../bases/parse'
import { resolveSource } from '../bases/source'
import { upsertRow, upsertRows, deleteRow, reorderRow } from '../bases/rowOps'
import { todayISO } from '../dates'
import {
    dueCards,
    collectCards,
    noteCards,
    applyReview,
    decksFromCards,
} from '../srs/cards'
import { applyReviewToRow } from '../srs/reviewRow'
import type { ReviewResponse } from '../srs/types'
import type { Row, SourceSpec } from '../bases/types'
import { isDeniedPath } from '../visibility'
import { filterByPath } from '../visibilityFilter'
import { fileBasename } from '../pathUtils'
import {
    ok,
    error,
    requireQueryParam,
    type Handler,
    type RouteContext,
} from './context'

export default function basesRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { denyEntriesForRequest, rowsCache, tasksCache, cfg } = ctx
    return {
        'GET /base': async (req, url) => {
            const path = requireQueryParam(url, 'file')
            // Owner-token gate: a non-owner request whose channel can't see this base file at all
            // gets the same 403 GET /file gives — checked BEFORE the read, like /file below.
            const denyEntries = await denyEntriesForRequest(req)
            if (isDeniedPath(denyEntries, path)) return error('forbidden', 403)
            // readNote() runs the path through resolveInVault (rejects traversal) and
            // throws on a missing file — both surface as 404, with no separate
            // exists() probe that could leak existence or race the read.
            let text: string
            try {
                text = await readNote(cfg.vault, path)
            } catch {
                return error('not found', 404)
            }
            const name = fileBasename(path)
            return ok(parseBaseFile(text, { name, path }))
        },

        // Single source-resolution endpoint: resolve a SourceSpec (base | notes | tasks)
        // to Row[], following base composition + scoped tasks. Read-only despite POST
        // (the body carries the spec), so it lives here, not in mutatingRoutes.
        'POST /rows': async (req, __) => {
            const { spec } = (await req.json()) as { spec: SourceSpec }
            // Per-resolution memo: base composition + notes/tasks `from:` chains can hit the
            // unscoped vault feeds many times in one call. Memoize the providers so they build
            // (or fetch from the server cache) at most once per /rows. Unscoped only — scoped
            // task extraction bypasses these providers and always runs fresh.
            let rowsMemo: Promise<Row[]> | null = null
            let tasksMemo: Promise<Row[]> | null = null
            const rows = await resolveSource(spec, {
                root: cfg.vault,
                today: todayISO(),
                vaultRows: () => (rowsMemo ??= rowsCache.get()),
                vaultTasks: () => (tasksMemo ??= tasksCache.get()),
            })
            const denyEntries = await denyEntriesForRequest(req)
            return ok(filterByPath(rows, denyEntries, r => r.file.path))
        },

        'GET /cards/decks': async (req, __) => {
            const denyEntries = await denyEntriesForRequest(req)
            const cards = filterByPath(
                await collectCards(cfg.vault),
                denyEntries,
                c => c.notePath,
            )
            // Recomputed here (rather than calling collectDecks, which re-derives from ITS OWN
            // un-filtered collectCards call) so a restricted note's cards never leak through as deck
            // totals/due-counts — mirrors collectDecks' own aggregation (core/src/srs/cards.ts).
            const today = todayISO()
            return ok(decksFromCards(cards, today))
        },

        'GET /cards/all': async (req, __) => {
            const cards = await collectCards(cfg.vault)
            const denyEntries = await denyEntriesForRequest(req)
            return ok(filterByPath(cards, denyEntries, c => c.notePath))
        },

        'GET /cards/note': async (req, url) => {
            const path = requireQueryParam(url, 'path')
            const denyEntries = await denyEntriesForRequest(req)
            if (isDeniedPath(denyEntries, path)) return error('forbidden', 403)
            return ok(await noteCards(cfg.vault, path))
        },

        'GET /cards/due': async (req, url) => {
            const deck = url.searchParams.get('deck') ?? undefined
            const cards = await dueCards(cfg.vault, todayISO(), deck)
            const denyEntries = await denyEntriesForRequest(req)
            return ok(filterByPath(cards, denyEntries, c => c.notePath))
        },
    }
}

export function basesMutatingRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { mutatingHandler, readNoteOrEmpty, cfg } = ctx
    return {
        'POST /row/update': mutatingHandler(
            async req => {
                // index === null => append a new row; otherwise replace the row at index.
                const { file, index, note } = (await req.json()) as {
                    file: string
                    index?: number | null
                    note: Record<string, unknown>
                }
                // A MISSING index is not an append. `JSON.stringify` DROPS an undefined
                // value, so a client holding a row with no write-back handle (Row.index)
                // sends no `index` key at all — and `index ?? null` used to turn that into
                // an append, silently DUPLICATING the row the user was editing instead of
                // updating it. Only an explicit null means append; anything else that is
                // not an integer is a bug in the caller and must not be guessed at.
                if (
                    index !== null &&
                    (typeof index !== 'number' || !Number.isInteger(index))
                )
                    throw new AppError(
                        'EINVAL',
                        `row index must be an integer or null to append, got ${JSON.stringify(index)}`,
                        400,
                    )
                const text = await readNoteOrEmpty(cfg.vault, file)
                const name = fileBasename(file)
                const next = upsertRow(
                    text,
                    { name, path: file },
                    index ?? null,
                    note,
                )
                await writeNote(cfg.vault, file, next)
                return ok()
            },
            b => b.file,
        ),

        'POST /rows/update': mutatingHandler(
            async req => {
                const { file, updates } = (await req.json()) as {
                    file: string
                    updates?: Array<{
                        index?: number | null
                        note: Record<string, unknown>
                    }>
                }
                if (!Array.isArray(updates))
                    throw new AppError(
                        'EINVAL',
                        'updates must be an array',
                        400,
                    )
                // Same missing-key hazard as `POST /row/update`: `JSON.stringify` DROPS an
                // undefined value, so a client holding a row with no write-back handle sends
                // an entry with no `index` key at all. Only an explicit null means append.
                for (const u of updates)
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
                const text = await readNoteOrEmpty(cfg.vault, file)
                const name = fileBasename(file)
                const next = upsertRows(
                    text,
                    { name, path: file },
                    updates.map(u => ({
                        index: u.index ?? null,
                        note: u.note,
                    })),
                )
                await writeNote(cfg.vault, file, next)
                return ok()
            },
            b => b.file,
        ),

        'POST /row/delete': mutatingHandler(
            async req => {
                const { file, index } = (await req.json()) as {
                    file: string
                    index?: number
                }
                // Same missing-key hazard as /row/update, and worse here: deleteRow's bounds
                // check `index < 0 || index >= rows.length` is FALSE for undefined (every
                // comparison with NaN is false), so it fell straight through to
                // `rows.splice(undefined, 1)`, which coerces to `splice(0, 1)` and removed
                // the FIRST row whichever one the user actually meant.
                if (typeof index !== 'number' || !Number.isInteger(index))
                    throw new AppError(
                        'EINVAL',
                        `row index must be an integer, got ${JSON.stringify(index)}`,
                        400,
                    )
                const text = await readNote(cfg.vault, file)
                const name = fileBasename(file)
                const next = deleteRow(text, { name, path: file }, index)
                await writeNote(cfg.vault, file, next)
                return ok()
            },
            b => b.file,
        ),

        'POST /row/reorder': mutatingHandler(
            async req => {
                const { file, from, to } = (await req.json()) as {
                    file: string
                    from: number
                    to: number
                }
                const text = await readNote(cfg.vault, file)
                const name = fileBasename(file)
                const next = reorderRow(text, { name, path: file }, from, to)
                await writeNote(cfg.vault, file, next)
                return ok()
            },
            b => b.file,
        ),

        'POST /cards/review': mutatingHandler(
            async req => {
                const body = (await req.json()) as {
                    id?: string
                    response: ReviewResponse
                    question?: string
                    file?: string
                    index?: number
                    // Which scheduling columns to advance — a bidirectional reverse review passes
                    // the `*Back` triple so each direction schedules independently. Default: forward.
                    dueField?: string
                    easeField?: string
                    intervalField?: string
                }
                // Row-based review (flashcard base): advance scheduling columns on the row.
                if (body.file != null && body.index != null) {
                    const text = await readNote(cfg.vault, body.file)
                    const name = fileBasename(body.file)
                    const { rows } = parseBaseFile(text, {
                        name,
                        path: body.file,
                    })
                    const row = rows[body.index]
                    if (!row)
                        throw new AppError(
                            'EINVAL',
                            `row not found: ${body.file}#${body.index}`,
                            400,
                        )
                    const fields =
                        body.dueField && body.easeField && body.intervalField
                            ? {
                                  due: body.dueField,
                                  ease: body.easeField,
                                  interval: body.intervalField,
                              }
                            : undefined
                    const note = applyReviewToRow(
                        row.note,
                        body.response,
                        todayISO(),
                        ctx.appConfig.srs,
                        fields,
                    )
                    const next = upsertRow(
                        text,
                        { name, path: body.file },
                        body.index,
                        note,
                    )
                    await writeNote(cfg.vault, body.file, next)
                    return ok()
                }
                // Legacy: inline note card identified by `${notePath}::${cardIndex}::${subIndex}`.
                if (!body.id)
                    throw new AppError('EINVAL', 'missing cardId', 400)
                await applyReview(
                    cfg.vault,
                    body.id,
                    body.response,
                    todayISO(),
                    body.question,
                    ctx.appConfig.srs,
                )
                return ok()
            },
            b => b.file, // row-based reviews invalidate the base file; legacy reviews leave paths empty
        ),
    }
}
