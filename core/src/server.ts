import { join } from "node:path";
import { watch } from "node:fs";
import { createSseRegistry, formatEvent } from "./sse";
import { createAsyncCache } from "./asyncCache";
import { buildGraph } from "./engine";
import { attachLayout, computeViewLayouts } from "./layout-cache";
import { listTree, listTemplates, listMarkdown, readNote, writeNote, moveEntry, deleteEntry, createEntry, resolveAsset, writeBinary, uniqueAssetPath } from "./files";
import { commitVault, scheduleBackup, snapshotMessage } from "./backup";
import { parseFrontmatter, setFrontmatterKey, deleteFrontmatterKey } from "./frontmatter";
import { AppError } from "./error";
import { buildAgentGraph } from "./agents";
import { buildVaultRows } from "./basesData";
import { buildTaskRows } from "./bases/tasksData";
import { parseBaseFile } from "./bases/parse";
import { resolveSource } from "./bases/source";
import { upsertRow, deleteRow, reorderRow } from "./bases/rowOps";
import type { GraphData, TreeEntry } from "./graph";
import {
  collectVaultTasks,
  toggleTaskLine,
  setTaskLineStatus,
  reorderTaskBlocks,
  archiveResolvedTasks,
} from "./tasks";
import { todayISO } from "./dates";
import { collectDecks, dueCards, collectCards, noteCards, applyReview } from "./srs/cards";
import { applyReviewToRow } from "./srs/reviewRow";
import type { ReviewResponse } from "./srs/types";
import type { Row, SourceSpec } from "./bases/types";
import { createTerminalSession, killSession, resizeSession, getSession, getSessionByTermId, scheduleSessionKill, cancelSessionKill, listSessionIds, claimPooledSession, attachSink, detachSink, prewarmPool, setPoolMemoryDir } from "./terminal";
import {
  sendMessage as chatSend,
  abortTurn as chatAbort,
  closeChat,
  scheduleClose as scheduleChatClose,
  rebindSink as chatRebindSink,
  detachSink as chatDetachSink,
  newChatId,
  respondPermission as chatRespondPermission,
  setPermissionMode as chatSetPermissionMode,
  setModel as chatSetModel,
  resumeSession as chatResume,
  openSession as chatOpen,
  listChatSessions,
  sessionHistoryFrames,
  searchChatSessions,
  invalidateChatVisibility,
} from "./chat";
import { snapshot as relaySnapshot, prune as relayPrune, registerSession, endSession, startSubagent, stopSubagent } from "./relay";
import { registerWindow, unregisterWindow, updateTabs, listWindows, resolveTarget, sendCommand, resolveReply, type UiTabsSnapshot } from "./uiControl";
import { UI_CONTROL_BLOCKLIST } from "./commands";
import { writeRunRecord } from "./runRegistry";
import { createChangeTracker, isSettingsPath } from "./changeClassifier";
import { reconcileSettings, setSettingInFile, getVaultSchema, serializeSettingsForFrontend, loadAppConfig, readDaemonEnabledSync, type AppConfig, SETTINGS_FILE, setFolderIcon, setFolderVisibility, readDailyNotes } from "./settings";
import { resolveVisibility, resolveFolderVisibility, type Visibility } from "./visibility";
import { dailyNotePath, dailyNoteContent } from "./dailyNote";
import { DEFAULTS as SETTINGS_DEFAULTS } from "./schema/settingsSchema";
import { searchVault, invalidateSearchIndex, updateSearchIndex } from "./search";
import { promptSearch } from "./searchPrompt";
import { listFsPaths } from "./fsPaths";
import { replaceInVault } from "./replace";
import { spawnVaultBackend } from "./openFolder";
import { fileBasename } from "./pathUtils";
import { isInkSidecarPath } from "./drawing/ink";
import { daemonStatus, listDevices, setOwner, setCronEnabled, setProcessEnabled, runCron, migrateDaemonState, vaultDaemonDir, daemonIdentityName, registerVaultRoot } from "./daemon";
import { daemonGraph } from "./daemonGraph";
import { listDaemonPages, resolvePage, markPageFailed, createDaemonPage, DAEMON_PAGE_RE, type CreatePageInput } from "./daemonPages";
import { installStatus, runSetup, installDaemonFromBundle } from "./daemonInstall";
import { getBismuthStatus, ensureBismuthInstalled } from "./bismuthInstall";
import { getUpdateStatus, startUpdate, getUpdateProgress } from "./selfUpdate";
import {
  status as gcalStatus,
  setCredentials as gcalSetCredentials,
  startAuth as gcalStartAuth,
  completeAuth as gcalCompleteAuth,
  disconnect as gcalDisconnect,
  sync as gcalSync,
} from "./gcal";
import type { ConflictPolicy } from "./gcal/sync";

export interface CoreConfig { vault: string; memory?: string; port?: number }

const enc = new TextEncoder();
const dec = new TextDecoder();

// How long a terminal PTY survives an ABNORMAL websocket close (reload, network
// drop) before being killed — the window in which a reconnecting client can
// reattach by termId and keep its running shell. Clean closes (code 1000) kill
// immediately, so this never delays teardown of a deliberately-closed tab.
// Overridable via BISMUTH_TERMINAL_GRACE_MS (tests use a short window).
const reattachGraceMs = (): number =>
  Number(process.env.BISMUTH_TERMINAL_GRACE_MS) || 30_000;

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

/** Standardized error response: message + HTTP status code. `headers` lets a call site opt
 *  into e.g. `Cache-Control: no-store` (see GET /asset's 404 below) without every other
 *  error() caller having to think about caching. */
function error(message: string, statusCode: number = 400, headers?: HeadersInit): Response {
  return new Response(message, { status: statusCode, ...(headers && { headers }) });
}

/** A small self-contained HTML page shown in the user's browser after the Google
 *  OAuth loopback redirect (success or failure). `message` is escaped — it can carry
 *  the account email or an error string from Google. */
