import { join, relative } from 'node:path'
import { renameLayoutIds } from '../layout-cache'
import {
    listTemplates,
    readNote,
    writeNote,
    moveEntry,
    deleteEntry,
    createEntry,
    resolveAsset,
    writeBinary,
    uniqueAssetPath,
} from '../files'
import { commitVault, scheduleBackup, snapshotMessage } from '../backup'
import { parseFrontmatter } from '../frontmatter'
import { AppError } from '../error'
import { moveEntrySynced } from '../gcal/moveSynced'
import { SyncLocked } from '../gcal/lock'
import { fetchRemoteAsset, extForContentType } from '../assetFetch'
import { setBaseConfigKey, deleteBaseConfigKey } from '../bases/baseFile'
import type { TreeEntry } from '../graph'
import { invalidateChatVisibility } from '../chat'
import { convertHeicToJpeg } from '../heic'
import { stageTmpFile } from '../tmpFiles'
import {
    reconcileSettings,
    SETTINGS_FILE,
    setFolderIcon,
    setFolderVisibility,
    readDailyNotes,
} from '../settings'
import {
    resolveVisibility,
    resolveFolderVisibility,
    isDeniedPath,
    type Visibility,
} from '../visibility'
import { filterByPath } from '../visibilityFilter'
import { dailyNotePath, dailyNoteContent } from '../dailyNote'
import { searchVault } from '../search'
import { promptSearch } from '../searchPrompt'
import { listFsPaths } from '../fsPaths'
import { replaceInVault } from '../replace'
import { spawnVaultBackend } from '../openFolder'
import {
    ok,
    error,
    requireQueryParam,
    isSafeAssetTarget,
    type Handler,
    type RouteContext,
} from './context'

/** Cap on a single uploaded attachment (POST /asset). Bounds memory + disk per request. */
const MAX_ASSET_BYTES = 100 * 1024 * 1024 // 100 MB

