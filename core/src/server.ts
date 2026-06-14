import { join } from "node:path";
import { watch } from "node:fs";
import { createSseRegistry, formatEvent } from "./sse";
import { createAsyncCache } from "./asyncCache";
import { buildGraph } from "./engine";
import { attachLayout, computeViewLayouts } from "./layout-cache";
import { listTree, listTemplates, readNote, writeNote, moveEntry, deleteEntry, createEntry, resolveAsset, writeBinary, uniqueAssetPath } from "./files";
import { commitVault, snapshotMessage } from "./backup";
import { parseFrontmatter, setFrontmatterKey, deleteFrontmatterKey } from "./frontmatter";
import { AppError } from "./error";
import { buildAgentGraph } from "./agents";
import { buildVaultRows } from "./basesData";
import { buildTaskRows } from "./bases/tasksData";
import { parseBaseFile } from "./bases/parse";
import { resolveSource } from "./bases/source";
import { upsertRow, deleteRow, reorderRow } from "./bases/rowOps";
import type { GraphData, TreeEntry } from "./graph";
import { collectVaultTasks, toggleTaskLine, setTaskLineStatus } from "./tasks";
import { todayISO } from "./dates";
import { collectDecks, dueCards, collectCards, noteCards, applyReview } from "./srs/cards";
import { applyReviewToRow } from "./srs/reviewRow";
import type { ReviewResponse } from "./srs/types";
import type { Row, SourceSpec } from "./bases/types";
import { createTerminalSession, killSession, resizeSession, getSession, getSessionByTermId, scheduleSessionKill, cancelSessionKill, listSessionIds, claimPooledSession, attachSink, detachSink, prewarmPool } from "./terminal";
import { snapshot as relaySnapshot, prune as relayPrune, registerSession, endSession, startSubagent, stopSubagent } from "./relay";
import { createChangeTracker, isSettingsPath } from "./changeClassifier";
import { reconcileSettings, setSettingInFile, getVaultSchema, serializeSettingsForFrontend, loadAppConfig, type AppConfig, SETTINGS_FILE, readFolderIcons, setFolderIcon, readDailyNotes } from "./settings";
import { dailyNotePath, dailyNoteContent } from "./dailyNote";
import { DEFAULTS as SETTINGS_DEFAULTS } from "./schema/settingsSchema";
import { searchVault, invalidateSearchIndex } from "./search";
import { listFsPaths } from "./fsPaths";
import { replaceInVault } from "./replace";
import { spawnVaultBackend } from "./openFolder";
import { fileBasename } from "./pathUtils";
import { daemonStatus, listDevices, setOwner, setClaudeBotHomeOverride, setCronEnabled, setProcessEnabled, runCron } from "./daemon";
import { daemonGraph } from "./daemonGraph";
import { installStatus, runSetup, runUpdate } from "./claudebot";
import { getBismuthStatus, ensureBismuthInstalled } from "./bismuthInstall";
import { getUpdateStatus, startUpdate, getUpdateProgress } from "./selfUpdate";

export interface CoreConfig { vault: string; memory?: string; port?: number }

const enc = new TextEncoder();
const dec = new TextDecoder();

// How long a terminal PTY survives an ABNORMAL websocket close (reload, network
// drop) before being killed — the window in which a reconnecting client can
// reattach by termId and keep its running shell. Clean closes (code 1000) kill
// immediately, so this never delays teardown of a deliberately-closed tab.
// Overridable via OA_TERMINAL_GRACE_MS (tests use a short window).
const reattachGraceMs = (): number =>
  Number(process.env.OA_TERMINAL_GRACE_MS) || 30_000;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

/** Cap on a single uploaded attachment (POST /asset). Bounds memory + disk per request. */
const MAX_ASSET_BYTES = 100 * 1024 * 1024; // 100 MB

/** True if `rel` is a safe attachment destination: a vault-relative path of plain
 *  (non-dot) segments with no traversal. Rejecting dot-segments blocks writing into
 *  `.git/` (whose hooks would execute on the next git-backed save), `.obsidian/`, etc. */
