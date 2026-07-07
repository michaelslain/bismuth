// core/src/daemonPages.ts
// Core's read/write window onto "daemon pages" — the daemon's inbox: a page is an ordinary
// markdown note the daemon authors at `<vault>/.daemon/pages/<slug>.md` (full-YAML frontmatter,
// parsed via ./frontmatter), asking the user to approve or dismiss an action. Its DYNAMIC
// execution state (status/prompt/model/…) lives in a separate JSON sidecar under
// `.daemon/pages/.state/<slug>.json` — never in the page's own frontmatter, because
// Editor.tsx's external-reload reconcile blocks while the user has un-flushed edits and the
// pending autosave would clobber a same-file daemon write. This mirrors the daemon's own
// `.last-fired.json`/`.running.json` split for crons.
//
// Core resolves the pressed action's PROMPT here (not the daemon): the daemon's frontmatter
// reader (daemon/src/lib/frontmatter.ts) is a single-line `key: value` parser that can't handle
// nested `actions[]` YAML, but core's parseFrontmatter has the real `yaml` library. So
// `resolvePage` looks up the action, stamps its prompt/model/timeout into the sidecar, and drops
// a trigger file — the daemon's `processPageTriggers` just reads the sidecar + the page body and
// fires a session; it never parses the page's frontmatter itself.
import { join, dirname } from "node:path";
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, readdirSync } from "node:fs";
import { parseFrontmatter } from "./frontmatter";
import { writeTrigger } from "./daemon";
import { AppError } from "./error";

/** One action button on a page — parsed straight from its frontmatter `actions[]`. Presence of
 *  `prompt` distinguishes an "approve" action (the daemon acts) from a pure "dismiss" (resolved
 *  entirely by core, no daemon round-trip) — one less field to desync. */
export interface PageAction {
  id: string;
  label: string;
  /** Cosmetic only — button styling. Defaults to "default". */
  kind: "primary" | "default" | "danger";
  /** Falls back to sendMessage's default model when omitted. */
  model?: string;
  /** Session timeout in seconds. Defaults to 300 when omitted. */
  timeout?: number;
  /** Present => "approve" (the daemon runs this prompt). Absent => pure dismiss. */
  prompt?: string;
}

export type PageStatus = "pending" | "working" | "done" | "failed" | "dismissed";

/** The dynamic sidecar — everything that changes after the page is authored. A page with no
 *  sidecar yet reads as `pending` (the synthesized default in {@link listDaemonPages}). */
export interface PageState {
  status: PageStatus;
  pressedAction?: string;
  pressedAt?: string;
  /** The resolved action prompt, stamped by core at press time (see module doc). */
  prompt?: string;
  model?: string;
  timeoutSecs?: number;
  /** Set by the daemon when it finishes (success or failure) — never by the LLM itself. */
  daemonNote?: string;
  completedAt?: string | null;
}

/** A page merged with its sidecar — what `GET /daemon/pages` and the frontend actually consume. */
export interface DaemonPage {
  /** Vault-relative path, e.g. ".daemon/pages/reply-drafts.md". */
  path: string;
  slug: string;
  title: string;
  createdAt: string;
  /** ISO instant; omitted (or unparseable) => deliver ASAP / on next open. */
  deliverAt?: string;
  /** Provenance, display-only (e.g. "cron:answer-emails"). */
  source?: string;
  actions: PageAction[];
  /** Frontmatter-stripped body — the editable draft, used for the inbox row's snippet. */
  body: string;
  status: PageStatus;
  pressedAction?: string;
  pressedAt?: string;
  daemonNote?: string;
  completedAt?: string | null;
}

/** `<vault>/.daemon/pages` — where daemon-authored pages live. */
export function vaultPagesDir(vault: string): string {
  return join(vault, ".daemon", "pages");
}

/** Dot-prefixed sidecar dir — kept out of the sidebar by `walkDir`'s hidden-entry skip (files.ts)
 *  for free, and out of the file watcher's graph/tree-dirty paths (server.ts's noise classifier). */
export function pageStateDir(vault: string): string {
  return join(vaultPagesDir(vault), ".state");
}