export default function vaultRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const {
        denyEntriesForRequest,
        invalidate,
        markSelfWritten,
        rearmSelfWritten,
        readNoteOrEmpty,
        requestChannel,
        rowsCache,
        treeCache,
        unmarkSelfWritten,
        cfg,
    } = ctx
    return {
        'GET /templates': async (_, __) => {
            const folder = ctx.appConfig.templates?.folder ?? 'Templates'
            return ok(await listTemplates(cfg.vault, folder))
        },

        'GET /tree': async (_, __) => {
            const cachedTree = await treeCache.get()
            // Overlay per-folder icons + resolved AI visibility (both stored in settings.yaml)
            // onto tree entries. Done per-request on a shallow copy so a folder-icon/visibility
            // change is reflected even when the underlying file tree (cachedTree) hasn't
            // structurally changed and so we never mutate the cache with a value tied to a
            // specific request. Visibility is RESOLVED here (core/src/visibility.ts) from each
            // entry's own raw frontmatter value (files) or path (dirs) + folderVisibility, so
            // the badge the tree shows can never disagree with what buildDenyPaths enforces —
            // both call the same resolver.
            const folderIcons =
                (ctx.appConfig.folderIcons as
                    Record<string, string> | undefined) ?? {}
            const folderVisibility =
                (ctx.appConfig.folderVisibility as
                    Record<string, Visibility> | undefined) ?? {}
            const entries = cachedTree.map(e => {
                const next: TreeEntry = { ...e }
                if (e.kind === 'dir' && folderIcons[e.path])
                    next.icon = folderIcons[e.path]
                // Stash the node's OWN explicit setting before `visibility` gets overwritten below —
                // a file's raw frontmatter value (dropping a rare explicit "all", which the context
                // menu doesn't need to distinguish from absent) or a dir's own folderVisibility entry.
                const own =
                    e.kind === 'dir' ? folderVisibility[e.path] : e.visibility
                if (own === 'chat-only' || own === 'hidden')
                    next.ownVisibility = own
                else delete next.ownVisibility
                const resolved =
                    e.kind === 'dir'
                        ? resolveFolderVisibility(e.path, folderVisibility)
                        : resolveVisibility(
                              e.path,
                              e.visibility,
                              folderVisibility,
                          )
                if (resolved === 'all') delete next.visibility
                else next.visibility = resolved
                return next
            })
            return ok(entries)
        },

        'GET /vault-data': async (req, __) => {
            const rows = await rowsCache.get()
            const denyEntries = await denyEntriesForRequest(req)
            return ok(filterByPath(rows, denyEntries, r => r.file.path))
        },

        'GET /file': async (req, url) => {
            const path = requireQueryParam(url, 'path')
            // settings.yaml is opened as a normal file, but a vault that never had one
            // must not surface a blank editor — reconcile the schema defaults on open
            // (writes a full file if absent; fills any missing keys otherwise). Idempotent
            // and write-only-if-changed; the boot reconcile can't be relied on alone since
            // it's fire-and-forget and a long-running server may predate a schema change.
            if (path === SETTINGS_FILE) await reconcileSettings(cfg.vault)
            // Owner-token gate: THE verified live bypass this whole gate exists to close
            // (`curl 'localhost:4321/file?path=Private/secret.md'`) — a non-owner request whose
            // channel can't see this path is refused outright, never served empty-or-partial.
            const denyEntries = await denyEntriesForRequest(req)
            if (isDeniedPath(denyEntries, path)) return error('forbidden', 403)
            // Only a MISSING file is an empty body (a brand-new note/drawing). Any other read
            // failure (EACCES, EIO, EISDIR) must surface as an error: an empty 200 reads to a
            // client as "nothing here", and a drawing page then opens an editable blank doc whose
            // next autosave overwrites the real file.
            let noteText: string
            try {
                noteText = await readNote(cfg.vault, path)
            } catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
                noteText = ''
            }
            return new Response(noteText, { status: 200 })
        },

        // Optional `baseText` is an OPTIMISTIC-CONCURRENCY guard (#46 — data-loss bug: an autosave
        // racing an external writer to the same file silently clobbered whichever side wrote last).
        // When present, the write only proceeds if the file still holds exactly `baseText` — the
        // content the caller's buffer was derived from; a mismatch means someone else wrote to this
        // file since, so we 409 with the CURRENT on-disk content instead of overwriting it, letting
        // the caller (Editor.tsx's autosave, via `threeWayMerge` in saveReconcile.ts) merge the two
        // edits rather than silently discarding one. Omitting `baseText` preserves the historical
        // unconditional-write behavior for every other PUT /file caller (sheets, drawings, bases,
        // settings import, template creation, …) — none of those have a meaningful "expected prior
        // content" to compare against, and widening the check to all of them is out of scope here.
        'PUT /file': async (req, __) => {
            const { path, contents, baseText } = (await req.json()) as {
                path: string
                contents: string
                baseText?: string
            }
            if (baseText !== undefined) {
                const onDisk = await readNoteOrEmpty(cfg.vault, path)
                if (onDisk !== baseText) {
                    // Nothing is written on a 409 — do NOT mark, there's no write to echo.
                    return new Response(JSON.stringify({ current: onDisk }), {
                        status: 409,
                        headers: { 'Content-Type': 'application/json' },
                    })
                }
            }
            // PUT /file bypasses mutatingHandler (it's in the read-table routes, not
            // mutatingRoutes — see the table comment at the top of the file), so it must mark
            // its own write for self-write suppression exactly like mutatingHandler does: mark
            // on intent before the write, unmark on a throw (nothing was written), rearm once
            // the write actually resolves. Without this every save produced TWO SSE events —
            // this handler's own invalidate() below, then the OS watcher noticing its own echo
            // a beat later and scheduling a second, identical one.
            markSelfWritten([path])
            try {
                await writeNote(cfg.vault, path, contents)
            } catch (e) {
                unmarkSelfWritten([path])
                throw e
            }
            rearmSelfWritten([path])
            await invalidate(path)
            return ok()
        },

        // Serve a vault file as BINARY (image/PDF/audio/video) for `![[...]]` embeds. Resolves
        // FILENAME-FIRST (resolveAsset), streams the bytes with a Content-Type inferred from the
        // extension (Bun.file). Read-only; traversal is guarded inside resolveAsset/resolveInVault.
        //
        // NOT gated by the owner-token filter (deliberate, documented gap — see docs/vault/visibility.md
        // and the audit that closed the rest of this oracle): this URL is handed straight to a native
        // `<img src>`/`<embed>`/`<video src>`/`<source>` element (app/src/PreviewView.tsx, CardsView.tsx,
        // embedSpec.ts) — none of which can attach a custom header, so gating this route would 403 the
        // OWNER's own image/PDF/audio/video embeds with no way for the frontend to prove who it is. A
        // hidden note's BINARY attachment therefore stays reachable by an agent that already knows (or
        // guesses) its path, same class as the existing "existence isn't secret" gap (`ls -la`, /tree's
        // badge) — now extended to binary bytes specifically. Closing it needs a different mechanism
        // (e.g. a short-lived signed asset URL) and is out of scope for this pass.
        'GET /asset': async (req, url) => {
            const path = requireQueryParam(url, 'path')
            const abs = await resolveAsset(cfg.vault, path)
            // Channel-filtered like every other content-returning read route. This route serves BYTES —
            // a hidden PDF, image or drawing is exactly the kind of note someone hides, and it is one
            // `curl` away otherwise. The owner (the app, which carries the token) is never filtered, so
            // ordinary <img src>/<embed> rendering is unaffected. Checked AFTER resolution so the
            // symlink-resolved path is what gets tested, matching how the deny list is built.
            if (abs) {
                const denied = await denyEntriesForRequest(req)
                if (
                    denied.length > 0 &&
                    (isDeniedPath(denied, abs) || isDeniedPath(denied, path))
                ) {
                    return error('forbidden', 403, {
                        'Cache-Control': 'no-store',
                    })
                }
            }
            // `no-store` on the miss (#38): a "not found" is only ever a TRANSIENT fact about a
            // mutable vault — the file can be created/renamed into place moments later (a pasted
            // screenshot, a race with the file watcher, a wikilink clicked before its target
            // exists yet). 404 is heuristically cacheable by default (RFC 9110 §15.3) with no
            // explicit Cache-Control, so a long-lived cache — a packaged desktop app's WKWebView
            // keeps one NSURLCache for the whole session, unlike a browser tab reloaded fresh each
            // dev test — could otherwise pin a stale 404 for this exact `?path=` forever, long
            // after the underlying file (and any resolution bug) is fixed: every retry keeps
            // hitting the cached miss instead of ever re-asking the (now-correct) server.
            if (!abs)
                return error('asset not found', 404, {
                    'Cache-Control': 'no-store',
                })
            const file = Bun.file(abs)
            // Short cache so re-opening a note doesn't re-fetch (and re-walk the vault for the
            // filename-first resolution) every time; `private` keeps it out of shared proxies.
            const headers: Record<string, string> = {
                'Content-Type': file.type || 'application/octet-stream',
                'Cache-Control': 'private, max-age=60',
            }
            // SECURITY — a `.html` asset embedded via `![[viz.html]]` is served as text/html and framed
            // as a LIVE document (sandboxed iframe, sandbox="allow-scripts", opaque origin — see
            // app/src/editor/embedBlock.ts). The sandbox alone does NOT protect the vault: relative URLs
            // inside the artifact resolve against THIS server (its document URL), and the API is
            // unauthenticated with Access-Control-Allow-Origin:* (withCors, ~line 102 above), so a
            // malicious artifact's `fetch('/file?path=private.md')` would SUCCEED (ACAO:* matches the
            // frame's null origin). This CSP is the load-bearing second half: `connect-src 'none'` kills
            // fetch/XHR/WebSocket/EventSource, `form-action 'none'` blocks form POSTs, and `default-src
            // 'none'` + the narrow allowances block every external subresource — while a self-contained
            // artifact still runs FULLY (inline <script>/<style>, inline SVG, data:/blob: images/scripts).
            // BOTH layers are required (the element sandbox AND this response CSP); neither is optional.
            if (/\.html?$/i.test(abs)) {
                headers['Content-Security-Policy'] =
                    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'"
            }
            return new Response(file, { headers })
        },

        // Resolve a vault-relative path to its ABSOLUTE machine-local path (FILENAME-FIRST, like
        // /asset; traversal-guarded inside resolveAsset). Backs the preview tab's "Open in default
        // app" / "Reveal in Finder" affordances, which need a real filesystem path to hand to the OS
        // opener. Read-only; 404 when nothing matches (never cached — see GET /asset above).
        //
        // Owner-token gate: unlike /asset (below — a native `<img src>`/`<embed>`/`<video>` load that
        // CANNOT carry a custom header, so it stays ungated), this route is only ever called via the
        // frontend's own fetch() (api.ts's absPath()), which — like every other transport call —
        // attaches X-Bismuth-Token. Gating it costs the owner nothing and closes a residual leak (an
        // agent learning a hidden note's real filesystem path). resolveAsset resolves FILENAME-FIRST
        // (the query `path` may be a bare basename that lives anywhere in the vault), so the deny
        // check runs on the RESOLVED path (relative() unjoins resolveAsset's `join(root, hit.rel)`
        // back to a vault-relative form with no realpath/symlink assumptions), not the raw query.
        'GET /abs-path': async (req, url) => {
            const path = requireQueryParam(url, 'path')
            const abs = await resolveAsset(cfg.vault, path)
            if (!abs)
                return error('not found', 404, { 'Cache-Control': 'no-store' })
            const denyEntries = await denyEntriesForRequest(req)
            if (isDeniedPath(denyEntries, relative(cfg.vault, abs)))
                return error('forbidden', 403, { 'Cache-Control': 'no-store' })
            return ok({ path: abs })
        },

        // Save pasted/dropped attachment bytes into the vault. The frontend sends the desired
        // vault-relative path (under the configured attachments folder) as ?path= and the raw
        // bytes as the body; the backend de-collides the name and returns the path actually used
        // so the caller inserts the right `![[basename]]`. NOT a mutation: attachments are invisible
        // to the graph/tree/search caches (listTree excludes them), so nothing needs invalidating —
        // the subsequent note edit that inserts the embed triggers its own normal invalidation.
        'POST /asset': async (req, url) => {
            const target = requireQueryParam(url, 'path')
            // Defense in depth: only ever CREATE a plain file under the vault. Reject dotfolder
            // segments (e.g. `.git/hooks/pre-commit`, which the next backupOnSave git commit would
            // execute → RCE) and traversal. resolveInVault (in writeBinary) blocks vault-escape;
            // uniqueAssetPath ensures we never overwrite an existing file.
            if (!isSafeAssetTarget(target))
                return error('invalid attachment path', 400)
            const declared = Number(req.headers.get('content-length') ?? 0)
            if (declared > MAX_ASSET_BYTES)
                return error('attachment too large', 413)
            const bytes = await req.arrayBuffer()
            if (bytes.byteLength > MAX_ASSET_BYTES)
                return error('attachment too large', 413)
            const finalRel = uniqueAssetPath(cfg.vault, target)
            await writeBinary(cfg.vault, finalRel, bytes)
            return ok({ path: finalRel })
        },

        // Download a remote image (a URL dragged/pasted from the browser, e.g. an <img> src
        // lifted off a web page) into the vault, the server-side half of `POST /asset`'s upload
        // path — the frontend has bytes in neither case, only a URL, so this fetches them first.
        // Same target-safety + size-cap reasoning as `POST /asset`; NOT a mutation for the same
        // reason (attachments are invisible to the graph/tree/search caches).
        'POST /asset/fetch': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const { url, path: target } = (await req.json()) as {
                url?: string
                path?: string
            }
            if (!url) throw new AppError('EINVAL', 'missing url', 400)
            if (!target) throw new AppError('EINVAL', 'missing path', 400)
            if (!isSafeAssetTarget(target))
                return error('invalid attachment path', 400)
            const { bytes, contentType } = await fetchRemoteAsset(url, {
                maxBytes: MAX_ASSET_BYTES,
            })
            // A URL rarely names its own extension reliably (query strings, redirects, extensionless
            // CDN paths) — trust the server's declared content type over the URL when they disagree,
            // same as a browser "Save Image As" would.
            const wantExt = extForContentType(contentType)
            const dot = target.lastIndexOf('.')
            const haveExt =
                dot >= 0 ? target.slice(dot + 1).toLowerCase() : undefined
            const desiredPath =
                wantExt && wantExt !== haveExt
                    ? `${dot >= 0 ? target.slice(0, dot) : target}.${wantExt}`
                    : target
            const finalRel = uniqueAssetPath(cfg.vault, desiredPath)
            await writeBinary(cfg.vault, finalRel, bytes)
            return ok({ path: finalRel })
        },

        // Transcode HEIC/HEIF bytes to JPEG (heic.ts). A photo dragged out of Finder is almost
        // always HEIC, which no model — and no Chromium build — can read; the frontend posts the
        // bytes here and attaches/embeds the JPEG that comes back. NOT a mutation: nothing is
        // written to the vault, this is a pure byte transform.
        'POST /convert/heic': async req => {
            const declared = Number(req.headers.get('content-length') ?? 0)
            if (declared > MAX_ASSET_BYTES) return error('image too large', 413)
            const bytes = new Uint8Array(await req.arrayBuffer())
            if (bytes.byteLength > MAX_ASSET_BYTES)
                return error('image too large', 413)
            // AppError("HEIC_DECODE_ERROR", …, 400) for undecodable input is mapped to its status by
            // the route wrapper, so an unreadable photo surfaces as a 400 the composer can explain.
            const jpeg = await convertHeicToJpeg(bytes)
            return new Response(jpeg as unknown as BodyInit, {
                headers: {
                    'Content-Type': 'image/jpeg',
                    'Cache-Control': 'no-store',
                },
            })
        },

        // Stage bytes at a real filesystem path OUTSIDE the vault (tmpFiles.ts) and return that
        // absolute path. Chat references dropped files by path rather than base64-inlining them,
        // but a PASTED file (or a browser-build drop) carries bytes with no path — this is what
        // gives those a path without turning every dropped file into a permanent vault attachment.
        // NOT a mutation: nothing under the vault changes, so no cache invalidation is owed.
        'POST /tmp-file': async (req, url) => {
            const name = requireQueryParam(url, 'name')
            const declared = Number(req.headers.get('content-length') ?? 0)
            if (declared > MAX_ASSET_BYTES) return error('file too large', 413)
            const bytes = new Uint8Array(await req.arrayBuffer())
            if (bytes.byteLength > MAX_ASSET_BYTES)
                return error('file too large', 413)
            // safeTmpName (tmpFiles.ts) reduces the untrusted name to one path segment, so a
            // traversal-shaped name can't escape the scratch dir.
            return ok({ path: await stageTmpFile(name, bytes) })
        },

        'GET /meta': async (req, url) => {
            const path = requireQueryParam(url, 'path')
            const denyEntries = await denyEntriesForRequest(req)
            if (isDeniedPath(denyEntries, path)) return error('forbidden', 403)
            const noteText = await readNoteOrEmpty(cfg.vault, path)
            const { data } = parseFrontmatter(noteText)
            return ok(data)
        },

        'POST /backup': async (_, __) => {
            // Coalesced: editor autosave hits this on every save, so debounce into one commit per quiet
            // window instead of committing on each keystroke-save (the .git-bloat / iCloud-conflict cause).
            scheduleBackup(cfg.vault, () => snapshotMessage())
            return ok({ scheduled: true })
        },

        // Open (or create) today's daily note. Lives in routes — NOT mutatingRoutes —
        // so the no-op case (note already exists) doesn't bump version / broadcast SSE.
        // When we DO create the note, invalidate ONLY its path (not the whole vault).
        'POST /daily-note': async req => {
            const { id } = (await req.json()) as { id: string }
            const config = (await readDailyNotes(cfg.vault)).find(
                c => c.id === id,
            )
            if (!config) return error(`unknown daily note: ${id}`, 400)
            const now = new Date()
            const path = dailyNotePath(config, now)
            if (await Bun.file(join(cfg.vault, path)).exists()) {
                return ok({ path, created: false })
            }
            let templateRaw: string | null = null
            if (
                config.template &&
                (await Bun.file(join(cfg.vault, config.template)).exists())
            ) {
                templateRaw = await readNote(cfg.vault, config.template)
            }
            await writeNote(
                cfg.vault,
                path,
                dailyNoteContent(config, now, templateRaw),
            )
            await invalidate(path)
            return ok({ path, created: true })
        },

        // Open a folder as its own brain in a new window: spawn a sibling core server
        // pointed at `folder` (process-per-vault, like Obsidian) and return its URL. The
        // frontend opens a window with `?api=<url>`. Read-only w.r.t. THIS vault (it only
        // launches a new process), so it lives in routes, not mutatingRoutes. The new
        // backend reuses this server's memory dir unless one is supplied.
        'POST /open-folder': async (req, _url) => {
            const { folder, memory } = (await req.json()) as {
                folder: string
                memory?: string
            }
            const mem = memory ?? cfg.memory
            if (!mem)
                throw new AppError('EINVAL', 'no memory dir configured', 400)
            const spawned = await spawnVaultBackend({
                folder,
                memory: mem,
                serverEntry: import.meta.path,
                cwd: import.meta.dir,
            })
            return ok({ url: spawned.url, vault: spawned.vault })
        },

        // Vault full-text search (Omnisearch-style ranking). Read-only despite POST
        // (the body carries the query + toggles), so it lives in routes, not mutatingRoutes.
        'POST /search': async (req, __) => {
            const { query, opts, snippetLimit } = (await req.json()) as {
                query: string
                opts: {
                    caseSensitive: boolean
                    wholeWord: boolean
                    regex: boolean
                }
                snippetLimit?: number
            }
            try {
                const results = await searchVault(cfg.vault, query, opts, {
                    snippetLimit,
                })
                const denyEntries = await denyEntriesForRequest(req)
                return Response.json(
                    filterByPath(results, denyEntries, r => r.path),
                )
            } catch (e) {
                // Invalid regex etc. — surface as a 400 so the UI shows it inline.
                return new Response((e as Error).message, { status: 400 })
            }
        },

        // AI prompt-search fallback: re-rank keyword candidates with a one-shot Haiku turn when the
        // literal /search comes up empty for a natural-language question (searchPrompt.ts). Read-only
        // despite POST (like /search) — no cache-invalidate/SSE — so it lives in routes. Errors map to
        // AppError.statusCode: no-claude → 400 (shown inline), model failure → 500.
        'POST /search-prompt': async (req, __) => {
            const { query } = (await req.json()) as { query: string }
            try {
                const results = await promptSearch(cfg.vault, query)
                const denyEntries = await denyEntriesForRequest(req)
                return Response.json(
                    filterByPath(results, denyEntries, r => r.path),
                )
            } catch (e) {
                const status = e instanceof AppError ? e.statusCode : 500
                return new Response((e as Error).message, { status })
            }
        },

        // List filesystem directory entries matching a partial path — backs autocomplete
        // for `scope:"fs"` settings, which name a path OUTSIDE the vault.
        // Read-only despite POST (the body carries the partial path), so it lives here.
        'POST /list-dir': async (req, __) => {
            const { path, only } = (await req.json()) as {
                path?: string
                only?: 'dir' | 'file'
            }
            return ok({ entries: await listFsPaths(path ?? '', only) })
        },
    }
}

