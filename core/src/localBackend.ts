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
// settings writer, tracked as the next increment.
import { buildGraph } from "./engine";
import { attachLayout, computeViewLayouts } from "./layout-cache";
import { getFileAccess } from "./fileAccess";
import { parseFrontmatter, setFrontmatterKey, deleteFrontmatterKey } from "./frontmatter";
import { parseBaseFile } from "./bases/parse";
import { resolveSource } from "./bases/source";
import { upsertRow, deleteRow, reorderRow } from "./bases/rowOps";
import { collectVaultTasks, toggleTaskLine } from "./tasks";
import { reorderTaskBlocks } from "./taskReorder";
import { collectDecks, dueCards, collectCards, noteCards, applyReview } from "./srs/cards";
import { applyReviewToRow } from "./srs/reviewRow";
import { DEFAULT_SRS } from "./srs/scheduler";
import { buildVaultRows } from "./basesData";
import { searchVault } from "./search";
import { replaceInVault } from "./replace";
import { todayISO } from "./dates";
import { fileBasename } from "./pathUtils";
import { AppError } from "./error";
import { DEFAULTS as SETTINGS_DEFAULTS } from "./schema/settingsSchema";
import type { SourceSpec } from "./bases/types";
import type { ReviewResponse } from "./srs/types";

export interface LocalBackendConfig {
  vault: string;
  memory?: string;
}

export type HttpMethod = "GET" | "POST" | "PUT";

/** A change listener (replaces SSE). Fires after any mutating dispatch. */
export type ChangeListener = (evt: { version: number; paths: string[] }) => void;