/** Dot-prefixed trigger dir the daemon polls (~5s), matching the crons/processes `.triggers`
 *  contract in core/src/daemon.ts's `writeTrigger`. */
export function pageTriggerDir(vault: string): string {
  return join(vaultPagesDir(vault), ".triggers");
}

/** Matches a page file under `.daemon/pages/` (one path segment, no dotfiles) — shared by
 *  server.ts's watcher-noise classifier (so a page write bumps `tree`) and this module's own
 *  path guard on `resolvePage`/`markPageFailed`, so both agree on what counts as a page. */
export const DAEMON_PAGE_RE = /^\.daemon\/pages\/[^/.][^/]*\.md$/;

function assertPagePath(path: string): void {
  if (!DAEMON_PAGE_RE.test(path)) throw new AppError("EINVAL", `not a daemon page: ${path}`, 400);
}

function slugOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1, -3); // strip ".../" and ".md"
}

function stateFile(vault: string, slug: string): string {
  return join(pageStateDir(vault), `${slug}.json`);
}

/** Read a page's sidecar; null when absent/malformed (never throws — a fresh page has none yet). */
export function readPageState(vault: string, slug: string): PageState | null {
  try {
    return JSON.parse(readFileSync(stateFile(vault, slug), "utf8")) as PageState;
  } catch {
    return null;
  }
}

/** Write a page's sidecar via a temp-then-rename swap — the daemon may be reading this same
 *  file (its `processPageTriggers` polls status) concurrently, so a partial write must never be
 *  observable. Mirrors `registerVaultRoot`'s vaults.json swap in ./daemon.ts. */
function writePageState(vault: string, slug: string, state: PageState): void {
  const file = stateFile(vault, slug);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file);
}

function deletePageState(vault: string, slug: string): void {
  try { unlinkSync(stateFile(vault, slug)); } catch { /* already gone */ }
}

/** Tolerant parse of frontmatter `actions[]` — skips any entry missing `id`/`label` rather than
 *  failing the whole page (a daemon-authored file with one malformed action shouldn't vanish). */
function parseActions(raw: unknown): PageAction[] {
  if (!Array.isArray(raw)) return [];
  const out: PageAction[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const a = entry as Record<string, unknown>;
    if (typeof a.id !== "string" || typeof a.label !== "string") continue;
    out.push({
      id: a.id,
      label: a.label,
      kind: a.kind === "primary" || a.kind === "danger" ? a.kind : "default",
      model: typeof a.model === "string" ? a.model : undefined,
      timeout: typeof a.timeout === "number" ? a.timeout : undefined,
      prompt: typeof a.prompt === "string" ? a.prompt : undefined,
    });
  }
  return out;
}

/**
 * List every daemon page, merged with its sidecar (synthesizing `pending` when absent).
 * Runs a best-effort GC pass first: a page whose sidecar is TERMINAL (done/failed/dismissed) and
 * whose completion/press time is older than `retentionDays` is deleted (page + sidecar) rather
 * than returned — no cron, no ticker; the frontend's own poll of this endpoint is what makes GC
 * run regularly (see plan §7). Never throws: a missing/unreadable pages dir just means no pages
 * yet (a vault whose daemon has never authored one).
 */
export function listDaemonPages(vault: string, retentionDays: number): DaemonPage[] {
  const dir = vaultPagesDir(vault);
  let files: string[];
  try {
    files = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".md"))
      .map((d) => d.name);
  } catch {
    return [];
  }

  const retentionMs = Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const pages: DaemonPage[] = [];

  for (const file of files) {
    const slug = file.slice(0, -3);
    let raw: string;
    try {
      raw = readFileSync(join(dir, file), "utf8");
    } catch {
      continue; // deleted mid-scan
    }
    const { data, body } = parseFrontmatter(raw);
    const state = readPageState(vault, slug);
    const status: PageStatus = state?.status ?? "pending";

    if (status === "done" || status === "failed" || status === "dismissed") {
      const anchor = state?.completedAt ?? state?.pressedAt;
      const anchorMs = anchor ? Date.parse(anchor) : NaN;
      if (!Number.isNaN(anchorMs) && now - anchorMs > retentionMs) {
        try { unlinkSync(join(dir, file)); } catch { /* best-effort */ }
        deletePageState(vault, slug);
        continue; // GC'd — excluded from the result, not just hidden
      }
    }

    pages.push({
      path: `.daemon/pages/${file}`,
      slug,
      title: typeof data.title === "string" ? data.title : slug,
      createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
      deliverAt: typeof data.deliverAt === "string" ? data.deliverAt : undefined,
      source: typeof data.source === "string" ? data.source : undefined,
      actions: parseActions(data.actions),
      body,
      status,
      pressedAction: state?.pressedAction,
      pressedAt: state?.pressedAt,
      daemonNote: state?.daemonNote,
      completedAt: state?.completedAt ?? null,
    });
  }

  return pages;
}

