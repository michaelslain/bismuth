import { join } from "node:path";
import { watch } from "node:fs";
import { createSseRegistry } from "./sse";
import { buildGraph } from "./engine";
import { attachLayout } from "./layout-cache";
import { listTree, readNote, writeNote, moveEntry, deleteEntry, createEntry } from "./files";
import { commitVault, snapshotMessage } from "./backup";
import { parseFrontmatter, setFrontmatterKey } from "./frontmatter";
import { buildAgentGraph } from "./agents";
import { buildVaultRows } from "./basesData";
import type { GraphData, TreeEntry } from "./graph";
import { collectVaultTasks, toggleTaskLine } from "./tasks";
import { todayISO } from "./dates";
import { collectDecks, dueCards, collectCards, noteCards, applyReview } from "./srs/cards";
import type { ReviewResponse } from "./srs/types";
import type { Row } from "./bases/types";

export interface CoreConfig { vault: string; memory?: string; port?: number }

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

/** Read a `--flag value` pair from the process argv (shared by the core + cli launchers). */
export function cliArg(name: string): string | undefined {
  const i = Bun.argv.indexOf(`--${name}`);
  return i >= 0 ? Bun.argv[i + 1] : undefined;
}

/** Attach CORS headers to a response. */
function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

/** Extract a required query parameter. */
function requireQueryParam(url: URL, param: string): string {
  const value = url.searchParams.get(param);
  if (!value) throw new Error(`missing ?${param}=`);
  return value;
}

/** Request handler type. */
type Handler = (req: Request, url: URL, cfg: CoreConfig) => Promise<Response> | Response;