export function createLocalBackend(cfg: LocalBackendConfig) {
  const { vault, memory } = cfg;
  let version = 0;
  const listeners = new Set<ChangeListener>();

  // Lazy graph cache mirroring the HTTP server's behavior: rebuild on next read
  // after a mutation invalidates it. Tree/rows rebuild per call (cheap enough for
  // a first cut; lazy indexing is a documented follow-up for big vaults).
  let graph: Awaited<ReturnType<typeof buildGraph>> | null = null;

  async function getGraph() {
    if (!graph) graph = await attachLayout(await buildGraph(vault, memory), vault);
    return graph;
  }

  function emit(paths: string[]) {
    version++;
    graph = null; // structural-or-content change: rebuild graph lazily
    for (const cb of listeners) cb({ version, paths });
  }

  const fa = () => getFileAccess();

  /** Read a note, or null if it doesn't exist (parity with the server's exists() guard). */
  async function readOrNull(rel: string): Promise<string | null> {
    try {
      return await (await fa()).readNote(vault, rel);
    } catch {
      return null;
    }
  }

  function notSupported(route: string): never {
    throw new AppError("EINVAL", `${route} is not supported by the in-process backend yet`, 501);
  }

  /** Dispatch an api call (method + path + parsed JSON body) to its handler,
   *  returning the plain data (NOT a Response). Query params are parsed from `path`. */
  async function dispatch(method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    const url = new URL(path, "http://local");
    const route = `${method} ${url.pathname}`;
    const q = (name: string) => url.searchParams.get(name) ?? "";
    const b = (body ?? {}) as Record<string, any>;
    const access = await fa();

    switch (route) {
      // ---- reads ----
      case "GET /version":
        return { version };
      case "GET /graph":
        return getGraph();
      case "GET /graph/views": {
        const g = await getGraph();
        const views = await computeViewLayouts(g, vault);
        g.views = views;
        return views;
      }
      case "GET /tree":
        return access.listTree(vault);
      case "GET /vault-data":
        return buildVaultRows(vault);
      case "GET /agent-graph":
        return { nodes: [], edges: [] }; // no relay on mobile
      case "GET /config":
        return { vault, memory: memory ?? null };
      case "GET /settings":
        // First cut: schema defaults (no settings.yaml reconcile/merge yet — a
        // documented follow-up). The app store seeds from these and stays usable.
        return SETTINGS_DEFAULTS;
      case "GET /schema":
        return { properties: {} };
      case "GET /templates":
        return []; // listTemplates needs a dir walk — follow-up
      case "GET /file": {
        return (await readOrNull(q("path"))) ?? "";
      }
      case "GET /meta": {
        const text = (await readOrNull(q("path"))) ?? "";
        return parseFrontmatter(text).data;
      }
      case "GET /base": {
        const file = q("file");
        const text = await readOrNull(file);
        if (text === null) throw new AppError("ENOENT", "not found", 404);
        return parseBaseFile(text, { name: fileBasename(file), path: file });
      }
      case "GET /tasks":
        return collectVaultTasks(vault);
      case "GET /cards/decks":
        return collectDecks(vault, todayISO());
      case "GET /cards/all":
        return collectCards(vault);
      case "GET /cards/note":
        return noteCards(vault, q("path"));
      case "GET /cards/due":
        return dueCards(vault, todayISO(), url.searchParams.get("deck") ?? undefined);

      // ---- reads via POST (body carries args) ----
      case "POST /rows":
        return resolveSource(b.spec as SourceSpec, { root: vault, today: todayISO() });
      case "POST /search":
        return searchVault(vault, b.query as string, b.opts);

      // ---- content-only writes ----
      case "PUT /file": {
        await access.writeNote(vault, b.path, b.contents);
        emit([b.path]);
        return "ok";
      }
      case "POST /set-property": {
        const raw = await readOrNull(b.path);
        if (raw === null) throw new AppError("ENOENT", "note not found", 404);
        await access.writeNote(vault, b.path, setFrontmatterKey(raw, b.key, b.value));
        emit([b.path]);
        return "ok";
      }
      case "POST /delete-property": {
        const raw = await readOrNull(b.path);
        if (raw === null) throw new AppError("ENOENT", "note not found", 404);
        await access.writeNote(vault, b.path, deleteFrontmatterKey(raw, b.key));
        emit([b.path]);
        return "ok";
      }
      case "POST /row/update": {
        const text = (await readOrNull(b.file)) ?? "";
        const name = fileBasename(b.file);
        await access.writeNote(vault, b.file, upsertRow(text, { name, path: b.file }, b.index ?? null, b.note));
        emit([b.file]);
        return "ok";
      }
      case "POST /row/delete": {
        const text = await readOrNull(b.file);
        if (text === null) throw new AppError("ENOENT", "note not found", 404);
        const name = fileBasename(b.file);
        await access.writeNote(vault, b.file, deleteRow(text, { name, path: b.file }, b.index));
        emit([b.file]);
        return "ok";
      }
      case "POST /row/reorder": {
        const text = await readOrNull(b.file);
        if (text === null) throw new AppError("ENOENT", "note not found", 404);
        const name = fileBasename(b.file);
        await access.writeNote(vault, b.file, reorderRow(text, { name, path: b.file }, b.from, b.to));
        emit([b.file]);
        return "ok";
      }
      case "POST /tasks/toggle": {
        const content = await readOrNull(b.path);
        if (content === null) throw new AppError("ENOENT", "note not found", 404);
        const lines = content.split("\n");
        if (b.line < 0 || b.line >= lines.length) throw new AppError("EINVAL", "line out of range", 400);
        lines[b.line] = toggleTaskLine(lines[b.line], todayISO());
        await access.writeNote(vault, b.path, reorderTaskBlocks(lines.join("\n")));
        emit([b.path]);
        return "ok";
      }
      case "POST /cards/review": {
        if (b.file != null && b.index != null) {
          const text = await readOrNull(b.file);
          if (text === null) throw new AppError("ENOENT", "note not found", 404);
          const name = fileBasename(b.file);
          const { rows } = parseBaseFile(text, { name, path: b.file });
          const row = rows[b.index];
          if (!row) throw new AppError("EINVAL", `row not found: ${b.file}#${b.index}`, 400);
          const note = applyReviewToRow(row.note, b.response as ReviewResponse, todayISO(), DEFAULT_SRS);
          await access.writeNote(vault, b.file, upsertRow(text, { name, path: b.file }, b.index, note));
          emit([b.file]);
          return "ok";
        }
        if (!b.id) throw new AppError("EINVAL", "missing cardId", 400);
        await applyReview(vault, b.id, b.response as ReviewResponse, todayISO(), b.question, DEFAULT_SRS);
        emit([]);
        return "ok";
      }
      case "POST /replace": {
        const result = await replaceInVault(vault, b.query, b.replacement, b.opts, b.scope);
        emit(b.scope && b.scope !== "vault" ? [b.scope] : []);
        return result;
      }

      // ---- structural ops: not in this increment (need FileAccess create/move/
      // delete + a settings.yaml writer + binary asset IO) ----
      case "POST /move":
      case "POST /delete":
      case "POST /restore":
      case "POST /create":
      case "POST /set-setting":
      case "POST /folder-icon":
      case "POST /daily-note":
      case "POST /backup":
      case "POST /open-folder":
        return notSupported(route);

      default:
        throw new AppError("ENOENT", `no in-process handler for ${route}`, 404);
    }
  }

  return {
    dispatch,
    /** Subscribe to change events; returns an unsubscribe fn. */
    subscribe(cb: ChangeListener): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getVersion: () => version,
  };
}

export type LocalBackend = ReturnType<typeof createLocalBackend>;
