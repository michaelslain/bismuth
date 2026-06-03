import { join } from "node:path";
import { watch } from "node:fs";
import { createSseRegistry, formatEvent } from "./sse";
import { createAsyncCache } from "./asyncCache";
import { buildGraph } from "./engine";
import { attachLayout, computeViewLayouts } from "./layout-cache";
import { listTree, listTemplates, readNote, writeNote, moveEntry, deleteEntry, createEntry } from "./files";
import { commitVault, snapshotMessage } from "./backup";
import { parseFrontmatter, setFrontmatterKey, deleteFrontmatterKey } from "./frontmatter";
import { AppError } from "./error";
import { buildAgentGraph } from "./agents";
import { buildVaultRows } from "./basesData";
import { parseBaseFile } from "./bases/parse";
import { resolveSource } from "./bases/source";
import { upsertRow, deleteRow } from "./bases/rowOps";
import type { GraphData, TreeEntry } from "./graph";
import { collectVaultTasks, toggleTaskLine } from "./tasks";
import { todayISO } from "./dates";
import { collectDecks, dueCards, collectCards, noteCards, applyReview } from "./srs/cards";
import { applyReviewToRow } from "./srs/reviewRow";
import type { ReviewResponse } from "./srs/types";
import type { Row, SourceSpec } from "./bases/types";
import { createTerminalSession, killSession, resizeSession, getSession } from "./terminal";
import { createChangeTracker, isSettingsPath } from "./changeClassifier";
import { reconcileSettings, setSettingInFile, getVaultSchema, serializeSettingsForFrontend, loadAppConfig, type AppConfig, SETTINGS_FILE, readFolderIcons, setFolderIcon, readDailyNotes } from "./settings";
import { dailyNotePath, dailyNoteContent } from "./dailyNote";
import { DEFAULTS as SETTINGS_DEFAULTS } from "./schema/settingsSchema";
import { searchVault, invalidateSearchIndex } from "./search";
import { replaceInVault } from "./replace";

export interface CoreConfig { vault: string; memory?: string; port?: number }

const enc = new TextEncoder();
const dec = new TextDecoder();

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

/** Extract a note basename (last path segment without the .md extension). */
const noteBasename = (p: string) => p.split("/").pop()!.replace(/\.md$/, "");

/** Standardized success response: JSON data or plain "ok". */
function ok(data?: unknown): Response {
  return data !== undefined ? Response.json(data) : new Response("ok");
}

/** Standardized error response: message + HTTP status code. */
function error(message: string, statusCode: number = 400): Response {
  return new Response(message, { status: statusCode });
}