export function createServer(cfg: CoreConfig) {
  // ── In-memory cache ────────────────────────────────────────────────────────
  let cachedGraph: GraphData | null = null;
  // The sidebar polls /tree every few seconds; cache it (with the per-note icon read) so we
  // don't re-read every file on each poll. Invalidated alongside the graph on file changes.
  let cachedTree: TreeEntry[] | null = null;
  // One Row per note (file.* meta + frontmatter), served to the Bases query engine via /vault-data.
  // Cached and invalidated alongside the graph/tree on file changes.
  let cachedRows: Row[] | null = null;
  let version = 0;
  const sse = createSseRegistry();

  // Debounce timer handle
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function invalidate() {
    cachedGraph = null;
    cachedTree = null;
    cachedRows = null;
    version++;
    sse.publish({ version });
  }

  function scheduleInvalidate() {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      invalidate();
    }, 250);
  }

  // ── File helper ────────────────────────────────────────────────────────────
  async function readNoteOrEmpty(vault: string, path: string): Promise<string> {
    const fullPath = join(vault, path);
    const exists = await Bun.file(fullPath).exists();
    return exists ? await readNote(vault, path) : "";
  }

  // ── File-system watchers ───────────────────────────────────────────────────
  try {
    watch(cfg.vault, { recursive: true }, () => scheduleInvalidate());
  } catch {
    // vault dir may not exist in test / CI environments
  }
  if (cfg.memory) {
    try {
      watch(cfg.memory, { recursive: true }, () => scheduleInvalidate());
    } catch {
      // memory dir may be absent
    }
  }

  // ── Route handlers (read-only) ──────────────────────────────────────────────

  const routes: Record<string, Handler> = {
    "GET /version": async (_, __) => {
      return Response.json({ version });
    },

    "GET /events": (_, __) => {
      // SSE stream of cache-invalidation events. One frame per `invalidate()`.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sse.subscribe(controller);
          // Send an immediate snapshot so a fresh client knows the current version
          // without waiting for the next invalidation. Skip version 0 (initial
          // state before any invalidation has occurred).
          if (version > 0) {
            controller.enqueue(new TextEncoder().encode(`data: {"version":${version}}\n\n`));
          }
        },
        cancel(controller) {
          sse.unsubscribe(controller);
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
      if (cachedGraph === null) {
        // Attach a precomputed layout so the client renders positions directly instead of running
        // the force settle on its main thread. Cached by graph signature (see layout-cache.ts).
        cachedGraph = attachLayout(await buildGraph(cfg.vault, cfg.memory), cfg.vault);
      }
      return Response.json(cachedGraph);
    },

    "GET /tree": async (_, __) => {
      if (cachedTree === null) cachedTree = await listTree(cfg.vault);
      return Response.json(cachedTree);
    },

    "GET /vault-data": async (_, __) => {
      if (cachedRows === null) cachedRows = await buildVaultRows(cfg.vault);
      return Response.json(cachedRows);
    },

    "GET /file": async (_, url) => {
      const path = requireQueryParam(url, "path");
      const noteText = await readNoteOrEmpty(cfg.vault, path);
      return new Response(noteText, { status: 200 });
    },

    "PUT /file": async (req, __) => {
      const { path, contents } = (await req.json()) as { path: string; contents: string };
      await writeNote(cfg.vault, path, contents);
      return new Response("ok");
    },

    "GET /meta": async (_, url) => {
      const path = requireQueryParam(url, "path");
      const noteText = await readNoteOrEmpty(cfg.vault, path);
      const { data } = parseFrontmatter(noteText);
      return Response.json(data);
    },

    "GET /config": async (_, __) => {
      // Read-only view of how core was launched — surfaced in the settings page.
      return Response.json({ vault: cfg.vault, memory: cfg.memory ?? null });
    },

    "GET /agent-graph": async (_, __) => {
      return Response.json(buildAgentGraph());
    },

    "GET /tasks": async (_, __) => {
      return Response.json(await collectVaultTasks(cfg.vault));
    },

    "POST /backup": async (_, __) => {
      const committed = await commitVault(cfg.vault, snapshotMessage());
      return Response.json({ committed });
    },

    "GET /cards/decks": async (_, __) => {
      return Response.json(await collectDecks(cfg.vault, todayISO()));
    },

    "GET /cards/all": async (_, __) => {
      return Response.json(await collectCards(cfg.vault));
    },

    "GET /cards/note": async (_, url) => {
      const path = requireQueryParam(url, "path");
      return Response.json(await noteCards(cfg.vault, path));
    },

    "GET /cards/due": async (_, url) => {
      const deck = url.searchParams.get("deck") ?? undefined;
      return Response.json(await dueCards(cfg.vault, todayISO(), deck));
    },
  };

  // ── Route handlers (mutating) ───────────────────────────────────────────────
  // These return a handler that automatically invalidates the cache and wraps errors.

  function mutatingHandler(run: (req: Request, url: URL) => Promise<Response> | Response): Handler {
    return async (req, url) => {
      try {
        const res = await run(req, url);
        invalidate();
        return res;
      } catch (e) {
        throw new Error((e as Error).message);
      }
    };
  }

  const mutatingRoutes: Record<string, Handler> = {
    "POST /move": mutatingHandler(async (req) => {
      const { from, to } = (await req.json()) as { from: string; to: string };
      moveEntry(cfg.vault, from, to);
      return new Response("ok");
    }),

    "POST /delete": mutatingHandler(async (req) => {
      const { path } = (await req.json()) as { path: string };
      return Response.json(deleteEntry(cfg.vault, path));
    }),

    "POST /restore": mutatingHandler(async (req) => {
      const { trashPath, to } = (await req.json()) as { trashPath: string; to: string };
      moveEntry(cfg.vault, trashPath, to);
      return new Response("ok");
    }),

    "POST /create": mutatingHandler(async (req) => {
      const { path, kind } = (await req.json()) as { path: string; kind: "file" | "dir" };
      createEntry(cfg.vault, path, kind);
      return new Response("ok");
    }),

    "POST /set-property": mutatingHandler(async (req) => {
      // Used by the Bases kanban drag-drop: flip a single frontmatter key on a note.
      const { path, key, value } = (await req.json()) as { path: string; key: string; value: unknown };
      // Refuse to write to a path that doesn't exist — silently creating notes
      // (which readNoteOrEmpty + writeNote would do) hides mistakes from callers.
      const raw = await readNoteOrEmpty(cfg.vault, path);
      if (raw === "" && !(await Bun.file(join(cfg.vault, path)).exists())) {
        return new Response("note not found", { status: 404 });
      }
      const next = setFrontmatterKey(raw, key, value);
      await writeNote(cfg.vault, path, next);
      return new Response("ok");
    }),

    "POST /tasks/toggle": mutatingHandler(async (req) => {
      const { path, line } = (await req.json()) as { path: string; line: number };
      const content = await readNote(cfg.vault, path);
      const lines = content.split("\n");
      if (line < 0 || line >= lines.length) {
        throw new Error("line out of range");
      }
      lines[line] = toggleTaskLine(lines[line], todayISO());
      await writeNote(cfg.vault, path, lines.join("\n"));
      return new Response("ok");
    }),

    "POST /cards/review": mutatingHandler(async (req) => {
      const { id, response, question } = (await req.json()) as { id: string; response: ReviewResponse; question?: string };
      await applyReview(cfg.vault, id, response, todayISO(), question);
      return new Response("ok");
    }),
  };

  // ── HTTP server ────────────────────────────────────────────────────────────
  return Bun.serve({
    port: cfg.port ?? 4321,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return withCors(new Response(null));

      const route = `${req.method} ${url.pathname}`;
      const handler = routes[route] ?? mutatingRoutes[route];

      if (!handler) {
        return withCors(new Response("not found", { status: 404 }));
      }

      try {
        const res = await handler(req, url, cfg);
        return withCors(res);
      } catch (e) {
        return withCors(new Response((e as Error).message, { status: 400 }));
      }
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