function isSafeAssetTarget(rel: string): boolean {
  const segs = rel.split("/");
  return segs.length > 0 && segs.every((s) => s !== "" && s !== "." && s !== ".." && !s.startsWith("."));
}

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
  let appConfig: AppConfig = SETTINGS_DEFAULTS as unknown as AppConfig;
  void loadAppConfig(cfg.vault).then((c) => { appConfig = c; setClaudeBotHomeOverride(c.daemon?.home); }).catch(() => {});

  // /graph and /tree go through a deduped, invalidation-safe cache (see asyncCache.ts):
  // concurrent first requests share one build, and a file change mid-build won't
  // repopulate a stale value. cachedRows stays a plain lazy cache (rebuilt on next read).
  const graphCache = createAsyncCache<GraphData>(async () =>
    attachLayout(await buildGraph(cfg.vault, cfg.memory), cfg.vault),
  );
  const treeCache = createAsyncCache<TreeEntry[]>(() => listTree(cfg.vault));
  let cachedRows: Row[] | null = null;
  let cachedTasks: Row[] | null = null;
  let version = 0;

  // Lazy accessors for the unscoped vault feeds, shared by /vault-data, /rows, and
  // the source resolver. Both rebuild on next read after a file-watch change nulls them.
  async function getCachedRows(): Promise<Row[]> {
    if (cachedRows === null) cachedRows = await buildVaultRows(cfg.vault);
    return cachedRows;
  }
  async function getCachedTasks(): Promise<Row[]> {
    if (cachedTasks === null) cachedTasks = await buildTaskRows(cfg.vault, undefined);
    return cachedTasks;
  }
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
  // The claude-bot daemon rewrites its status file (DAEMON.md) into the vault root every
  // ~2s (daemon-status-updater). It's a status artifact, not knowledge — reacting to its
  // churn (version bump → cache invalidation → every content-dependent base re-resolving
  // over the whole vault) needlessly pegs CPU. Drop its changes in the watcher so they never
  // bump the version. The file still lists + renders; only its 2s heartbeat rewrites are
  // ignored (you don't want live graph/row/editor refreshes for a status heartbeat anyway).
  const DAEMON_STATUS_FILE = "DAEMON.md";
  const isWatchIgnored = (p: string) =>
    isHidden(p) || p === DAEMON_STATUS_FILE || p.endsWith("/" + DAEMON_STATUS_FILE);

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
    // Bases rows + tasks derive from arbitrary frontmatter/body — rebuild lazily on next read.
    cachedRows = null;
    cachedTasks = null;
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
      if (isWatchIgnored(p)) continue;
      if (isSettingsPath(p)) {
        // settings.yaml drives the property registry + appearance — both graph
        // and tree consumers should refetch; /schema reads it fresh on demand.
        // Also refresh the backend runtime config (debounce, heartbeat, …).
        void loadAppConfig(cfg.vault).then((c) => { appConfig = c; setClaudeBotHomeOverride(c.daemon?.home); }).catch(() => {});
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
        if (memory) {
          dirty.graph = true;
          // Autosave the memory repo so it's revertable + gives the dream cron a commit
          // history to diff against (refs/bismuth/dream). Best-effort; never blocks.
          if (cfg.memory) void commitVault(cfg.memory, snapshotMessage(new Date(), "memory")).catch(() => {});
        }
        applyDirty(unknown ? [] : vaultPaths, dirty);
      })();
    }, appConfig.server.fileWatchDebounceMs);
  }

  async function readNoteOrEmpty(vault: string, path: string): Promise<string> {
    const fullPath = join(vault, path);
    const exists = await Bun.file(fullPath).exists();
    return exists ? await readNote(vault, path) : "";
  }

  // Like readNote, but returns null for a missing file instead of throwing.
  // Distinguishes missing (null) from empty-but-present ("") in a single read,
  // avoiding the TOCTOU of a separate existence check.
  async function readNoteOrNull(vault: string, path: string): Promise<string | null> {
    try {
      return await readNote(vault, path);
    } catch {
      return null;
    }
  }

  try {
    watch(cfg.vault, { recursive: true }, (_event, filename) => {
      // Ignore churn in .git (backup commits), .trash, and the daemon's DAEMON.md status
      // heartbeat — none feed the graph or tree. A null filename means "something changed,
      // extent unknown".
      if (filename && isWatchIgnored(filename)) return;
      scheduleVault(filename ?? undefined);
    });
  } catch {
    // vault dir may not exist in test / CI environments
  }
  if (cfg.memory) {
    try {
      watch(cfg.memory, { recursive: true }, (_event, filename) => {
        // Ignore .git churn from our own memory autosave commits (mirrors the vault watch).
        if (filename && isHidden(filename)) return;
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

    // Absolute vault path — the terminal's cwd. The frontend uses it to turn a
    // file dragged from the tree (a vault-relative path) into an absolute path to
    // insert at the shell prompt.
    "GET /terminal/info": async (_, __) => {
      return ok({ vault: cfg.vault });
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
      const views = await computeViewLayouts(graph, cfg.vault);
      // Attach the computed views onto the cached graph object IN PLACE rather than
      // invalidating the cache. `graphCache.get()` returns the live cached reference, so
      // mutating `.views` makes a subsequent /graph include them too — without forcing the
      // next /graph to re-walk + re-read the whole vault. A genuine file change still calls
      // graphCache.invalidate() via applyDirty, rebuilding a fresh graph (whose views are
      // recomputed lazily on the next /graph/views), so this never serves stale layouts.
      graph.views = views;
      return ok(views);
    },

    "GET /templates": async (_, __) => {
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
      return ok(await getCachedRows());
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
      const name = fileBasename(path);
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

    // Serve a vault file as BINARY (image/PDF/audio/video) for `![[...]]` embeds. Resolves
    // FILENAME-FIRST (resolveAsset), streams the bytes with a Content-Type inferred from the
    // extension (Bun.file). Read-only; traversal is guarded inside resolveAsset/resolveInVault.
    "GET /asset": async (_, url) => {
      const path = requireQueryParam(url, "path");
      const abs = await resolveAsset(cfg.vault, path);
      if (!abs) return error("asset not found", 404);
      const file = Bun.file(abs);
      // Short cache so re-opening a note doesn't re-fetch (and re-walk the vault for the
      // filename-first resolution) every time; `private` keeps it out of shared proxies.
      return new Response(file, {
        headers: { "Content-Type": file.type || "application/octet-stream", "Cache-Control": "private, max-age=60" },
      });
    },

    // Save pasted/dropped attachment bytes into the vault. The frontend sends the desired
    // vault-relative path (under the configured attachments folder) as ?path= and the raw
    // bytes as the body; the backend de-collides the name and returns the path actually used
    // so the caller inserts the right `![[basename]]`. NOT a mutation: attachments are invisible
    // to the graph/tree/search caches (listTree excludes them), so nothing needs invalidating —
    // the subsequent note edit that inserts the embed triggers its own normal invalidation.
    "POST /asset": async (req, url) => {
      const target = requireQueryParam(url, "path");
      // Defense in depth: only ever CREATE a plain file under the vault. Reject dotfolder
      // segments (e.g. `.git/hooks/pre-commit`, which the next backupOnSave git commit would
      // execute → RCE) and traversal. resolveInVault (in writeBinary) blocks vault-escape;
      // uniqueAssetPath ensures we never overwrite an existing file.
      if (!isSafeAssetTarget(target)) return error("invalid attachment path", 400);
      const declared = Number(req.headers.get("content-length") ?? 0);
      if (declared > MAX_ASSET_BYTES) return error("attachment too large", 413);
      const bytes = await req.arrayBuffer();
      if (bytes.byteLength > MAX_ASSET_BYTES) return error("attachment too large", 413);
      const finalRel = uniqueAssetPath(cfg.vault, target);
      await writeBinary(cfg.vault, finalRel, bytes);
      return ok({ path: finalRel });
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

    // The "agents" graph: live Claude Code sessions running in THIS app's terminal
    // tabs + their subagents. Reads the in-process relay registry (populated by the
    // relay hooks via POST /relay/*). Prunes the registry against the live pty set
    // first (closed tabs leave no terminal-close hook, so cleanup happens here), then
    // builds the graph. The frontend polls this while agents mode is active.
    "GET /agent-graph": async (_, __) => {
      const live = new Set(listSessionIds());
      relayPrune(live);
      return ok(buildAgentGraph(relaySnapshot(), live));
    },

    // Relay ingest endpoints — posted to by the relay plugin's hooks (loaded
    // per-session via `claude --plugin-dir <relay>` only inside app terminals). They
    // update the in-process agent registry; they are NOT vault mutations, so they
    // live in the read table (no cache invalidation). All are best-effort: the hooks
    // never block the user, so a 400 here is silently swallowed client-side.
    "POST /relay/session": async (req) => {
      const { sessionId, terminalId, cwd } = (await req.json()) as { sessionId?: string; terminalId?: string; cwd?: string };
      if (!sessionId || !terminalId) return error("missing sessionId/terminalId", 400);
      registerSession({ sessionId, terminalId, cwd: cwd ?? "" });
      return ok({ ok: true });
    },

    "POST /relay/session/end": async (req) => {
      const { sessionId } = (await req.json()) as { sessionId?: string };
      if (!sessionId) return error("missing sessionId", 400);
      endSession(sessionId);
      return ok({ ok: true });
    },

    "POST /relay/subagent/start": async (req) => {
      const { parentSessionId, agentId, agentType } = (await req.json()) as { parentSessionId?: string; agentId?: string; agentType?: string };
      if (!parentSessionId || !agentId) return error("missing parentSessionId/agentId", 400);
      startSubagent({ parentSessionId, agentId, agentType: agentType ?? "agent" });
      return ok({ ok: true });
    },

    "POST /relay/subagent/stop": async (req) => {
      const { agentId, lastMessage } = (await req.json()) as { agentId?: string; lastMessage?: string };
      if (!agentId) return error("missing agentId", 400);
      stopSubagent({ agentId, lastMessage });
      return ok({ ok: true });
    },

    "GET /tasks": async (_, __) => {
      return ok(await collectVaultTasks(cfg.vault));
    },

    // Single source-resolution endpoint: resolve a SourceSpec (base | notes | tasks)
    // to Row[], following base composition + scoped tasks. Read-only despite POST
    // (the body carries the spec), so it lives here, not in mutatingRoutes.
    "POST /rows": async (req, __) => {
      const { spec } = (await req.json()) as { spec: SourceSpec };
      // Per-resolution memo: base composition + notes/tasks `from:` chains can hit the
      // unscoped vault feeds many times in one call. Memoize the providers so they build
      // (or fetch from the server cache) at most once per /rows. Unscoped only — scoped
      // task extraction bypasses these providers and always runs fresh.
      let rowsMemo: Promise<Row[]> | null = null;
      let tasksMemo: Promise<Row[]> | null = null;
      const rows = await resolveSource(spec, {
        root: cfg.vault,
        today: todayISO(),
        vaultRows: () => (rowsMemo ??= getCachedRows()),
        vaultTasks: () => (tasksMemo ??= getCachedTasks()),
      });
      return ok(rows);
    },

    "POST /backup": async (_, __) => {
      const committed = await commitVault(cfg.vault, snapshotMessage());
      return ok({ committed });
    },

    // Open (or create) today's daily note. Lives in routes — NOT mutatingRoutes —
    // so the no-op case (note already exists) doesn't bump version / broadcast SSE.
    // When we DO create the note, invalidate ONLY its path (not the whole vault).
    "POST /daily-note": async (req) => {
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
      await invalidate(path);
      return ok({ path, created: true });
    },

    // Open a folder as its own brain in a new window: spawn a sibling core server
    // pointed at `folder` (process-per-vault, like Obsidian) and return its URL. The
    // frontend opens a window with `?api=<url>`. Read-only w.r.t. THIS vault (it only
    // launches a new process), so it lives in routes, not mutatingRoutes. The new
    // backend reuses this server's memory dir unless one is supplied.
    "POST /open-folder": async (req, _url) => {
      const { folder, memory } = (await req.json()) as { folder: string; memory?: string };
      const mem = memory ?? cfg.memory;
      if (!mem) throw new AppError("EINVAL", "no memory dir configured", 400);
      const spawned = await spawnVaultBackend({
        folder,
        memory: mem,
        serverEntry: import.meta.path,
        cwd: import.meta.dir,
      });
      return ok({ url: spawned.url, vault: spawned.vault });
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

    // List filesystem directory entries matching a partial path — backs autocomplete
    // for `scope:"fs"` settings (e.g. daemon.home), which name a path OUTSIDE the vault.
    // Read-only despite POST (the body carries the partial path), so it lives here.
    "POST /list-dir": async (req, __) => {
      const { path, only } = (await req.json()) as { path?: string; only?: "dir" | "file" };
      return ok({ entries: await listFsPaths(path ?? "", only) });
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

    // claude-bot daemon supervision. These read the shared state files under the
    // claude-bot home dir (OA_CLAUDEBOT_HOME, default ~/.claude-bot) that the daemon
    // authors; vault-independent, so they live here regardless of cfg.vault.
    "GET /daemon/status": async (_, __) => {
      return ok(daemonStatus());
    },

    "GET /daemon/devices": async (_, __) => {
      return ok(listDevices());
    },

    // DAEMON graph mode: the claude-bot daemon hub + a node per cron / process, read straight
    // from the shared state files under the claude-bot home (never throws → degrades to empty).
    // Vault-independent, like the other /daemon/* reads. Polled by the frontend while in daemon mode.
    "GET /daemon/graph": async (_, __) => {
      // Position the daemon star the same way the vault graph is laid out: attach
      // backend-computed position2d/position3d so the WebGL renderer can place nodes
      // (unlike agents mode, daemon has no separate SVG layout). Cached by graph sig,
      // so polled state changes (opacity/tint) keep stable positions.
      return ok(await attachLayout(daemonGraph(), "daemon"));
    },

    // claude-bot daemon install/setup, bridged to the claude-bot package's
    // idempotent, ADOPT-ONLY installer entrypoint (core/src/claudebot.ts).
    // Read-only install probe + a one-shot setup action — both system actions,
    // NOT vault mutations, so they live in the READ routes (like POST /open-folder),
    // never through mutatingHandler. installStatus() never throws; runSetup() is
    // adopt-only (it does nothing when the daemon is already installed/running).
    "GET /daemon/install": async (_, __) => {
      return ok(await installStatus());
    },

    "POST /daemon/setup": async (_, __) => {
      return ok(await runSetup());
    },

    // Update the claude-bot daemon: spawns its bin/update.ts (git pull --ff-only + bun
    // install + restart). System action, not a vault mutation → READ routes. Idempotent
    // (no-op when already current). The restart is claude-bot's own (we never launchctl).
    "POST /daemon/update": async (_, __) => {
      return ok(await runUpdate());
    },

    // Machine-wide bismuth CLI + MCP install (core/src/bismuthInstall.ts). Like the daemon
    // routes above: a read-only status probe + an idempotent, version-gated ensure — system
    // actions, NOT vault mutations, so they live in the READ routes. Both never throw.
    "GET /bismuth/install": async (_, __) => {
      return ok(await getBismuthStatus());
    },

    "POST /bismuth/install": async (_, __) => {
      return ok(await ensureBismuthInstalled(process.env.OA_BISMUTH_INSTALL_SRC));
    },

    // Git-based self-update (core/src/selfUpdate.ts). Auto-detects when the source build is
    // behind origin/main; apply pulls + rebuilds + relaunches. System actions (not vault
    // mutations), so READ routes. Apply returns immediately; the build runs in background.
    "GET /update/status": async (_, __) => {
      return ok(await getUpdateStatus());
    },

    "POST /update/apply": async (_, __) => {
      return ok(await startUpdate());
    },

    "GET /update/progress": async (_, __) => {
      return ok(getUpdateProgress());
    },

    // Daemon supervision WRITES: enable/disable a cron or process (edits the `enabled`
    // frontmatter in the shared <home>/{crons,processes}/<name>.md), and run a cron on
    // command (drops a trigger file the daemon polls). These mutate the claude-bot
    // daemon's shared files, NOT the vault — so, like POST /daemon/setup and the /relay/*
    // hooks, they live in the READ routes (no vault-cache invalidation; the frontend
    // re-polls /daemon/graph). Unknown name → setCronEnabled/runCron throw AppError
    // ("ENOENT") → 404 via the dispatch catch.
    "POST /daemon/cron/toggle": async (req) => {
      const { name, enabled } = (await req.json()) as { name?: string; enabled?: boolean };
      if (!name || typeof enabled !== "boolean") return error("missing name/enabled", 400);
      setCronEnabled(name, enabled);
      return ok({ ok: true });
    },

    "POST /daemon/cron/run": async (req) => {
      const { name } = (await req.json()) as { name?: string };
      if (!name) return error("missing name", 400);
      runCron(name);
      return ok({ ok: true });
    },

    "POST /daemon/process/toggle": async (req) => {
      const { name, enabled } = (await req.json()) as { name?: string; enabled?: boolean };
      if (!name || typeof enabled !== "boolean") return error("missing name/enabled", 400);
      setProcessEnabled(name, enabled);
      return ok({ ok: true });
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
        const raw = await readNoteOrNull(cfg.vault, path);
        if (raw === null) {
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
        const raw = await readNoteOrNull(cfg.vault, path);
        if (raw === null) {
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
        const name = fileBasename(file);
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
        const name = fileBasename(file);
        const next = deleteRow(text, { name, path: file }, index);
        await writeNote(cfg.vault, file, next);
        return ok();
      },
      (b) => b.file,
    ),

    "POST /row/reorder": mutatingHandler(
      async (req) => {
        const { file, from, to } = (await req.json()) as { file: string; from: number; to: number };
        const text = await readNote(cfg.vault, file);
        const name = fileBasename(file);
        const next = reorderRow(text, { name, path: file }, from, to);
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
      () => SETTINGS_FILE,
    ),

    "POST /tasks/toggle": mutatingHandler(
      async (req) => {
        const { path, line, status } = (await req.json()) as { path: string; line: number; status?: string };
        const content = await readNote(cfg.vault, path);
        const lines = content.split("\n");
        if (line < 0 || line >= lines.length) {
          throw new AppError("EINVAL", "line out of range", 400);
        }
        // toggleTaskLine / setTaskLineStatus may return TWO lines (recurrence: the next
        // occurrence is inserted above the completed one, separated by "\n"). Splicing the
        // result back as a single array slot keeps that ordering after join("\n").
        // An explicit `status` (the right-click status menu) sets that exact box char;
        // otherwise it's the plain binary toggle (checkbox click).
        lines[line] =
          status != null
            ? setTaskLineStatus(lines[line], status, todayISO())
            : toggleTaskLine(lines[line], todayISO());
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
          // Which scheduling columns to advance — a bidirectional reverse review passes
          // the `*Back` triple so each direction schedules independently. Default: forward.
          dueField?: string;
          easeField?: string;
          intervalField?: string;
        };
        // Row-based review (flashcard base): advance scheduling columns on the row.
        if (body.file != null && body.index != null) {
          const text = await readNote(cfg.vault, body.file);
          const name = fileBasename(body.file);
          const { rows } = parseBaseFile(text, { name, path: body.file });
          const row = rows[body.index];
          if (!row) throw new AppError("EINVAL", `row not found: ${body.file}#${body.index}`, 400);
          const fields =
            body.dueField && body.easeField && body.intervalField
              ? { due: body.dueField, ease: body.easeField, interval: body.intervalField }
              : undefined;
          const note = applyReviewToRow(row.note, body.response, todayISO(), appConfig.srs, fields);
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

    // Claim a device as the claude-bot daemon owner: write owner.json (byte-compatible
    // with what the daemon reads). owner.json lives outside the vault, so there's
    // nothing in the graph/tree caches to invalidate — pass a stable constant scope
    // (no vault path) so the mutating handler's path-derived invalidation is a no-op.
    "POST /daemon/owner": mutatingHandler(
      async (req) => {
        const { deviceId } = (await req.json()) as { deviceId?: unknown };
        if (typeof deviceId !== "string" || deviceId.length === 0) {
          return error("missing deviceId", 400);
        }
        try {
          return ok(setOwner(deviceId));
        } catch (e) {
          // setOwner throws when deviceId isn't a known, heartbeating device.
          return error((e as Error).message, 400);
        }
      },
      () => "::daemon-owner",
    ),
  };

  // Warm the graph + tree caches off the critical path so the first webview request
  // finds them ready (or already building, and deduped) instead of paying the build
  // serially after launch. Errors are swallowed (e.g. vault dir absent in tests).
  graphCache.warm();
  treeCache.warm();

  type TermWsData = { sessionId: string; dataSub?: { dispose(): void }; exitSub?: { dispose(): void } };
  const server = Bun.serve<TermWsData>({
    port: cfg.port ?? 4321,
    // Bun's default idleTimeout is 10s, which would drop a connection mid-request for the
    // few slow handlers we have (notably POST /daemon/setup, which git-clones + bun-installs
    // claude-bot on first run — see core/src/claudebot.ts provisionClaudeBot). 255s is Bun's
    // max; long enough for those, harmless for everything else.
    idleTimeout: 255,
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
          /^tauri:\/\//.test(origin) ||
          /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin);
        if (!allowed) {
          return withCors(error("forbidden origin", 403));
        }
        // Reattach: a reconnecting/reloading client passes its stable term id. If
        // its PTY is still alive (within the post-disconnect grace window), pipe to
        // the SAME shell — preserving the running process, cwd, and env — instead of
        // silently spawning a fresh one. Otherwise create a new session keyed by it.
        const termId = url.searchParams.get("termId") ?? undefined;
        const existing = termId ? getSessionByTermId(termId) : undefined;
        let createdNew = false;
        let session;
        if (existing) {
          cancelSessionKill(existing.id); // we're reattaching — don't kill it
          resizeSession(existing.id, cols, rows);
          session = existing;
        } else {
          // Prefer a pre-warmed shell from the pool: its prompt is already rendered, so
          // the tab paints instantly instead of waiting on a cold login-shell rc load.
          // Falls back to a fresh spawn when the pool is empty. Tabs report to THIS
          // server's port so the in-tab Claude sessions' relay hooks reach the right
          // core (multiple windows = multiple backends).
          session =
            claimPooledSession({ termId, cols, rows }) ??
            createTerminalSession({ cwd: cfg.vault, cols, rows, relayPort: server.port, termId });
          createdNew = true;
        }
        const upgraded = server.upgrade(req, { data: { sessionId: session.id } as TermWsData });
        if (!upgraded) {
          // Never hard-kill a reattached live shell on a failed upgrade; just let its
          // grace timer reclaim it if no socket reconnects.
          if (createdNew) killSession(session.id);
          else scheduleSessionKill(session.id, reattachGraceMs());
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
        // Pipe PTY -> ws via the session's switchable sink. attachSink first flushes any
        // buffered output (a pre-warmed pool prompt, or output produced during a brief
        // disconnect) so the prompt shows immediately, then streams live bytes.
        attachSink(s.id, (d: string) => { ws.send(enc.encode(d)); });
        // Shell exited: close with code 1000 so the client treats it as a real exit
        // (close the tab) rather than a dropped connection to reconnect/reattach.
        data.exitSub = s.pty.onExit(() => { try { ws.close(1000, "exited"); } catch { /* */ } });
      },
      message(ws, msg) {
        const { sessionId } = ws.data as { sessionId: string };
        const s = getSession(sessionId);
        if (!s) return;
        const bytes = msg instanceof ArrayBuffer
          ? new Uint8Array(msg)
          : msg instanceof Uint8Array
            ? msg
            : enc.encode(msg as string);
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
      close(ws, code) {
        const data = ws.data as { sessionId: string; dataSub?: { dispose(): void }; exitSub?: { dispose(): void } };
        // Detach the live sink (no ws.send on a closed socket) — output resumes buffering
        // for a possible reattach — and drop the exit listener.
        detachSink(data.sessionId);
        data.exitSub?.dispose();
        // A CLEAN close (code 1000) means either the shell process exited (server-side
        // ws.close after pty.onExit) or the client intentionally disposed the tab
        // (ws.close(1000)). Kill the PTY now. An ABNORMAL close (reload → 1001, network
        // drop → 1006, etc.) keeps the PTY alive for a grace window so the reconnecting
        // client can reattach by termId and keep its running process.
        if (code === 1000) killSession(data.sessionId);
        else scheduleSessionKill(data.sessionId, reattachGraceMs());
      },
    },
  });

  // Pre-warm one login shell so the first terminal tab paints its prompt instantly
  // (cwd = vault, reporting to this server's port). Guarded so a spawn failure here can
  // never take the server down — terminals still cold-spawn on demand.
  try {
    prewarmPool(cfg.vault, server.port);
  } catch {
    /* pre-warm is best-effort */
  }

  return server;
}

if (import.meta.main) {
  const vault = cliArg("vault") ?? process.env.OA_VAULT;
  const memory = cliArg("memory") ?? process.env.OA_MEMORY;
  if (!vault || !memory) {
    console.error("usage: server --vault <2nd-brain dir> --memory <3rd-brain dir> [--port n]");
    process.exit(1);
  }
  const portArg = cliArg("port");
  const s = createServer({ vault, memory, port: portArg ? Number(portArg) : 4321 });
  console.log(`core listening on http://localhost:${s.port}`);

  // Self-terminate when the owning desktop app process is gone, so we never leave an
  // orphaned core behind a crashed / force-quit app (Tauri's RunEvent::Exit doesn't fire
  // then) or after the window owning an open-folder sibling backend closes. The Tauri shell
  // passes OA_APP_PID; open-folder siblings inherit it via Bun.spawn's env. Absent in dev
  // (`bun run dev`) → no-op. signal 0 only probes liveness; the timer is unref'd so it never
  // keeps the process alive on its own.
  const ownerPid = Number(process.env.OA_APP_PID);
  if (Number.isInteger(ownerPid) && ownerPid > 0) {
    setInterval(() => {
      try {
        process.kill(ownerPid, 0);
      } catch {
        console.log(`core exiting: owner app pid ${ownerPid} is gone`);
        process.exit(0);
      }
    }, 5000).unref();
  }

  // Bundled app: ensure the machine-wide bismuth CLI + MCP are installed/current from the
  // staged tools resource (OA_BISMUTH_INSTALL_SRC). Version-gated → no-op when unchanged.
  // Best-effort + non-blocking; never crashes the server.
  if (process.env.OA_BISMUTH_INSTALL_SRC) {
    ensureBismuthInstalled(process.env.OA_BISMUTH_INSTALL_SRC)
      .then((r) => {
        console.log(`bismuth tools: ${r.action}`);
        for (const w of r.warnings) console.warn(`bismuth tools: ${w}`);
      })
      .catch((e) => console.warn(`bismuth tools install failed: ${e?.message ?? e}`));
  }

  // Bundled app launch (OA_APP_PATH is set only by the Tauri shell): if the claude-bot
  // daemon is installed and daemon.autoUpdate is on, update it in the background. Gated to
  // the bundled app so dev/standalone/tests never touch a live daemon. claude-bot's
  // runUpdate is idempotent + fetch-gated — it only pulls/restarts when actually behind, so
  // an up-to-date daemon is a no-op. Best-effort; never crashes the server.
  if (process.env.OA_APP_PATH) {
    void (async () => {
      try {
        const cfg = await loadAppConfig(vault);
        if (cfg.daemon?.autoUpdate === false) return;
        const status = await installStatus();
        if (!status.installed) return;
        const r = await runUpdate();
        if (r.action === "updated") {
          console.log(`claude-bot: auto-updated ${r.from?.slice(0, 7)} → ${r.to?.slice(0, 7)}${r.restarted ? " (restarted)" : ""}`);
        }
      } catch (e) {
        console.warn(`claude-bot auto-update skipped: ${(e as Error)?.message ?? e}`);
      }
    })();
  }
}