export function cliArg(name: string): string | undefined {
  const i = Bun.argv.indexOf(`--${name}`);
  return i >= 0 ? Bun.argv[i + 1] : undefined;
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function requireQueryParam(url: URL, param: string): string {
  const value = url.searchParams.get(param);
  if (!value) throw new AppError("EINVAL", `missing ?${param}=`, 400);
  return value;
}

/** Request handler type. */
type Handler = (req: Request, url: URL, cfg: CoreConfig) => Promise<Response> | Response;

export function createServer(cfg: CoreConfig) {
  // On boot: reconcile settings.yaml against SETTINGS_SCHEMA — write a fresh
  // defaults file if absent, or fill in any keys added since the file was written
  // (preserving the user's values, comments, and unknown keys). Fire-and-forget so
  // server start stays synchronous; the write lands within ms. Swallow failures
  // (e.g. a non-existent/read-only vault dir in tests) so it can never take the
  // whole server down on boot.
  void reconcileSettings(cfg.vault).catch(() => {});

  // Backend runtime config (settings.yaml merged over defaults). Seeded synchronously
  // from DEFAULTS so timings are sane before the async load lands, then refreshed on
  // boot and whenever settings.yaml changes (see classifyVault).
  let appConfig: AppConfig = SETTINGS_DEFAULTS as AppConfig;
  void loadAppConfig(cfg.vault).then((c) => { appConfig = c; }).catch(() => {});

  // /graph and /tree go through a deduped, invalidation-safe cache (see asyncCache.ts):
  // concurrent first requests share one build, and a file change mid-build won't
  // repopulate a stale value. cachedRows stays a plain lazy cache (rebuilt on next read).
  const graphCache = createAsyncCache<GraphData>(async () =>
    attachLayout(await buildGraph(cfg.vault, cfg.memory), cfg.vault),
  );
  const treeCache = createAsyncCache<TreeEntry[]>(() => listTree(cfg.vault));
  let cachedRows: Row[] | null = null;
  let version = 0;
  const sse = createSseRegistry();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingVault = new Set<string>();
  let pendingVaultUnknown = false;
  let pendingMemory = false;

  // Tracks each note's graph/tree-relevant fingerprint (wikilinks + tags + icon),
  // so we can stay silent toward graph/tree consumers when a file is rewritten
  // without changing its connections — e.g. a bot status file restamped every
  // couple of seconds.
  const tracker = createChangeTracker();
  const isHidden = (p: string) => p.split("/").some((seg) => seg.startsWith("."));

  // Clear only the caches a change touched, bump version, and tell subscribers
  // exactly what's dirty. We always bump version (so the editor can reconcile an
  // externally-edited open file), but graph/tree consumers skip refetching when
  // their `dirty` flag is false.
  function applyDirty(paths: string[], dirty: { graph: boolean; tree: boolean }) {
    if (dirty.graph) graphCache.invalidate();
    if (dirty.tree) treeCache.invalidate();
    // The search index covers note bodies (and basenames/headings/tags), so even a
    // content-only edit that's dirty to neither graph nor tree changes search results.
    // Drop it on any vault change so the next /search rebuilds from current files.
    invalidateSearchIndex(cfg.vault);
    // Bases rows derive from arbitrary frontmatter/body — rebuild lazily on next read.
    cachedRows = null;
    version++;
    sse.publish({ version, paths, dirty });
  }

  // Re-fingerprint changed vault notes; report whether the graph and/or tree
  // need to change. New/deleted notes are structural (both dirty); a content-only
  // edit that touches no link, tag, or icon is dirty to neither. Non-note and
  // unreadable (e.g. directory) paths are treated as structural to be safe;
  // hidden paths (.git/.trash) never affect graph or tree and are dropped.
  async function classifyVault(paths: string[]): Promise<{ graph: boolean; tree: boolean }> {
    let graph = false;
    let tree = false;
    const notePaths: string[] = [];
    for (const p of paths) {
      if (isHidden(p)) continue;
      if (isSettingsPath(p)) {
        // settings.yaml drives the property registry + appearance — both graph
        // and tree consumers should refetch; /schema reads it fresh on demand.
        // Also refresh the backend runtime config (debounce, heartbeat, …).
        void loadAppConfig(cfg.vault).then((c) => { appConfig = c; }).catch(() => {});
        graph = true;
        tree = true;
        continue;
      }
      if (!p.endsWith(".md")) { graph = true; tree = true; continue; }
      notePaths.push(p);
    }
    const d = await tracker.classify(notePaths, async (p) => {
      try {
        return (await Bun.file(join(cfg.vault, p)).exists()) ? await readNote(cfg.vault, p) : null;
      } catch {
        return null; // unreadable — treated as removed (structural)
      }
    });
    return { graph: graph || d.graph, tree: tree || d.tree };
  }

  // Single entry point for vault content/structure changes (API mutations +
  // file-watch). With no paths the change extent is unknown, so refresh both.
  async function invalidate(...paths: string[]) {
    const dirty = paths.length === 0
      ? { graph: true, tree: true }
      : await classifyVault(paths);
    applyDirty(paths, dirty);
  }

  /** Schedule vault changes for debounced processing. */
  function scheduleVault(path?: string): void {
    if (path) pendingVault.add(path);
    else pendingVaultUnknown = true;
    arm();
  }

  /** Schedule memory changes for debounced processing. */
  function scheduleMemory(): void {
    pendingMemory = true;
    arm();
  }

  function arm() {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const vaultPaths = [...pendingVault];
      const unknown = pendingVaultUnknown;
      const memory = pendingMemory;
      pendingVault.clear();
      pendingVaultUnknown = false;
      pendingMemory = false;
      void (async () => {
        let dirty = { graph: false, tree: false };
        if (unknown) {
          dirty = { graph: true, tree: true };
        } else if (vaultPaths.length) {
          dirty = await classifyVault(vaultPaths);
        }
        // Memory (3rd brain) feeds the graph, never the vault file tree.
        if (memory) dirty.graph = true;
        applyDirty(unknown ? [] : vaultPaths, dirty);
      })();
    }, appConfig.server.fileWatchDebounceMs);
  }

  async function readNoteOrEmpty(vault: string, path: string): Promise<string> {
    const fullPath = join(vault, path);
    const exists = await Bun.file(fullPath).exists();
    return exists ? await readNote(vault, path) : "";
  }

  try {
    watch(cfg.vault, { recursive: true }, (_event, filename) => {
      // Ignore churn in .git (backup commits) and .trash — neither feeds the
      // graph or tree. A null filename means "something changed, extent unknown".
      if (filename && isHidden(filename)) return;
      scheduleVault(filename ?? undefined);
    });
  } catch {
    // vault dir may not exist in test / CI environments
  }
  if (cfg.memory) {
    try {
      watch(cfg.memory, { recursive: true }, () => {
        scheduleMemory();
      });
    } catch {
      // memory dir may be absent
    }
  }

  const routes: Record<string, Handler> = {
    "GET /version": async (_, __) => {
      return ok({ version });
    },

    "GET /events": (_, __) => {
      let subscriber: ReadableStreamDefaultController<Uint8Array>;
      let heartbeat: ReturnType<typeof setInterval>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          subscriber = controller;
          sse.subscribe(controller);
          // Send initial snapshot so client knows current version without waiting for next invalidation.
          if (version > 0) {
            controller.enqueue(
              enc.encode(formatEvent({ version, paths: [] })),
            );
          }
          // SSE comment keeps TCP connection alive past Bun's default 10s idleTimeout.
          const ping = enc.encode(`: keepalive\n\n`);
          heartbeat = setInterval(() => {
            try {
              controller.enqueue(ping);
            } catch {
              // controller already closed
            }
          }, appConfig.server.sseHeartbeatMs);
        },
        cancel() {
          clearInterval(heartbeat);
          sse.unsubscribe(subscriber);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        },
      });
    },

    "GET /graph": async (_, __) => {
      return ok(await graphCache.get());
    },

    "GET /graph/views": async (_, __) => {
      // Compute (and cache) the 2nd/3rd-brain view layouts on demand. attachLayout omits
      // them from /graph until they exist (they're only needed when the user switches to a
      // brain mode), so the client fetches them here on that switch. Cheap on repeat once
      // cached; a later /graph then includes them too.
      const graph = await graphCache.get();
      const views = computeViewLayouts(graph, cfg.vault);
      // Attach the computed views onto the cached graph object IN PLACE rather than
      // invalidating the cache. `graphCache.get()` returns the live cached reference, so
      // mutating `.views` makes a subsequent /graph include them too — without forcing the
      // next /graph to re-walk + re-read the whole vault. A genuine file change still calls
      // graphCache.invalidate() via applyDirty, rebuilding a fresh graph (whose views are
      // recomputed lazily on the next /graph/views), so this never serves stale layouts.
      graph.views = views;
      return ok(views);
    },

    "GET /templates": async () => {
      const folder = appConfig.templates?.folder ?? "Templates";
      return ok(await listTemplates(cfg.vault, folder));
    },

    "GET /tree": async (_, __) => {
      const cachedTree = await treeCache.get();
      // Overlay per-folder icons (stored in settings.yaml) onto directory entries.
      // Done per-request on a shallow copy so a folder-icon change is reflected
      // even when the underlying file tree (cachedTree) hasn't structurally changed
      // and so we never mutate the cache with a value tied to a specific request.
      const folderIcons = await readFolderIcons(cfg.vault);
      const entries = cachedTree.map((e) => {
        if (e.kind === "dir" && folderIcons[e.path]) {
          return { ...e, icon: folderIcons[e.path] };
        }
        return e;
      });
      return ok(entries);
    },

    "GET /vault-data": async (_, __) => {
      if (cachedRows === null) cachedRows = await buildVaultRows(cfg.vault);
      return ok(cachedRows);
    },

    "GET /base": async (_, url) => {
      const path = requireQueryParam(url, "file");
      // readNote() runs the path through resolveInVault (rejects traversal) and
      // throws on a missing file — both surface as 404, with no separate
      // exists() probe that could leak existence or race the read.
      let text: string;
      try {
        text = await readNote(cfg.vault, path);
      } catch {
        return error("not found", 404);
      }
      const name = noteBasename(path);
      return ok(parseBaseFile(text, { name, path }));
    },

    "GET /file": async (_, url) => {
      const path = requireQueryParam(url, "path");
      // settings.yaml is opened as a normal file, but a vault that never had one
      // must not surface a blank editor — reconcile the schema defaults on open
      // (writes a full file if absent; fills any missing keys otherwise). Idempotent
      // and write-only-if-changed; the boot reconcile can't be relied on alone since
      // it's fire-and-forget and a long-running server may predate a schema change.
      if (path === SETTINGS_FILE) await reconcileSettings(cfg.vault);
      const noteText = await readNoteOrEmpty(cfg.vault, path);
      return new Response(noteText, { status: 200 });
    },

    "PUT /file": async (req, __) => {
      const { path, contents } = (await req.json()) as { path: string; contents: string };
      await writeNote(cfg.vault, path, contents);
      await invalidate(path);
      return ok();
    },

    "GET /meta": async (_, url) => {
      const path = requireQueryParam(url, "path");
      const noteText = await readNoteOrEmpty(cfg.vault, path);
      const { data } = parseFrontmatter(noteText);
      return ok(data);
    },

    "GET /config": async (_, __) => {
      // Read-only view of how core was launched — surfaced in the settings page.
      return ok({ vault: cfg.vault, memory: cfg.memory ?? null });
    },

    "GET /settings": async (_, __) => {
      // Parsed app settings (file merged over defaults) for frontend hydration.
      return ok(await serializeSettingsForFrontend(cfg.vault));
    },

    "GET /schema": async (_, __) => {
      // Property registry (from settings.yaml `properties:`) for note validation + autocomplete.
      return ok(await getVaultSchema(cfg.vault));
    },

    "GET /agent-graph": async (_, __) => {
      return ok(buildAgentGraph());
    },

    "GET /tasks": async (_, __) => {
      return ok(await collectVaultTasks(cfg.vault));
    },

    // Single source-resolution endpoint: resolve a SourceSpec (base | notes | tasks)
    // to Row[], following base composition + scoped tasks. Read-only despite POST
    // (the body carries the spec), so it lives here, not in mutatingRoutes.
    "POST /rows": async (req, __) => {
      const { spec } = (await req.json()) as { spec: SourceSpec };
      const rows = await resolveSource(spec, { root: cfg.vault, today: todayISO() });
      return ok(rows);
    },

    "POST /backup": async (_, __) => {
      const committed = await commitVault(cfg.vault, snapshotMessage());
      return ok({ committed });
    },

    // Vault full-text search (Omnisearch-style ranking). Read-only despite POST
    // (the body carries the query + toggles), so it lives in routes, not mutatingRoutes.
    "POST /search": async (req, __) => {
      const { query, opts } = (await req.json()) as {
        query: string;
        opts: { caseSensitive: boolean; wholeWord: boolean; regex: boolean };
      };
      try {
        const results = await searchVault(cfg.vault, query, opts);
        return Response.json(results);
      } catch (e) {
        // Invalid regex etc. — surface as a 400 so the UI shows it inline.
        return new Response((e as Error).message, { status: 400 });
      }
    },

    "GET /cards/decks": async (_, __) => {
      return ok(await collectDecks(cfg.vault, todayISO()));
    },

    "GET /cards/all": async (_, __) => {
      return ok(await collectCards(cfg.vault));
    },

    "GET /cards/note": async (_, url) => {
      const path = requireQueryParam(url, "path");
      return ok(await noteCards(cfg.vault, path));
    },

    "GET /cards/due": async (_, url) => {
      const deck = url.searchParams.get("deck") ?? undefined;
      return ok(await dueCards(cfg.vault, todayISO(), deck));
    },
  };


  function mutatingHandler(
    run: (req: Request, url: URL) => Promise<Response> | Response,
    pathOf?: (body: any) => string | string[] | undefined,
  ): Handler {
    return async (req, url) => {
      // Tee the body so we can both read it for path extraction and pass it to run.
      const cloned = req.clone();
      const res = await run(req, url);
      let paths: string[] = [];
      if (pathOf) {
        try {
          const body = await cloned.json();
          const p = pathOf(body);
          if (typeof p === "string") paths = [p];
          else if (Array.isArray(p)) paths = p;
        } catch {
          // body wasn't JSON — that's fine, we just won't know the path
        }
      }
      await invalidate(...paths);
      return res;
    };
  }

  const mutatingRoutes: Record<string, Handler> = {
    // Vault-wide find-and-replace. Takes a git snapshot FIRST (the undo path),
    // then rewrites matched files. pathOf returns the scope path for a single-file
    // replace; for a vault-wide replace it returns undefined → full invalidation.
    "POST /replace": mutatingHandler(
      async (req) => {
        const { query, replacement, opts, scope } = (await req.json()) as {
          query: string;
          replacement: string;
          opts: { caseSensitive: boolean; wholeWord: boolean; regex: boolean };
          scope: string;
        };
        try {
          await commitVault(cfg.vault, snapshotMessage());
          const result = await replaceInVault(cfg.vault, query, replacement, opts, scope);
          return Response.json(result);
        } catch (e) {
          return new Response((e as Error).message, { status: 400 });
        }
      },
      (b) => (b.scope && b.scope !== "vault" ? b.scope : undefined),
    ),

    "POST /move": mutatingHandler(
      async (req) => {
        const { from, to } = (await req.json()) as { from: string; to: string };
        await moveEntry(cfg.vault, from, to);
        return ok();
      },
      (b) => [b.from, b.to],
    ),

    "POST /delete": mutatingHandler(
      async (req) => {
        const { path } = (await req.json()) as { path: string };
        return ok(deleteEntry(cfg.vault, path));
      },
      (b) => b.path,
    ),

    "POST /restore": mutatingHandler(
      async (req) => {
        const { trashPath, to } = (await req.json()) as { trashPath: string; to: string };
        moveEntry(cfg.vault, trashPath, to);
        return ok();
      },
      (b) => b.to,
    ),

    "POST /create": mutatingHandler(
      async (req) => {
        const { path, kind } = (await req.json()) as { path: string; kind: "file" | "dir" };
        createEntry(cfg.vault, path, kind);
        return ok();
      },
      (b) => b.path,
    ),

    "POST /set-setting": mutatingHandler(
      async (req) => {
        // The single backend write path for settings.yaml: merge one value at `path`
        // in place (preserving comments + the properties registry + unknown keys).
        // Frontend toggles call this instead of rewriting the whole file.
        const body = (await req.json()) as { path?: unknown; value?: unknown };
        if (!Array.isArray(body.path) || !body.path.every((s) => typeof s === "string")) {
          return error("bad path", 400);
        }
        await setSettingInFile(cfg.vault, body.path as string[], body.value);
        return ok({ ok: true });
      },
      () => SETTINGS_FILE, // invalidate settings.yaml so subscribers re-hydrate
    ),

    "POST /set-property": mutatingHandler(
      async (req) => {
        // Used by the Bases kanban drag-drop: flip a single frontmatter key on a note.
        const { path, key, value } = (await req.json()) as { path: string; key: string; value: unknown };
        // Refuse to write to a path that doesn't exist — silently creating notes
        // (which readNoteOrEmpty + writeNote would do) hides mistakes from callers.
        const raw = await readNoteOrEmpty(cfg.vault, path);
        if (raw === "" && !(await Bun.file(join(cfg.vault, path)).exists())) {
          return error("note not found", 404);
        }
        const next = setFrontmatterKey(raw, key, value);
        await writeNote(cfg.vault, path, next);
        return ok();
      },
      (b) => b.path,
    ),

    "POST /delete-property": mutatingHandler(
      async (req) => {
        // Remove a single frontmatter key (e.g. resetting a note's icon to default).
        const { path, key } = (await req.json()) as { path: string; key: string };
        const raw = await readNoteOrEmpty(cfg.vault, path);
        if (raw === "" && !(await Bun.file(join(cfg.vault, path)).exists())) {
          return error("note not found", 404);
        }
        const next = deleteFrontmatterKey(raw, key);
        await writeNote(cfg.vault, path, next);
        return ok();
      },
      (b) => b.path,
    ),

    "POST /row/update": mutatingHandler(
      async (req) => {
        // index === null => append a new row; otherwise replace the row at index.
        const { file, index, note } = (await req.json()) as {
          file: string;
          index: number | null;
          note: Record<string, unknown>;
        };
        const text = await readNoteOrEmpty(cfg.vault, file);
        const name = noteBasename(file);
        const next = upsertRow(text, { name, path: file }, index ?? null, note);
        await writeNote(cfg.vault, file, next);
        return ok();
      },
      (b) => b.file,
    ),

    "POST /row/delete": mutatingHandler(
      async (req) => {
        const { file, index } = (await req.json()) as { file: string; index: number };
        const text = await readNote(cfg.vault, file);
        const name = noteBasename(file);
        const next = deleteRow(text, { name, path: file }, index);
        await writeNote(cfg.vault, file, next);
        return ok();
      },
      (b) => b.file,
    ),

    "POST /folder-icon": mutatingHandler(
      async (req) => {
        // Assign (or clear) an icon for a folder. Folders have no frontmatter, so
        // the mapping lives in settings.yaml and is overlaid onto /tree dir entries.
        const { path, icon } = (await req.json()) as { path: string; icon?: string | null };
        if (typeof path !== "string" || path.length === 0) {
          return error("missing path", 400);
        }
        // Reject traversal / absolute paths — folder paths are vault-relative.
        const segments = path.split("/");
        if (path.startsWith("/") || segments.some((s) => s === ".." || s === ".")) {
          return error("invalid path", 400);
        }
        await setFolderIcon(cfg.vault, path, icon ?? "");
        return ok();
      },
      // settings.yaml change → invalidate broadly; pass its path so classifyVault
      // marks both graph & tree dirty (isSettingsPath), refreshing /tree.
      () => "settings.yaml",
    ),

    "POST /tasks/toggle": mutatingHandler(
      async (req) => {
        const { path, line } = (await req.json()) as { path: string; line: number };
        const content = await readNote(cfg.vault, path);
        const lines = content.split("\n");
        if (line < 0 || line >= lines.length) {
          throw new AppError("EINVAL", "line out of range", 400);
        }
        // toggleTaskLine may return TWO lines (recurrence: the next occurrence is
        // inserted above the completed one, separated by "\n"). Splicing the result
        // back as a single array slot keeps that ordering after join("\n").
        lines[line] = toggleTaskLine(lines[line], todayISO());
        await writeNote(cfg.vault, path, lines.join("\n"));
        return ok();
      },
      (b) => b.path,
    ),

    "POST /cards/review": mutatingHandler(
      async (req) => {
        const body = (await req.json()) as {
          id?: string;
          response: ReviewResponse;
          question?: string;
          file?: string;
          index?: number;
        };
        // Row-based review (flashcard base): advance scheduling columns on the row.
        if (body.file != null && body.index != null) {
          const text = await readNote(cfg.vault, body.file);
          const name = noteBasename(body.file);
          const { rows } = parseBaseFile(text, { name, path: body.file });
          const row = rows[body.index];
          if (!row) throw new AppError("EINVAL", `row not found: ${body.file}#${body.index}`, 400);
          const note = applyReviewToRow(row.note, body.response, todayISO(), appConfig.srs);
          const next = upsertRow(text, { name, path: body.file }, body.index, note);
          await writeNote(cfg.vault, body.file, next);
          return ok();
        }
        // Legacy: inline note card identified by `${notePath}::${cardIndex}::${subIndex}`.
        if (!body.id) throw new AppError("EINVAL", "missing cardId", 400);
        await applyReview(cfg.vault, body.id, body.response, todayISO(), body.question, appConfig.srs);
        return ok();
      },
      (b) => b.file, // row-based reviews invalidate the base file; legacy reviews leave paths empty
    ),

    "POST /daily-note": mutatingHandler(async (req) => {
      const { id } = (await req.json()) as { id: string };
      const config = (await readDailyNotes(cfg.vault)).find((c) => c.id === id);
      if (!config) return error(`unknown daily note: ${id}`, 400);
      const now = new Date();
      const path = dailyNotePath(config, now);
      if (await Bun.file(join(cfg.vault, path)).exists()) {
        return ok({ path, created: false });
      }
      let templateRaw: string | null = null;
      if (config.template && (await Bun.file(join(cfg.vault, config.template)).exists())) {
        templateRaw = await readNote(cfg.vault, config.template);
      }
      await writeNote(cfg.vault, path, dailyNoteContent(config, now, templateRaw));
      return ok({ path, created: true });
    }),
  };

  // Warm the graph + tree caches off the critical path so the first webview request
  // finds them ready (or already building, and deduped) instead of paying the build
  // serially after launch. Errors are swallowed (e.g. vault dir absent in tests).
  graphCache.warm();
  treeCache.warm();

  return Bun.serve({
    port: cfg.port ?? 4321,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return withCors(new Response(null));

      // Terminal WebSocket upgrade.
      if (req.method === "GET" && url.pathname === "/terminal") {
        const cols = Number(url.searchParams.get("cols"));
        const rows = Number(url.searchParams.get("rows"));
        if (!Number.isInteger(cols) || !Number.isInteger(rows) ||
            cols < 1 || cols > 500 || rows < 1 || rows > 500) {
          return withCors(error("bad cols/rows", 400));
        }
        const origin = req.headers.get("origin");
        // Allow:
        // - same-origin (no Origin header, e.g. Tauri webview)
        // - localhost/127.0.0.1 on any port (Vite dev server, the Tauri webview, browser-based local dev)
        // - tauri://localhost (Tauri scheme on some platforms)
        const allowed =
          !origin ||
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
          /^tauri:\/\//.test(origin);
        if (!allowed) {
          return withCors(error("forbidden origin", 403));
        }
        const session = createTerminalSession({ cwd: cfg.vault, cols, rows });
        const upgraded = server.upgrade(req, { data: { sessionId: session.id } });
        if (!upgraded) {
          killSession(session.id);
          return withCors(error("upgrade failed", 400));
        }
        return new Response(null, { status: 101 }); // upgrade response is sent by Bun
      }

      const route = `${req.method} ${url.pathname}`;
      const handler = routes[route] ?? mutatingRoutes[route];

      if (!handler) {
        return withCors(error("not found", 404));
      }

      try {
        const res = await handler(req, url, cfg);
        return withCors(res);
      } catch (e) {
        const err = e instanceof AppError ? e : new AppError("INTERNAL_ERROR", (e as Error).message, 500);
        return withCors(error(err.message, err.statusCode));
      }
    },

    websocket: {
      open(ws) {
        const data = ws.data as { sessionId: string; dataSub?: { dispose(): void }; exitSub?: { dispose(): void } };
        const s = getSession(data.sessionId);
        if (!s) { ws.close(); return; }
        // Pipe PTY -> ws. Store disposables so we can clean them up on close.
        data.dataSub = s.pty.onData((d: string) => { ws.send(enc.encode(d)); });
        data.exitSub = s.pty.onExit(() => { try { ws.close(); } catch { /* */ } });
      },
      message(ws, msg) {
        const { sessionId } = ws.data as { sessionId: string };
        const s = getSession(sessionId);
        if (!s) return;
        const bytes = msg instanceof ArrayBuffer
          ? new Uint8Array(msg)
          : msg instanceof Uint8Array
            ? msg
            : new TextEncoder().encode(msg as string);
        if (bytes.length === 0) return;
        const tag = bytes[0];
        if (tag === 0x00) {
          s.pty.write(dec.decode(bytes.subarray(1)));
        } else if (tag === 0x01 && bytes.length >= 5) {
          const view = new DataView(bytes.buffer, bytes.byteOffset + 1, 4);
          const cols = view.getUint16(0, true);
          const rows = view.getUint16(2, true);
          resizeSession(sessionId, cols, rows);
        }
      },
      close(ws) {
        const data = ws.data as { sessionId: string; dataSub?: { dispose(): void }; exitSub?: { dispose(): void } };
        // Dispose PTY listeners immediately so no ws.send is called on the closed socket.
        data.dataSub?.dispose();
        data.exitSub?.dispose();
        // Grace period to absorb kernel/network races. No resume in v1.
        setTimeout(() => killSession(data.sessionId), 3000);
      },
    },
  });
}

if (import.meta.main) {
  const vault = cliArg("vault");
  const memory = cliArg("memory");
  if (!vault || !memory) {
    console.error("usage: server --vault <2nd-brain dir> --memory <3rd-brain dir> [--port n]");
    process.exit(1);
  }
  const portArg = cliArg("port");
  const s = createServer({ vault, memory, port: portArg ? Number(portArg) : 4321 });
  console.log(`core listening on http://localhost:${s.port}`);
}