function gcalCallbackHtml(message: string, success: boolean): Response {
  const esc = message.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
  const tint = success ? "#3fb950" : "#f85149";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bismuth · Google Calendar</title>
<style>html,body{height:100%;margin:0}body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;align-items:center;justify-content:center}
.card{max-width:440px;padding:40px;text-align:center;line-height:1.55}.glyph{font-size:44px;color:${tint};margin-bottom:8px}.msg{font-size:15px;color:#c9d1d9}</style></head>
<body><div class="card"><div class="glyph">${success ? "✓" : "✕"}</div><div class="msg">${esc}</div></div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** The arguments for a gcal sync, derived from settings (one place for the manual route + the
 *  auto-sync ticker). `basePathOverride` lets a manual "Sync now" target a specific calendar
 *  without waiting for the debounced settings write to land in appConfig. */
function gcalSyncArgs(appConfig: AppConfig, basePathOverride?: string) {
  const gc = appConfig.googleCalendar;
  return {
    basePath: (basePathOverride && basePathOverride.trim()) || gc?.basePath || "",
    calendarId: gc?.calendarId || "primary",
    policy: (gc?.conflictPolicy ?? "lastWriteWins") as ConflictPolicy,
    timeZone: gc?.timeZone ?? "",
    theme: (appConfig.appearance as { theme?: string } | undefined)?.theme,
  };
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

/** Matches a daemon cron/process DEFINITION file (.daemon/{crons,processes}/<name>.md) —
 *  hoisted out of isDaemonRuntimeNoise (called per file-watch event) since it's stateless. */
const DAEMON_DEF_RE = /^\.daemon\/(crons|processes)\/[^/.][^/]*\.md$/;

export function createServer(cfg: CoreConfig) {
  // On boot: reconcile settings.yaml against SETTINGS_SCHEMA — write a fresh
  // defaults file if absent, or fill in any keys added since the file was written
  // (preserving the user's values, comments, and unknown keys). Fire-and-forget so
  // server start stays synchronous; the write lands within ms. Swallow failures
  // (e.g. a non-existent/read-only vault dir in tests) so it can never take the
  // whole server down on boot.
  void reconcileSettings(cfg.vault).catch(() => {});

  // Boot-time: install/refresh the bundled daemon as a launchd/systemd service so it keeps
  // running while the app is closed. No-op in dev (no BISMUTH_DAEMON_BUNDLE); best-effort.
  void installDaemonFromBundle();

  // Boot-time: make this vault DISCOVERABLE to the daemon by registering its root in the
  // machine-level vaults.json registry (daemon/src/lib/registry.ts's loadEnabledVaults()
  // iterates this every cron tick — a vault absent from it never fires a single cron, no
  // matter how its own daemon.enabled is set). Unconditional (not gated on daemon.enabled):
  // the daemon re-checks each vault's own .settings itself. Idempotent; best-effort.
  registerVaultRoot(cfg.vault);

  // Backend runtime config (settings.yaml merged over defaults). Seeded synchronously
  // from DEFAULTS so timings are sane before the async load lands, then refreshed on
  // boot and whenever settings.yaml changes (see classifyVault).
  let appConfig: AppConfig = SETTINGS_DEFAULTS as unknown as AppConfig;
  // Reflect the on-disk daemon.enabled SYNCHRONOUSLY before the first cache warm (below).
  // The tree gates the `.daemon` folder and the graph gates the 3rd brain on this flag, so
  // the FIRST cached /tree + /graph build (treeCache/graphCache.warm()) must already see the
  // real value — otherwise the DEFAULTS-seeded `false` makes that first build omit `.daemon`
  // (and the 3rd brain), and they only pop in a beat later once the async loadAppConfig below
  // resolves and re-invalidates (worse on a cold-boot SSE miss → up to the 5s /version poll).
  // Mirrors daemonIdentityName's sync identity.md read. A fresh object so the shared
  // SETTINGS_DEFAULTS is never mutated; the async load still reassigns appConfig wholesale.
  const daemonEnabledAtBoot = readDaemonEnabledSync(cfg.vault);
  if (daemonEnabledAtBoot !== (appConfig.daemon?.enabled ?? false)) {
    appConfig = {
      ...SETTINGS_DEFAULTS,
      daemon: { ...(SETTINGS_DEFAULTS as { daemon: Record<string, unknown> }).daemon, enabled: daemonEnabledAtBoot },
    } as unknown as AppConfig;
  }

  // /graph, /tree, and the unscoped vault feeds (rows + tasks) all go through a deduped,
  // invalidation-safe cache (see asyncCache.ts): concurrent first requests share ONE build,
  // and a file change mid-build won't repopulate a stale value. This matters most for rows:
  // one SSE event can fan out to N independent /rows resolves (one per open base/calendar pane),
  // and a bare lazy cache would let each kick off its own full-vault walk concurrently.
  // The 3rd brain (memory) is gated on the daemon: when enabled, memory lives at
  // <vault>/.daemon/memory; when disabled there is no 3rd brain at all (undefined →
  // engine skips buildMemoryGraph + the about-edges, emitting no mem: nodes). Resolved
  // live from appConfig so a daemon.enabled toggle adds/removes the 3rd brain.
  const effectiveMemoryDir = (): string | undefined =>
    appConfig.daemon?.enabled ? join(cfg.vault, ".daemon", "memory") : undefined;
  const graphCache = createAsyncCache<GraphData>(async () =>
    attachLayout(await buildGraph(cfg.vault, effectiveMemoryDir()), cfg.vault),
  );
  const treeCache = createAsyncCache<TreeEntry[]>(() =>
    listTree(cfg.vault, { daemonEnabled: appConfig.daemon?.enabled, daemonName: daemonIdentityName(cfg.vault) }),
  );
  // The unscoped vault feeds, shared by /vault-data, /rows, and the source resolver.
  const rowsCache = createAsyncCache<Row[]>(() => buildVaultRows(cfg.vault));
  const tasksCache = createAsyncCache<Row[]>(() => buildTaskRows(cfg.vault, undefined));
  let version = 0;
  const sse = createSseRegistry();

  // Load the real settings.yaml over DEFAULTS, then invalidate the caches that depend
  // on it — the tree shows .daemon only when daemon.enabled, and the graph gates the
  // 3rd brain on it — so a cache built during the brief boot window before this resolves
  // can't go stale. (Defined after the caches so we can reference them here.)
  void loadAppConfig(cfg.vault).then((c) => {
    appConfig = c;
    // First boot after upgrade: if this vault's daemon is enabled, copy any legacy
    // ~/.claude-bot brain into <vault>/.daemon (copy-only — never deletes the source).
    // Machine-marker-gated, so it lands in exactly one vault. Runs before the cache
    // rebuilds below so the migrated memory shows up immediately.
    if (c.daemon?.enabled) migrateDaemonState(cfg.vault);
    treeCache.invalidate();
    graphCache.invalidate();
    // Re-bake the warm pool with the now-known memory dir so the first terminal tab
    // injects (or doesn't) per the loaded daemon.enabled, not the DEFAULTS-seeded state.
    setPoolMemoryDir(effectiveMemoryDir());
    // Notify any already-connected client to refetch — daemon.enabled in the loaded
    // config may add the 3rd brain (graph) and the .daemon folder (tree) that the
    // DEFAULTS-seeded boot state did not have.
    version++;
    sse.publish({ version, paths: [], dirty: { graph: true, tree: true } });
  }).catch(() => {});

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingVault = new Set<string>();
  let pendingVaultUnknown = false;
  let pendingMemory = false;

  // Tracks each note's graph/tree-relevant fingerprint (wikilinks + tags + icon),
  // so we can stay silent toward graph/tree consumers when a file is rewritten
  // without changing its connections — e.g. a bot status file restamped every
  // couple of seconds.
  const tracker = createChangeTracker();
  const isHidden = (p: string) => p.startsWith(".") || p.includes("/.");
  // The daemon rewrites its status file (DAEMON.md) into the vault root every
  // ~2s (daemon-status-updater). It's a status artifact, not knowledge — reacting to its
  // churn (version bump → cache invalidation → every content-dependent base re-resolving
  // over the whole vault) needlessly pegs CPU. Drop its changes in the watcher so they never
  // bump the version. The file still lists + renders; only its 2s heartbeat rewrites are
  // ignored (you don't want live graph/row/editor refreshes for a status heartbeat anyway).
  const DAEMON_STATUS_FILE = "DAEMON.md";
  const DAEMON_STATUS_PATH = "/" + DAEMON_STATUS_FILE;
  const isWatchIgnored = (p: string) =>
    isHidden(p) || p === DAEMON_STATUS_FILE || p.endsWith(DAEMON_STATUS_PATH);
  // The .daemon folder is dot-prefixed (so isHidden treats it as hidden) but its contents ARE
  // meaningful: .daemon shows in the sidebar, and .daemon/memory is the 3rd brain. Route its
  // changes through instead of dropping them as hidden. (The `.settings` FILE is matched earlier
  // by isSettingsPath, before the hidden-drop.)
  const isSystemFolderPath = (p: string) => p.startsWith(".daemon/");
  const isDaemonMemoryPath = (p: string) => p === ".daemon/memory" || p.startsWith(".daemon/memory/");
  // The daemon writes high-frequency runtime state under .daemon while it runs — process logs,
  // pid/session files, cron .running.json/.last-fired.json/.triggers. None of it changes the
  // sidebar or the graph, so reacting to it (cache invalidate → version bump → SSE → full
  // /tree or /graph rebuild) is pure churn — the same reason DAEMON_STATUS_FILE is dropped
  // above. A .daemon path is "noise" UNLESS it's the 3rd brain (.daemon/memory/**), a cron/
  // process DEFINITION file (.daemon/{crons,processes}/<name>.md), or a daemon INBOX page
  // (.daemon/pages/<slug>.md) — all three the sidebar/graph show. A page's dynamic sidecar
  // (.daemon/pages/.state/**) and trigger dir (.daemon/pages/.triggers/**) stay dot-prefixed,
  // so they're still noise (correct — their churn shouldn't bump the tree).
  const isDaemonRuntimeNoise = (p: string) =>
    p.startsWith(".daemon/") &&
    !isDaemonMemoryPath(p) &&
    p !== ".daemon/identity.md" && // the user-editable personality file — show it in the sidebar
    p !== ".daemon/PAGES.md" && // the seeded page-format guide — show it in the sidebar (explicit allowlist, not "any root .md", so future runtime files stay noise)
    !DAEMON_DEF_RE.test(p) &&
    !DAEMON_PAGE_RE.test(p);

  // Clear only the caches a change touched, bump version, and tell subscribers
  // exactly what's dirty. We always bump version (so the editor can reconcile an
  // externally-edited open file), but graph/tree consumers skip refetching when
  // their `dirty` flag is false.
  function applyDirty(paths: string[], dirty: { graph: boolean; tree: boolean }, vaultTouched = true) {
    if (dirty.graph) graphCache.invalidate();
    if (dirty.tree) treeCache.invalidate();
    // Search index, rows, and tasks are all built purely from vault notes, so a batch that
    // touched only the memory dir (3rd brain, no vault paths) has nothing for them to react
    // to — skip the drop/rebuild entirely so a daemon memory write doesn't force the next
    // /search, /rows, or /tasks request to pay a full vault re-walk for no content change.
    if (vaultTouched) {
      // The search index covers note bodies (and basenames/headings/tags), so even a content-only edit
      // that's dirty to neither graph nor tree changes search results. When we know exactly which paths
      // changed, patch just those docs in place (re-read one file, not the whole vault); otherwise (an
      // unknown-extent change) drop the index so the next /search rebuilds from current files. The patch
      // is fire-and-forget: a search landing in the brief window before it resolves can return results one
      // edit stale, which self-heals on the next search; on patch failure we fall back to a full drop.
      if (paths.length > 0) void updateSearchIndex(cfg.vault, paths).catch(() => invalidateSearchIndex(cfg.vault));
      else invalidateSearchIndex(cfg.vault);
      // Bases rows + tasks derive from arbitrary frontmatter/body — rebuild lazily on next read.
      rowsCache.invalidate();
      tasksCache.invalidate();
    }
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
      // settings.yaml (now under .settings/) is dot-hidden, so it must be matched
      // BEFORE the isWatchIgnored drop below.
      if (isSettingsPath(p)) {
        // settings.yaml drives the property registry + appearance — both graph
        // and tree consumers should refetch; /schema reads it fresh on demand.
        // Also refresh the backend runtime config (debounce, heartbeat, …).
        void loadAppConfig(cfg.vault).then((c) => {
          appConfig = c;
          // Enabling the daemon for this vault triggers the one-time copy-only migration of
          // any legacy ~/.claude-bot brain into <vault>/.daemon (machine-marker-gated).
          if (c.daemon?.enabled) migrateDaemonState(cfg.vault);
          // The graph/tree dirty flags below invalidate synchronously, but appConfig
          // reloads async — so re-invalidate the daemon-gated caches AFTER it lands and
          // nudge clients to refetch, so toggling daemon.enabled/name updates the sidebar
          // (.daemon visibility + label) and graph (3rd brain) live, without a stale frame.
          treeCache.invalidate();
          graphCache.invalidate();
          // Toggling daemon.enabled flips memory injection for newly-claimed tabs.
          setPoolMemoryDir(effectiveMemoryDir());
          version++;
          sse.publish({ version, paths: [], dirty: { graph: true, tree: true } });
        }).catch(() => {});
        graph = true;
        tree = true;
        continue;
      }
      // .daemon/memory is the 3rd brain → graph only; other .settings/.daemon
      // content (cron/process defs, etc.) → sidebar (tree) only.
      if (isDaemonRuntimeNoise(p)) continue; // daemon logs/pids/cron-state → never refetch
      if (isDaemonMemoryPath(p)) { graph = true; continue; }
      if (isSystemFolderPath(p)) { tree = true; continue; }
      // Note-ink sidecars (.ink/**) are dirty to NOTHING — they feed no graph, tree, search,
      // rows, or tasks. They still ride the SSE publish (paths + version bump) so a split-pane
      // sibling showing the same note can refetch its ink. Matched before the hidden-drop.
      if (isInkSidecarPath(p)) continue;
      if (isWatchIgnored(p)) continue;
      if (!p.endsWith(".md")) { graph = true; tree = true; continue; }
      notePaths.push(p);
    }
    const d = await tracker.classify(notePaths, (p) => readNoteOrNull(cfg.vault, p));
    return { graph: graph || d.graph, tree: tree || d.tree };
  }

  // Single entry point for vault content/structure changes (API mutations +
  // file-watch). With no paths the change extent is unknown, so refresh both.
  async function invalidate(...paths: string[]) {
    const dirty = paths.length === 0
      ? { graph: true, tree: true }
      : await classifyVault(paths);
    // Pure ink-sidecar writes touch no vault content — skip the search/rows/tasks drops,
    // matching arm()'s gate. This is the path a PUT /file ink autosave actually takes, so
    // without it every stroke would force a full rows/tasks rebuild despite classifyVault
    // marking the batch dirty-to-nothing. No paths = unknown extent → treat as touched.
    const vaultTouched = paths.length === 0 || paths.some((p) => !isInkSidecarPath(p));
    applyDirty(paths, dirty, vaultTouched);
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
          // history to diff against (refs/bismuth/dream). Coalesced so a burst of memory writes
          // doesn't spam commits; best-effort, never blocks.
          if (cfg.memory) scheduleBackup(cfg.memory, () => snapshotMessage(new Date(), "memory"));
        }
        // A pure memory-dir batch (no vault paths, extent known) never touched the vault, and
        // ink sidecars (.ink/**) are content-neutral to search/rows/tasks — so a batch of only
        // those skips the cache drops entirely (a stroke autosave must cost nothing).
        const vaultTouched = unknown || vaultPaths.some((p) => !isInkSidecarPath(p));
        applyDirty(unknown ? [] : vaultPaths, dirty, vaultTouched);
      })();
    }, appConfig.server.fileWatchDebounceMs);
  }

  async function readNoteOrEmpty(vault: string, path: string): Promise<string> {
    // Single fs op on the hot open path: read directly and treat a missing file
    // as empty. The old exists()+readNote pair did two round-trips (stat then
    // open+read) per GET /file, doubling syscall latency for no benefit — and it
    // had a TOCTOU window between the two. readNoteOrNull catches ENOENT for us.
    return (await readNoteOrNull(vault, path)) ?? "";
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
      // extent unknown". System folders (.settings/.daemon) are dot-hidden but meaningful,
      // so they bypass the hidden-drop (classifyVault routes them to tree/graph).
      if (filename && isDaemonRuntimeNoise(filename)) return; // drop daemon runtime churn early
      // .ink/** is dot-hidden but must pass: classifyVault marks it dirty-to-nothing while the
      // SSE publish keeps split panes' ink in sync (see the isInkSidecarPath branch there).
      if (filename && !isSystemFolderPath(filename) && !isSettingsPath(filename) && !isInkSidecarPath(filename) && isWatchIgnored(filename)) return;
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

    // The chat history picker. Both reads operate against the vault (cfg.vault) — the SDK's session
    // store unifies the user's terminal Claude Code sessions AND in-app chat sessions for that cwd.
    "GET /chat/sessions": async (_, __) => {
      return ok({ sessions: await listChatSessions(cfg.vault) });
    },

    // Replay one past session as ChatFrames (in order) so the client can rehydrate the transcript
    // before binding/resuming it. Empty `id` → empty replay.
    "GET /chat/session-messages": async (_, url) => {
      const id = url.searchParams.get("id");
      return ok({ frames: id ? await sessionHistoryFrames(id, cfg.vault) : [] });
    },

    // Search past sessions (terminal + in-app) by CONTENT — filters the SDK's own session data
    // (title + message text) and returns matches with a snippet (the SDK has no native session
    // search). Read-only despite POST (the body carries the query), so it lives in routes, not
    // mutatingRoutes — no cache-invalidate / SSE. Empty query → no hits.
    "POST /chat/search": async (req, __) => {
      const { query } = (await req.json()) as { query?: string };
      return ok({ hits: await searchChatSessions(cfg.vault, query ?? "") });
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
      // Overlay per-folder icons + resolved AI visibility (both stored in settings.yaml)
      // onto tree entries. Done per-request on a shallow copy so a folder-icon/visibility
      // change is reflected even when the underlying file tree (cachedTree) hasn't
      // structurally changed and so we never mutate the cache with a value tied to a
      // specific request. Visibility is RESOLVED here (core/src/visibility.ts) from each
      // entry's own raw frontmatter value (files) or path (dirs) + folderVisibility, so
      // the badge the tree shows can never disagree with what buildDenyPaths enforces —
      // both call the same resolver.
      const folderIcons = (appConfig.folderIcons as Record<string, string> | undefined) ?? {};
      const folderVisibility = (appConfig.folderVisibility as Record<string, Visibility> | undefined) ?? {};
      const entries = cachedTree.map((e) => {
        const next: TreeEntry = { ...e };
        if (e.kind === "dir" && folderIcons[e.path]) next.icon = folderIcons[e.path];
        // Stash the node's OWN explicit setting before `visibility` gets overwritten below —
        // a file's raw frontmatter value (dropping a rare explicit "all", which the context
        // menu doesn't need to distinguish from absent) or a dir's own folderVisibility entry.
        const own = e.kind === "dir" ? folderVisibility[e.path] : e.visibility;
        if (own === "chat-only" || own === "hidden") next.ownVisibility = own;
        else delete next.ownVisibility;
        const resolved = e.kind === "dir"
          ? resolveFolderVisibility(e.path, folderVisibility)
          : resolveVisibility(e.path, e.visibility, folderVisibility);
        if (resolved === "all") delete next.visibility;
        else next.visibility = resolved;
        return next;
      });
      return ok(entries);
    },

    "GET /vault-data": async (_, __) => {
      return ok(await rowsCache.get());
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
    "PUT /file": async (req, __) => {
      const { path, contents, baseText } = (await req.json()) as { path: string; contents: string; baseText?: string };
      if (baseText !== undefined) {
        const onDisk = await readNoteOrEmpty(cfg.vault, path);
        if (onDisk !== baseText) {
          return new Response(JSON.stringify({ current: onDisk }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
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
      // `no-store` on the miss (#38): a "not found" is only ever a TRANSIENT fact about a
      // mutable vault — the file can be created/renamed into place moments later (a pasted
      // screenshot, a race with the file watcher, a wikilink clicked before its target
      // exists yet). 404 is heuristically cacheable by default (RFC 9110 §15.3) with no
      // explicit Cache-Control, so a long-lived cache — a packaged desktop app's WKWebView
      // keeps one NSURLCache for the whole session, unlike a browser tab reloaded fresh each
      // dev test — could otherwise pin a stale 404 for this exact `?path=` forever, long
      // after the underlying file (and any resolution bug) is fixed: every retry keeps
      // hitting the cached miss instead of ever re-asking the (now-correct) server.
      if (!abs) return error("asset not found", 404, { "Cache-Control": "no-store" });
      const file = Bun.file(abs);
      // Short cache so re-opening a note doesn't re-fetch (and re-walk the vault for the
      // filename-first resolution) every time; `private` keeps it out of shared proxies.
      return new Response(file, {
        headers: { "Content-Type": file.type || "application/octet-stream", "Cache-Control": "private, max-age=60" },
      });
    },

    // Resolve a vault-relative path to its ABSOLUTE machine-local path (FILENAME-FIRST, like
    // /asset; traversal-guarded inside resolveAsset). Backs the preview tab's "Open in default
    // app" / "Reveal in Finder" affordances, which need a real filesystem path to hand to the OS
    // opener. Read-only; 404 when nothing matches (never cached — see GET /asset above).
    "GET /abs-path": async (_, url) => {
      const path = requireQueryParam(url, "path");
      const abs = await resolveAsset(cfg.vault, path);
      if (!abs) return error("not found", 404, { "Cache-Control": "no-store" });
      return ok({ path: abs });
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

    // App-control read surface (see core/src/uiControl.ts) — the ONLY channel that drives a running
    // window's tabs from outside the webview, powering the `app` CLI group and (through bismuth_cli)
    // MCP app control. Like /relay/* these live in the READ table: /ui/command relays a request to a
    // window and returns its reply; any vault mutation the window then performs runs its OWN
    // invalidation path, so there's nothing for the command route to invalidate.

    // Every connected window (id, distinct label, active tab, tab count). Empty [] when none are open.
    "GET /ui/windows": async (_, __) => {
      return ok(listWindows());
    },

    // Relay one command to a window and return its {ok, result|error}. `windowId` picks a specific
    // window; omitted, the single open window is used (0 → 404, many → 409). Two auditable gates run
    // BEFORE dispatch (mirrored client-side in uiControlClient.ts): run-command refuses any
    // blocklisted id (heavyweight verbs + opening chat), and open-tab refuses `::chat:` content —
    // opening a live recursive Agent-SDK chat is a deliberately different trust boundary.
    "POST /ui/command": async (req, __) => {
      const { windowId, action, args } = (await req.json()) as { windowId?: string; action?: string; args?: unknown };
      if (typeof action !== "string" || !action) return error("missing action", 400);
      if (action === "run-command") {
        const id = (args as { id?: unknown } | undefined)?.id;
        if (typeof id !== "string" || !id) return error("run-command requires args.id", 400);
        if (UI_CONTROL_BLOCKLIST.includes(id)) return error(`command "${id}" is not allowed via app control`, 403);
      }
      if (action === "open-tab") {
        const content = (args as { content?: unknown } | undefined)?.content;
        if (typeof content === "string" && content.startsWith("::chat:")) {
          return error("opening chat tabs via app control is disabled", 403);
        }
      }
      const target = resolveTarget(windowId);
      if (!target.ok) return error(target.error, target.status);
      return ok(await sendCommand(target.id, action, args));
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
        vaultRows: () => (rowsMemo ??= rowsCache.get()),
        vaultTasks: () => (tasksMemo ??= tasksCache.get()),
      });
      return ok(rows);
    },

    "POST /backup": async (_, __) => {
      // Coalesced: editor autosave hits this on every save, so debounce into one commit per quiet
      // window instead of committing on each keystroke-save (the .git-bloat / iCloud-conflict cause).
      scheduleBackup(cfg.vault, () => snapshotMessage());
      return ok({ scheduled: true });
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

    // AI prompt-search fallback: re-rank keyword candidates with a one-shot Haiku turn when the
    // literal /search comes up empty for a natural-language question (searchPrompt.ts). Read-only
    // despite POST (like /search) — no cache-invalidate/SSE — so it lives in routes. Errors map to
    // AppError.statusCode: no-claude → 400 (shown inline), model failure → 500.
    "POST /search-prompt": async (req, __) => {
      const { query } = (await req.json()) as { query: string };
      try {
        return Response.json(await promptSearch(cfg.vault, query));
      } catch (e) {
        const status = e instanceof AppError ? e.statusCode : 500;
        return new Response((e as Error).message, { status });
      }
    },

    // List filesystem directory entries matching a partial path — backs autocomplete
    // for `scope:"fs"` settings, which name a path OUTSIDE the vault.
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

    // Daemon supervision. These read the shared machine-identity state files under the
    // daemon machine dir (BISMUTH_DAEMON_DIR, default ~/.bismuth/daemon) that the daemon
    // authors; vault-independent, so they live here regardless of cfg.vault.
    "GET /daemon/status": async (_, __) => {
      // Augmented with THIS vault's daemon identity name (identity.md frontmatter) — the chat
      // surface presents as the daemon, so the client needs its name alongside liveness.
      return ok({ ...daemonStatus(), name: daemonIdentityName(cfg.vault) });
    },

    "GET /daemon/devices": async (_, __) => {
      return ok(listDevices());
    },

    // DAEMON graph mode: the daemon hub + a node per cron / process for THIS vault, read
    // straight from the vault's `.daemon` dir (never throws → degrades to empty). The daemon
    // liveness is still machine-level. Polled by the frontend while in daemon mode.
    "GET /daemon/graph": async (_, __) => {
      // Position the daemon star the same way the vault graph is laid out: attach
      // backend-computed position2d/position3d so the WebGL renderer can place nodes
      // (unlike agents mode, daemon has no separate SVG layout). Cached by graph sig,
      // so polled state changes (opacity/tint) keep stable positions.
      return ok(await attachLayout(daemonGraph(vaultDaemonDir(cfg.vault), daemonIdentityName(cfg.vault)), "daemon"));
    },

    // Daemon install/setup, bridged to the bundled daemon binary's CLI surface
    // (core/src/daemonInstall.ts → `bismuth-daemon --status` / `--ensure-installed`).
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

    // The daemon ships as a bundled binary that updates WITH the app (no git pull / self-
    // update path anymore), so "update" just re-runs the idempotent, adopt-only install to
    // (re-)register the launchd/systemd service. System action, not a vault mutation → READ
    // routes. Idempotent (adopts an already-installed/running daemon).
    "POST /daemon/update": async (_, __) => {
      return ok(await runSetup());
    },

    // Machine-wide bismuth CLI + MCP install (core/src/bismuthInstall.ts). Like the daemon
    // routes above: a read-only status probe + an idempotent, version-gated ensure — system
    // actions, NOT vault mutations, so they live in the READ routes. Both never throw.
    "GET /bismuth/install": async (_, __) => {
      return ok(await getBismuthStatus());
    },

    "POST /bismuth/install": async (_, __) => {
      return ok(await ensureBismuthInstalled(process.env.BISMUTH_INSTALL_SRC));
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
    // command (drops a trigger file the daemon polls). These mutate the
    // daemon's shared files, NOT the vault — so, like POST /daemon/setup and the /relay/*
    // hooks, they live in the READ routes (no vault-cache invalidation; the frontend
    // re-polls /daemon/graph). Unknown name → setCronEnabled/runCron throw AppError
    // ("ENOENT") → 404 via the dispatch catch.
    "POST /daemon/cron/toggle": async (req) => {
      const { name, enabled } = (await req.json()) as { name?: string; enabled?: boolean };
      if (!name || typeof enabled !== "boolean") return error("missing name/enabled", 400);
      setCronEnabled(name, enabled, vaultDaemonDir(cfg.vault));
      return ok({ ok: true });
    },

    "POST /daemon/cron/run": async (req) => {
      const { name } = (await req.json()) as { name?: string };
      if (!name) return error("missing name", 400);
      runCron(name, vaultDaemonDir(cfg.vault));
      return ok({ ok: true });
    },

    "POST /daemon/process/toggle": async (req) => {
      const { name, enabled } = (await req.json()) as { name?: string; enabled?: boolean };
      if (!name || typeof enabled !== "boolean") return error("missing name/enabled", 400);
      setProcessEnabled(name, enabled, vaultDaemonDir(cfg.vault));
      return ok({ ok: true });
    },

    // The daemon "inbox": pages the daemon authored under .daemon/pages/*.md asking the user to
    // approve/dismiss an action (see core/src/daemonPages.ts). Read-only despite the GC side
    // effect (deleting long-resolved pages is an implementation detail of "list", not a vault
    // mutation the frontend needs to react to specially), so it lives in the READ table like the
    // other /daemon/* routes above — the frontend just polls it.
    "GET /daemon/pages": async (_, __) => {
      // appConfig.daemon.inboxRetentionDays mirrors the settings-schema default (see
      // schema/settingsSchema.ts's daemon.inboxRetentionDays) when settings.yaml hasn't loaded yet.
      return ok(listDaemonPages(cfg.vault, appConfig.daemon?.inboxRetentionDays ?? 7));
    },

    // Resolve a pressed action: approve (has a `prompt`) writes the sidecar to "working" and
    // drops a trigger the daemon's processPageTriggers polls; dismiss (no `prompt`) resolves
    // entirely here. NOT a vault mutation (the page .md itself is untouched — only its sidecar
    // under .daemon/pages/.state/ changes), so, like /daemon/cron/toggle, it lives in the READ
    // table — no cache-invalidate; the frontend re-polls GET /daemon/pages.
    "POST /daemon/pages/resolve": async (req) => {
      const { path, actionId } = (await req.json()) as { path?: string; actionId?: string };
      if (!path || !actionId) return error("missing path/actionId", 400);
      return ok(resolvePage(cfg.vault, path, actionId));
    },

    // Belt-and-suspenders client escape hatch (plan §5): force the sidecar to "failed" with no
    // daemon involvement, for a page stuck "working" implausibly long (the daemon process died
    // mid-run). Same READ-table reasoning as the route above.
    "POST /daemon/pages/mark-failed": async (req) => {
      const { path } = (await req.json()) as { path?: string };
      if (!path) return error("missing path", 400);
      markPageFailed(cfg.vault, path);
      return ok({ ok: true });
    },

    // Google Calendar two-way sync — Phase 0: OAuth plumbing. The flow (Authorization
    // Code + PKCE, loopback redirect) and all secrets live OUTSIDE the vault
    // (~/.bismuth/gcal); these are SYSTEM actions, not vault mutations, so — like the
    // /daemon/* routes — they live in the READ table (no cache-invalidate). The single
    // requested scope is calendar.events (events read+write only; no Gmail/Drive/contacts).
    "GET /gcal/status": async (_, __) => {
      return ok(gcalStatus());
    },

    // Store the OAuth client credentials (id + secret) outside the vault. Sent once
    // from the connect modal; the secret never enters settings.yaml/git.
    "POST /gcal/credentials": async (req) => {
      const { clientId, clientSecret } = (await req.json()) as { clientId?: string; clientSecret?: string };
      if (!clientId || !clientSecret) return error("missing clientId/clientSecret", 400);
      gcalSetCredentials(clientId, clientSecret);
      return ok({ ok: true });
    },

    // Begin auth: returns the Google consent URL for the frontend to open in the system
    // browser. The loopback redirect targets THIS backend's port (Google desktop clients
    // accept any 127.0.0.1 port), so the callback lands right back here.
    "POST /gcal/auth/start": async (_, __) => {
      const redirectUri = `http://127.0.0.1:${server.port}/gcal/callback`;
      try {
        return ok({ url: await gcalStartAuth(redirectUri) });
      } catch (e) {
        return error((e as Error).message, 400);
      }
    },

    // The loopback redirect target Google sends the user's browser to (top-level
    // navigation, not fetch → no CORS). Exchanges the code and renders a small HTML page.
    "GET /gcal/callback": async (_, url) => {
      const errParam = url.searchParams.get("error");
      if (errParam) return gcalCallbackHtml(`Authorization was cancelled or failed (${errParam}).`, false);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return gcalCallbackHtml("Missing authorization code in the callback.", false);
      try {
        const st = await gcalCompleteAuth(code, state);
        return gcalCallbackHtml(`Connected as ${st.account ?? "Google Calendar"}. You can close this tab and return to Bismuth.`, true);
      } catch (e) {
        return gcalCallbackHtml(`Could not complete sign-in: ${(e as Error).message}`, false);
      }
    },

    "POST /gcal/disconnect": async (_, __) => {
      await gcalDisconnect();
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

    // Google Calendar two-way sync (Phase 2): reconcile the configured Google calendar with
    // the configured calendar base in both directions (last-write-wins). A vault MUTATION (it
    // rewrites the base file), so it lives here and `pathOf` returns the base path →
    // cache-invalidate + SSE re-render of the open calendar. Config from appConfig.googleCalendar.
    "POST /gcal/sync": mutatingHandler(
      async (req) => {
        // A manual sync may pass an explicit basePath (the per-calendar modal does) so it
        // targets the right calendar immediately, without waiting for the debounced settings
        // write to round-trip into appConfig.
        const body = (await req.json().catch(() => ({}))) as { basePath?: string };
        const { basePath, calendarId, policy, timeZone, theme } = gcalSyncArgs(appConfig, body.basePath);
        if (!basePath) return error("set googleCalendar.basePath to the calendar base you want to sync", 400);
        try {
          return ok(await gcalSync(cfg.vault, basePath, calendarId, policy, timeZone, theme));
        } catch (e) {
          return error((e as Error).message, 400);
        }
      },
      () => appConfig.googleCalendar?.basePath || undefined,
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
        // A file's `visibility:` edit re-gates open chats — but ONLY that key: /set-property is
        // also the Bases kanban drag-drop path, so invalidating on every property write would
        // needlessly respawn every chat on each kanban move.
        if (key === "visibility") invalidateChatVisibility();
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
        if (key === "visibility") invalidateChatVisibility(); // clearing visibility re-gates open chats
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
        // GET /tree overlays icons from the cached appConfig (no per-request .settings read),
        // and the watcher-driven loadAppConfig refresh lands a debounce (~250ms) AFTER this
        // mutation's SSE — patch the in-memory map synchronously so the client's immediate
        // refetch already sees the new icon instead of a stale flash.
        const icons = { ...((appConfig.folderIcons as Record<string, string> | undefined) ?? {}) };
        if (icon) icons[path] = icon;
        else delete icons[path];
        appConfig = { ...appConfig, folderIcons: icons };
        return ok();
      },
      // settings.yaml change → invalidate broadly; pass its path so classifyVault
      // marks both graph & tree dirty (isSettingsPath), refreshing /tree.
      () => SETTINGS_FILE,
    ),

    "POST /folder-visibility": mutatingHandler(
      async (req) => {
        // Assign (or clear) AI visibility for a folder. Folders have no frontmatter, so
        // the mapping lives in settings.yaml and is overlaid onto /tree file+dir entries
        // (core/src/visibility.ts resolveVisibility/resolveFolderVisibility).
        const { path, visibility } = (await req.json()) as { path: string; visibility?: string | null };
        if (typeof path !== "string" || path.length === 0) {
          return error("missing path", 400);
        }
        // Reject traversal / absolute paths — folder paths are vault-relative.
        const segments = path.split("/");
        if (path.startsWith("/") || segments.some((s) => s === ".." || s === ".")) {
          return error("invalid path", 400);
        }
        if (visibility !== "chat-only" && visibility !== "hidden" && visibility !== null && visibility !== undefined) {
          return error("invalid visibility", 400);
        }
        // Only claim success — and patch the in-memory config / badge — if the write actually
        // PERSISTED. A corrupt .settings leaves the map untouched and returns false; optimistically
        // patching appConfig then would show a "hidden" badge (and imply enforcement) for a state
        // that was never written. Normalize the key to match setFolderVisibility's own write.
        const persisted = await setFolderVisibility(cfg.vault, path, visibility ?? null);
        if (!persisted) {
          return error("settings file is invalid — fix .settings before changing folder visibility", 409);
        }
        // A folder-visibility change re-gates every open chat: flag live sessions so their next
        // turn respawns query() with a fresh deny list (managedSettings/sandbox are spawn-fixed).
        invalidateChatVisibility();
        const key = path.replace(/\/+$/, "").replace(/\/{2,}/g, "/");
        // Same synchronous appConfig patch as /folder-icon: GET /tree overlays visibility
        // from the cached appConfig, and the watcher-driven loadAppConfig refresh lands a
        // debounce (~250ms) AFTER this mutation's SSE — patch in-memory so the client's
        // immediate refetch already sees the new value instead of a stale flash.
        const visibilities = { ...((appConfig.folderVisibility as Record<string, Visibility> | undefined) ?? {}) };
        if (visibility) visibilities[key] = visibility;
        else delete visibilities[key];
        appConfig = { ...appConfig, folderVisibility: visibilities };
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
        const eol = content.includes("\r\n") ? "\r\n" : "\n";
        const lines = content.split(/\r?\n/);
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
        // Resolved (done/cancelled) tasks sink to the bottom of their list so a checked-off
        // todo drops below the still-open ones, matching the card view's grouping.
        await writeNote(cfg.vault, path, reorderTaskBlocks(lines.join(eol)));
        return ok();
      },
      (b) => b.path,
    ),

    // Archive completed/cancelled tasks. With a `path`, only that note; otherwise the whole
    // vault. Removal is permanent (git retains history). Returns the count removed.
    "POST /tasks/archive": mutatingHandler(
      async (req) => {
        const { path } = (await req.json().catch(() => ({}))) as { path?: string };
        if (path) {
          const { content, removed } = archiveResolvedTasks(await readNote(cfg.vault, path));
          if (removed > 0) await writeNote(cfg.vault, path, content);
          return ok({ removed, files: removed > 0 ? 1 : 0 });
        }
        const rels = await listMarkdown(cfg.vault);
        let removed = 0;
        let files = 0;
        for (const rel of rels) {
          const res = archiveResolvedTasks(await readNote(cfg.vault, rel));
          if (res.removed > 0) {
            await writeNote(cfg.vault, rel, res.content);
            removed += res.removed;
            files++;
          }
        }
        return ok({ removed, files });
      },
      (b) => (b as { path?: string }).path,
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

    // Author a daemon inbox page with validated frontmatter (core/src/daemonPages.ts's
    // createDaemonPage). A genuine vault write (the page .md lands under .daemon/pages/ and shows in
    // the sidebar), so — unlike the /daemon/pages/{resolve,mark-failed} sidecar writes in the READ
    // table — this is a MUTATION: `pathOf` returns the new page path so classifyVault (DAEMON_PAGE_RE)
    // marks the tree dirty and the inbox refreshes. Exposed via the `page` CLI group so an MCP/daemon
    // caller creates a well-formed page instead of a fragile raw file write (still zero new MCP tools).
    "POST /daemon/pages": mutatingHandler(
      async (req) => {
        const body = (await req.json()) as CreatePageInput;
        return ok(createDaemonPage(cfg.vault, body));
      },
      (b) => (typeof b?.slug === "string" && b.slug ? `.daemon/pages/${b.slug}.md` : undefined),
    ),

    // Claim a device as the daemon owner: write owner.json (byte-compatible
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
  // Prefetch the 2nd/3rd-brain view layouts in the background once the graph is ready, attaching them
  // to the cached graph object in place (exactly as GET /graph/views does). Without this, the first
  // switch to a brain mode pays a cold subgraph layout on the click; with it, that switch is instant.
  void graphCache.get()
    .then((g) => computeViewLayouts(g, cfg.vault).then((views) => { g.views = views; }))
    .catch(() => {});

  // The WS payload is discriminated by `kind`: terminal sockets pipe a PTY, chat sockets
  // drive the headless Claude Code chat driver (core/src/chat.ts).
  type TermWsData = { kind: "terminal"; sessionId: string; dataSub?: { dispose(): void }; exitSub?: { dispose(): void } };
  type ChatWsData = { kind: "chat"; chatId: string; rebind: boolean };
  // The per-window control socket (core/src/uiControl.ts). `send` is the JSON-frame sender bound in
  // `open`, kept so `close` can identity-guard unregister (a stale close must not drop a reconnected
  // window that already re-registered under the same windowId).
  type UiWsData = { kind: "ui"; windowId: string; send?: (frame: unknown) => void };
  type WsData = TermWsData | ChatWsData | UiWsData;
  const server = Bun.serve<WsData>({
    port: cfg.port ?? 4321,
    // Bun's default idleTimeout is 10s, which would drop a connection mid-request for the
    // few slow handlers we have (notably long export/GCal-sync requests). 255s is Bun's
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
            createTerminalSession({ cwd: cfg.vault, cols, rows, relayPort: server.port, termId, memoryDir: effectiveMemoryDir() });
          createdNew = true;
        }
        const upgraded = server.upgrade(req, { data: { kind: "terminal", sessionId: session.id } as TermWsData });
        if (!upgraded) {
          // Never hard-kill a reattached live shell on a failed upgrade; just let its
          // grace timer reclaim it if no socket reconnects.
          if (createdNew) killSession(session.id);
          else scheduleSessionKill(session.id, reattachGraceMs());
          return withCors(error("upgrade failed", 400));
        }
        return new Response(null, { status: 101 }); // upgrade response is sent by Bun
      }

      // Chat WebSocket upgrade — drives the headless Claude Code chat driver. Same origin
      // allow-list as /terminal. Read-path (not a vault mutation): the client may pass a
      // stable `chatId` to resume conversation continuity across reconnects; otherwise one
      // is generated.
      if (req.method === "GET" && url.pathname === "/chat") {
        const origin = req.headers.get("origin");
        const allowed =
          !origin ||
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
          /^tauri:\/\//.test(origin) ||
          /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin);
        if (!allowed) {
          return withCors(error("forbidden origin", 403));
        }
        const chatId = url.searchParams.get("chatId") || newChatId();
        // `rebind=1` marks a RECONNECT (the client had this chat open and lost the socket) as
        // opposed to a first open — it lets the open handler tell the client when the session
        // it expects is already gone (grace window expired) instead of silently starting fresh.
        const rebind = url.searchParams.get("rebind") === "1";
        const upgraded = server.upgrade(req, { data: { kind: "chat", chatId, rebind } as ChatWsData });
        if (!upgraded) return withCors(error("upgrade failed", 400));
        return new Response(null, { status: 101 });
      }

      // UI-control WebSocket — the core→frontend command channel (core/src/uiControl.ts). Same
      // origin allow-list as /terminal + /chat. `?w=<id>` is the window's stable id (windowId.ts);
      // absent → "main" (the primary window). Registered on open, keyed by that id.
      if (req.method === "GET" && url.pathname === "/ui") {
        const origin = req.headers.get("origin");
        const allowed =
          !origin ||
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
          /^tauri:\/\//.test(origin) ||
          /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin);
        if (!allowed) return withCors(error("forbidden origin", 403));
        const windowId = url.searchParams.get("w") || "main";
        const upgraded = server.upgrade(req, { data: { kind: "ui", windowId } as UiWsData });
        if (!upgraded) return withCors(error("upgrade failed", 400));
        return new Response(null, { status: 101 });
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
        if (ws.data.kind === "ui") {
          // Register this window's control socket. `send` pushes JSON command frames; it's stashed on
          // ws.data so `close` can identity-guard the unregister.
          const send = (frame: unknown) => {
            try { ws.send(JSON.stringify(frame)); } catch { /* socket closed */ }
          };
          ws.data.send = send;
          registerWindow(ws.data.windowId, send);
          return;
        }
        if (ws.data.kind === "chat") {
          // A reconnect (same chatId) mid-turn: re-point the live session's sink at THIS new socket
          // and cancel its grace-period teardown, so in-flight drain frames (incl. the turn's tail
          // and `done`) flow here instead of the dead socket — rebindSink also flushes any frames
          // buffered while detached. A brand-new chat has no session yet — rebind is a no-op and
          // the first {type:"user"} binds the sink via sendMessage.
          const { chatId, rebind } = ws.data;
          const rebound = chatRebindSink(chatId, (frame: unknown) => {
            try { ws.send(JSON.stringify(frame)); } catch { /* socket closed mid-turn */ }
          });
          // The client RECONNECTED expecting its session, but the 30s grace already tore it down
          // (closeChat sends no frame) — tell it explicitly so a wedged mid-turn UI clears and the
          // user learns the conversation ended, instead of the next send silently starting fresh.
          if (!rebound && rebind) {
            const frame = { type: "error", code: "exit", message: "The Claude Code session ended while disconnected — send a message to start a new one." };
            try { ws.send(JSON.stringify(frame)); } catch { /* */ }
          }
          return;
        }
        const data = ws.data;
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
        if (ws.data.kind === "ui") {
          // Two client→core frames on the control socket:
          //   {type:"tabs", snapshot}                 → the tab-layout heartbeat (powers /ui/windows)
          //   {type:"reply", reqId, ok, result, error} → answer to a command core sent
          const text = msg instanceof ArrayBuffer || msg instanceof Uint8Array ? dec.decode(msg) : (msg as string);
          let parsed: { type?: string; snapshot?: UiTabsSnapshot; reqId?: string; ok?: boolean; result?: unknown; error?: string };
          try { parsed = JSON.parse(text); } catch { return; }
          if (parsed.type === "tabs" && parsed.snapshot) {
            updateTabs(ws.data.windowId, parsed.snapshot);
          } else if (parsed.type === "reply" && typeof parsed.reqId === "string") {
            resolveReply(parsed.reqId, {
              ok: parsed.ok === true,
              result: parsed.result,
              error: typeof parsed.error === "string" ? parsed.error : undefined,
            });
          }
          return;
        }
        if (ws.data.kind === "chat") {
          // Chat protocol is text JSON, driving the visual Claude Code session (core/src/chat.ts):
          //   {type:"open"}                                   → spawn the session eagerly (no turn) so
          //                                                     the header's manifest + models frame land
          //                                                     before the first message (BUG #14)
          //   {type:"user",text,images?}                      → run a turn (slash commands are just text;
          //                                                     images = base64 blocks the user attached)
          //   {type:"resume",sessionId}                       → bind this chat to an existing session
          //   {type:"permission_response",id,behavior,always?} → answer a "permission" frame
          //   {type:"set_permission_mode",mode}               → switch permission mode live
          //   {type:"set_model",model}                        → switch model live
          //   {type:"stop"}                                   → interrupt the in-flight turn
          // ChatFrames stream back via the sink.
          const { chatId } = ws.data;
          const text = msg instanceof ArrayBuffer || msg instanceof Uint8Array ? dec.decode(msg) : (msg as string);
          let parsed: {
            type?: string;
            text?: string;
            images?: { media_type?: unknown; data?: unknown }[];
            sessionId?: string;
            id?: string;
            behavior?: "allow" | "deny";
            always?: boolean;
            mode?: string;
            model?: string;
          };
          try {
            parsed = JSON.parse(text);
          } catch {
            return;
          }
          const chatSink = (frame: unknown) => {
            try {
              ws.send(JSON.stringify(frame));
            } catch {
              /* socket closed mid-turn */
            }
          };
          if (parsed.type === "open") {
            // Chat OPEN (the ChatView just mounted / reconnected on a fresh id): spawn the session
            // eagerly so its `init` manifest + `models` frame + permission mode stream to the header
            // BEFORE the first message (BUG #14). No-op if a session already exists for this chatId
            // (a mid-turn reconnect already rebound the sink on WS open) — never spawns a duplicate.
            chatOpen(chatId, cfg.vault, chatSink, effectiveMemoryDir());
          } else if (parsed.type === "user" && typeof parsed.text === "string") {
            // Accept optional base64 image attachments; keep only well-formed {media_type,data}
            // pairs whose media_type is an SDK-accepted image MIME (the frontend whitelist is not the
            // only client — a rogue local client could send anything), so a malformed or
            // unsupported attachment can never reach makeUserMessage / the SDK image block.
            const images = Array.isArray(parsed.images)
              ? parsed.images.filter(
                  (im): im is { media_type: string; data: string } =>
                    !!im &&
                    typeof im === "object" &&
                    typeof (im as { media_type?: unknown }).media_type === "string" &&
                    ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
                      (im as { media_type: string }).media_type,
                    ) &&
                    typeof (im as { data?: unknown }).data === "string" &&
                    (im as { data: string }).data.length > 0,
                )
              : [];
            chatSend(chatId, parsed.text, cfg.vault, chatSink, images.length ? images : undefined, effectiveMemoryDir());
          } else if (parsed.type === "resume" && typeof parsed.sessionId === "string") {
            // Bind this chat socket to an existing Claude Code session — its init manifest streams
            // back, and the next {type:"user"} continues the resumed conversation.
            chatResume(chatId, parsed.sessionId, cfg.vault, chatSink, effectiveMemoryDir());
          } else if (
            parsed.type === "permission_response" &&
            typeof parsed.id === "string" &&
            (parsed.behavior === "allow" || parsed.behavior === "deny")
          ) {
            chatRespondPermission(chatId, parsed.id, parsed.behavior, parsed.always === true);
          } else if (parsed.type === "set_permission_mode" && typeof parsed.mode === "string") {
            chatSetPermissionMode(chatId, parsed.mode);
          } else if (parsed.type === "set_model" && typeof parsed.model === "string") {
            chatSetModel(chatId, parsed.model);
          } else if (parsed.type === "stop") {
            chatAbort(chatId);
          }
          return;
        }
        const { sessionId } = ws.data;
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
        if (ws.data.kind === "ui") {
          // Identity-guarded (uiControl.ts): a stale close after a reconnect re-registered a new
          // socket under this windowId is a no-op, so the live window isn't dropped.
          unregisterWindow(ws.data.windowId, ws.data.send);
          return;
        }
        if (ws.data.kind === "chat") {
          // A CLEAN close (1000) is an intentional tab-close → tear the session down now. An
          // ABNORMAL close (reload 1001, network drop 1006) → detach the sink (frames buffer for
          // the reconnect's rebindSink flush instead of vanishing into the dead socket) and keep
          // the session alive for a short grace window so a reconnect (the client retries with
          // the same chatId) resumes the same `claude` conversation instead of spawning a fresh
          // one. The next sendMessage/rebind cancels the timer.
          if (code === 1000) {
            closeChat(ws.data.chatId);
          } else {
            chatDetachSink(ws.data.chatId);
            scheduleChatClose(ws.data.chatId, 30_000);
          }
          return;
        }
        const data = ws.data;
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

  // Drop this core's discovery record (~/.bismuth/run/<vault>.json = {port, vault, pid}) now that
  // Bun.serve has bound its (possibly dynamic) port, so an out-of-app caller — the `bismuth app …`
  // CLI, the launchd daemon — can find which port serves this vault. Best-effort; cleaned up on exit.
  if (typeof server.port === "number") {
    writeRunRecord({ port: server.port, vault: cfg.vault, pid: process.pid });
  }

  // Pre-warm one login shell so the first terminal tab paints its prompt instantly
  // (cwd = vault, reporting to this server's port). Guarded so a spawn failure here can
  // never take the server down — terminals still cold-spawn on demand.
  try {
    prewarmPool(cfg.vault, server.port, effectiveMemoryDir());
  } catch {
    /* pre-warm is best-effort */
  }

  // Background Google Calendar auto-sync: when enabled + connected + a base is configured,
  // run a two-way sync every `syncIntervalMinutes`. The base-file write is picked up by the
  // vault watcher (cache-invalidate + SSE) so the open calendar refreshes. Best-effort +
  // error-tolerant; the 60s ticker is unref'd so it never keeps the process alive, and is a
  // no-op in tests (googleCalendar.enabled defaults to false). A run-guard prevents overlap.
  let gcalAutoSyncAt = 0;
  let gcalAutoSyncRunning = false;
  setInterval(() => {
    const gc = appConfig.googleCalendar;
    if (!gc?.enabled || !gc.basePath || gcalAutoSyncRunning) return;
    if (!gcalStatus().connected) return;
    const everyMs = Math.max(1, gc.syncIntervalMinutes || 15) * 60_000;
    if (Date.now() - gcalAutoSyncAt < everyMs) return;
    gcalAutoSyncAt = Date.now();
    gcalAutoSyncRunning = true;
    const { basePath, calendarId, policy, timeZone, theme } = gcalSyncArgs(appConfig);
    void gcalSync(cfg.vault, basePath, calendarId, policy, timeZone, theme)
      .catch((e) => console.error(`[gcal] auto-sync failed: ${(e as Error).message}`))
      .finally(() => { gcalAutoSyncRunning = false; });
  }, 60_000).unref();

  return server;
}

if (import.meta.main) {
  const vault = cliArg("vault") ?? process.env.BISMUTH_VAULT;
  const memory = cliArg("memory") ?? process.env.BISMUTH_MEMORY;
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
  // passes BISMUTH_APP_PID; open-folder siblings inherit it via Bun.spawn's env. Absent in dev
  // (`bun run dev`) → no-op. signal 0 only probes liveness; the timer is unref'd so it never
  // keeps the process alive on its own.
  const ownerPid = Number(process.env.BISMUTH_APP_PID);
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
  // staged tools resource (BISMUTH_INSTALL_SRC). Version-gated → no-op when unchanged.
  // Best-effort + non-blocking; never crashes the server.
  if (process.env.BISMUTH_INSTALL_SRC) {
    ensureBismuthInstalled(process.env.BISMUTH_INSTALL_SRC)
      .then((r) => {
        console.log(`bismuth tools: ${r.action}`);
        for (const w of r.warnings) console.warn(`bismuth tools: ${w}`);
      })
      .catch((e) => console.warn(`bismuth tools install failed: ${e?.message ?? e}`));
  }
}