/** Result of pressing a button: the status the page now reads (for the caller to reflect
 *  immediately, without waiting for the next poll) and whether this call was a no-op because
 *  the page was already resolved (double-click / a sibling window got there first). */
export interface ResolveResult {
  status: PageStatus;
  alreadyResolved: boolean;
}

/**
 * Resolve a pressed action on a page. Re-reads the page fresh (so it acts on exactly what's on
 * disk — the frontend flushes its buffer before calling this) and looks up `actionId` in its
 * frontmatter `actions[]`.
 *  - done/dismissed => idempotent no-op; "working" is guarded the same way, so a double-click
 *    or a second window can't re-fire (and clobber) a mid-flight run. "failed" is deliberately
 *    NOT terminal here: pressing again re-runs the round-trip (the documented retry flow).
 *  - No `prompt` (a pure dismiss) => write `dismissed`. No daemon involvement.
 *  - Has `prompt` (approve) => write `working` with the resolved prompt/model/timeout, then drop
 *    a trigger file the daemon's `processPageTriggers` polls (~5s).
 */
export function resolvePage(vault: string, path: string, actionId: string): ResolveResult {
  assertPagePath(path);
  let raw: string;
  try {
    raw = readFileSync(join(vault, path), "utf8");
  } catch {
    throw new AppError("ENOENT", `page not found: ${path}`, 404);
  }
  const { data } = parseFrontmatter(raw);
  const action = parseActions(data.actions).find((a) => a.id === actionId);
  if (!action) throw new AppError("EINVAL", `unknown action "${actionId}" on ${path}`, 400);

  const slug = slugOf(path);
  const currentStatus = readPageState(vault, slug)?.status ?? "pending";
  if (currentStatus === "done" || currentStatus === "dismissed" || currentStatus === "working") {
    return { status: currentStatus, alreadyResolved: true };
  }

  const pressedAt = new Date().toISOString();
  if (!action.prompt) {
    writePageState(vault, slug, { status: "dismissed", pressedAction: actionId, pressedAt });
    return { status: "dismissed", alreadyResolved: false };
  }

  writePageState(vault, slug, {
    status: "working",
    pressedAction: actionId,
    pressedAt,
    prompt: action.prompt,
    model: action.model,
    timeoutSecs: action.timeout ?? 300,
  });
  writeTrigger(vaultPagesDir(vault), slug);
  return { status: "working", alreadyResolved: false };
}

/**
 * Belt-and-suspenders client escape hatch (see plan §5): mark a page `failed` with no daemon
 * involvement, for when a page reads `working` implausibly long (the daemon process itself died
 * mid-run, no writer left to ever settle it). Compare-and-swap against the LIVE sidecar: if the
 * daemon already settled a real outcome (done/failed/dismissed) between the client's stale
 * "stuck" render and this call, that outcome wins — the daemon is the authoritative writer, and
 * a genuinely-sent email must never be relabeled "failed" by a late click.
 */
export function markPageFailed(vault: string, path: string): void {
  assertPagePath(path);
  const slug = slugOf(path);
  const existing = readPageState(vault, slug);
  const cur = existing?.status;
  if (cur === "done" || cur === "failed" || cur === "dismissed") return;
  writePageState(vault, slug, {
    ...existing,
    status: "failed",
    daemonNote: existing?.daemonNote || "Marked failed — no response from the daemon.",
    completedAt: new Date().toISOString(),
  });
}