export function vaultMutatingRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { graphCache, mutatingHandler, readNoteOrNull, cfg } = ctx
    return {
        // Vault-wide find-and-replace. Takes a git snapshot FIRST (the undo path),
        // then rewrites matched files. pathOf returns the scope path for a single-file
        // replace; for a vault-wide replace it returns undefined → full invalidation.
        'POST /replace': mutatingHandler(
            async req => {
                const { query, replacement, opts, scope } =
                    (await req.json()) as {
                        query: string
                        replacement: string
                        opts: {
                            caseSensitive: boolean
                            wholeWord: boolean
                            regex: boolean
                        }
                        scope: string
                    }
                try {
                    await commitVault(cfg.vault, snapshotMessage())
                    const result = await replaceInVault(
                        cfg.vault,
                        query,
                        replacement,
                        opts,
                        scope,
                    )
                    return Response.json(result)
                } catch (e) {
                    return new Response((e as Error).message, { status: 400 })
                }
            },
            b => (b.scope && b.scope !== 'vault' ? b.scope : undefined),
        ),

        'POST /move': mutatingHandler(
            async req => {
                const { from, to } = (await req.json()) as {
                    from: string
                    to: string
                }
                // Google sync state is keyed by base path: moveEntrySynced re-keys it with the
                // move under one sync lock. The bare legacy key is claimed only by the installed app.
                try {
                    await moveEntrySynced(cfg.vault, from, to, {
                        claimLegacy: !!process.env.BISMUTH_APP_PATH,
                    })
                } catch (e) {
                    if (e instanceof SyncLocked)
                        throw new AppError('EBUSY', e.message, 409)
                    throw e
                }
                // Remap this path's cached layout seed id (or, for a renamed FOLDER, every id
                // under it) from `from` to `to` — without this, a rename cold-starts the next
                // layout build instead of warm-starting from the position the renamed node/
                // folder already had, which is most of why a rename's graph took ~11s to
                // settle instead of near-instant. See layout-cache.ts's renameLayoutIds for the
                // exact fromRel matching rule (file vs folder prefix).
                renameLayoutIds(cfg.vault, from, to)
                // Invalidate in the SAME synchronous step, not only later in mutatingHandler's
                // invalidate() (which first awaits classifyVault's reads): a graph build whose walk
                // read the tree before the move could otherwise reach attachLayout inside that gap and
                // lay out a pre-rename graph. Aborted here, a cancellable build never writes its seed;
                // a full settle is guarded by the epoch graphCache captured before its walk. The later
                // invalidate in applyDirty stays — it is what publishes the change.
                graphCache.invalidate()
                return ok()
            },
            b => [b.from, b.to],
        ),

        'POST /delete': mutatingHandler(
            async req => {
                const { path } = (await req.json()) as { path: string }
                return ok(deleteEntry(cfg.vault, path))
            },
            b => b.path,
        ),

        'POST /restore': mutatingHandler(
            async req => {
                const { trashPath, to } = (await req.json()) as {
                    trashPath: string
                    to: string
                }
                moveEntry(cfg.vault, trashPath, to)
                return ok()
            },
            b => b.to,
        ),

        'POST /create': mutatingHandler(
            async req => {
                const { path, kind } = (await req.json()) as {
                    path: string
                    kind: 'file' | 'dir'
                }
                createEntry(cfg.vault, path, kind)
                return ok()
            },
            b => b.path,
        ),

        'POST /set-property': mutatingHandler(
            async req => {
                // Used by the Bases kanban drag-drop: flip a single frontmatter key on a note. A
                // `type: base` note still carrying a legacy `views:` list is flattened first, so a
                // view key (column order, colours, sort…) always lands at the top level.
                const { path, key, value } = (await req.json()) as {
                    path: string
                    key: string
                    value: unknown
                }
                // Refuse to write to a path that doesn't exist — silently creating notes
                // (which readNoteOrEmpty + writeNote would do) hides mistakes from callers.
                const raw = await readNoteOrNull(cfg.vault, path)
                if (raw === null) {
                    return error('note not found', 404)
                }
                const next = setBaseConfigKey(path, raw, key, value)
                await writeNote(cfg.vault, path, next)
                // A file's `visibility:` edit re-gates open chats — but ONLY that key: /set-property is
                // also the Bases kanban drag-drop path, so invalidating on every property write would
                // needlessly respawn every chat on each kanban move.
                if (key === 'visibility') invalidateChatVisibility()
                return ok()
            },
            b => b.path,
        ),

        'POST /delete-property': mutatingHandler(
            async req => {
                // Remove a single frontmatter key (e.g. resetting a note's icon to default).
                const { path, key } = (await req.json()) as {
                    path: string
                    key: string
                }
                const raw = await readNoteOrNull(cfg.vault, path)
                if (raw === null) {
                    return error('note not found', 404)
                }
                const next = deleteBaseConfigKey(path, raw, key)
                await writeNote(cfg.vault, path, next)
                if (key === 'visibility') invalidateChatVisibility() // clearing visibility re-gates open chats
                return ok()
            },
            b => b.path,
        ),

        'POST /set-properties': mutatingHandler(
            async req => {
                // Batch frontmatter writes across (possibly many) notes in ONE request → ONE invalidation
                // → ONE SSE bump → ONE view refetch. The kanban drag-drop uses this so a reorder (which
                // reindexes several cards) doesn't fire a burst of /set-property calls, each of which would
                // bump the version and re-resolve the base — that storm remounts the whole card grid
                // (flicker). Writes to the same note are folded into a single read-modify-write.
                const { writes } = (await req.json()) as {
                    writes: Array<{ path: string; key: string; value: unknown }>
                }
                const byPath = new Map<
                    string,
                    Array<{ key: string; value: unknown }>
                >()
                for (const w of writes ?? []) {
                    const list = byPath.get(w.path) ?? []
                    list.push({ key: w.key, value: w.value })
                    byPath.set(w.path, list)
                }
                const skipped: string[] = []
                for (const [path, ops] of byPath) {
                    const raw = await readNoteOrNull(cfg.vault, path)
                    if (raw === null) {
                        skipped.push(path) // a note that vanished: reported, not fatal to the batch
                        continue
                    }
                    let next = raw
                    for (const op of ops)
                        next = setBaseConfigKey(path, next, op.key, op.value)
                    await writeNote(cfg.vault, path, next)
                }
                return ok({ skipped })
            },
            b =>
                Array.isArray(b.writes)
                    ? ([
                          ...new Set(
                              (b.writes as Array<{ path: string }>).map(
                                  w => w.path,
                              ),
                          ),
                      ] as string[])
                    : undefined,
        ),

        'POST /folder-icon': mutatingHandler(
            async req => {
                // Assign (or clear) an icon for a folder. Folders have no frontmatter, so
                // the mapping lives in settings.yaml and is overlaid onto /tree dir entries.
                const { path, icon } = (await req.json()) as {
                    path: string
                    icon?: string | null
                }
                if (typeof path !== 'string' || path.length === 0) {
                    return error('missing path', 400)
                }
                // Reject traversal / absolute paths — folder paths are vault-relative.
                const segments = path.split('/')
                if (
                    path.startsWith('/') ||
                    segments.some(s => s === '..' || s === '.')
                ) {
                    return error('invalid path', 400)
                }
                await setFolderIcon(cfg.vault, path, icon ?? '')
                // GET /tree overlays icons from the cached ctx.appConfig (no per-request .settings read),
                // and the watcher-driven loadAppConfig refresh lands a debounce (~250ms) AFTER this
                // mutation's SSE — patch the in-memory map synchronously so the client's immediate
                // refetch already sees the new icon instead of a stale flash.
                const icons = {
                    ...((ctx.appConfig.folderIcons as
                        Record<string, string> | undefined) ?? {}),
                }
                if (icon) icons[path] = icon
                else delete icons[path]
                ctx.appConfig = { ...ctx.appConfig, folderIcons: icons }
                return ok()
            },
            // settings.yaml change → invalidate broadly; pass its path so classifyVault
            // marks both graph & tree dirty (isSettingsPath), refreshing /tree.
            () => SETTINGS_FILE,
        ),

        'POST /folder-visibility': mutatingHandler(
            async req => {
                // Assign (or clear) AI visibility for a folder. Folders have no frontmatter, so
                // the mapping lives in settings.yaml and is overlaid onto /tree file+dir entries
                // (core/src/visibility.ts resolveVisibility/resolveFolderVisibility).
                const { path, visibility } = (await req.json()) as {
                    path: string
                    visibility?: string | null
                }
                if (typeof path !== 'string' || path.length === 0) {
                    return error('missing path', 400)
                }
                // Reject traversal / absolute paths — folder paths are vault-relative.
                const segments = path.split('/')
                if (
                    path.startsWith('/') ||
                    segments.some(s => s === '..' || s === '.')
                ) {
                    return error('invalid path', 400)
                }
                if (
                    visibility !== 'chat-only' &&
                    visibility !== 'hidden' &&
                    visibility !== null &&
                    visibility !== undefined
                ) {
                    return error('invalid visibility', 400)
                }
                // Only claim success — and patch the in-memory config / badge — if the write actually
                // PERSISTED. A corrupt .settings leaves the map untouched and returns false; optimistically
                // patching ctx.appConfig then would show a "hidden" badge (and imply enforcement) for a state
                // that was never written. Normalize the key to match setFolderVisibility's own write.
                const persisted = await setFolderVisibility(
                    cfg.vault,
                    path,
                    visibility ?? null,
                )
                if (!persisted) {
                    return error(
                        'settings file is invalid — fix .settings before changing folder visibility',
                        409,
                    )
                }
                // A folder-visibility change re-gates every open chat: flag live sessions so their next
                // turn respawns query() with a fresh deny list (managedSettings/sandbox are spawn-fixed).
                invalidateChatVisibility()
                const key = path.replace(/\/+$/, '').replace(/\/{2,}/g, '/')
                // Same synchronous ctx.appConfig patch as /folder-icon: GET /tree overlays visibility
                // from the cached ctx.appConfig, and the watcher-driven loadAppConfig refresh lands a
                // debounce (~250ms) AFTER this mutation's SSE — patch in-memory so the client's
                // immediate refetch already sees the new value instead of a stale flash.
                const visibilities = {
                    ...((ctx.appConfig.folderVisibility as
                        Record<string, Visibility> | undefined) ?? {}),
                }
                if (visibility) visibilities[key] = visibility
                else delete visibilities[key]
                ctx.appConfig = {
                    ...ctx.appConfig,
                    folderVisibility: visibilities,
                }
                return ok()
            },
            // settings.yaml change → invalidate broadly; pass its path so classifyVault
            // marks both graph & tree dirty (isSettingsPath), refreshing /tree.
            () => SETTINGS_FILE,
        ),
    }
}
