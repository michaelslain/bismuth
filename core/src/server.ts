import { join } from "node:path";
import { watch } from "node:fs";
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

  // Debounce timer handle
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function invalidate() {
    cachedGraph = null;
    cachedTree = null;
    cachedRows = null;
    version++;
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

  // ── HTTP server ────────────────────────────────────────────────────────────
  return Bun.serve({
    port: cfg.port ?? 4321,
    async fetch(req) {
      const url = new URL(req.url);
      const cors = CORS;
      if (req.method === "OPTIONS") return new Response(null, { headers: cors });

      // Run a mutating file op: invalidate the cache on success; turn any thrown error
      // (e.g. the path-escape guard) into a 400 with the message as the body.
      function mutate(run: () => Response): Response {
        try {
          const res = run();
          invalidate();
          return res;
        } catch (e) {
          return new Response((e as Error).message, { status: 400, headers: cors });
        }
      }

      if (url.pathname === "/graph" && req.method === "GET") {
        if (cachedGraph === null) {
          // Attach a precomputed layout so the client renders positions directly instead of running
          // the force settle on its main thread. Cached by graph signature (see layout-cache.ts).
          cachedGraph = attachLayout(await buildGraph(cfg.vault, cfg.memory), cfg.vault);
        }
        return Response.json(cachedGraph, { headers: cors });
      }
      if (url.pathname === "/version" && req.method === "GET") {
        return Response.json({ version }, { headers: cors });
      }
      if (url.pathname === "/tree" && req.method === "GET") {
        if (cachedTree === null) cachedTree = await listTree(cfg.vault);
        return Response.json(cachedTree, { headers: cors });
      }
      if (url.pathname === "/vault-data" && req.method === "GET") {
        if (cachedRows === null) cachedRows = await buildVaultRows(cfg.vault);
        return Response.json(cachedRows, { headers: cors });
      }
      if (url.pathname === "/file" && req.method === "GET") {
        const path = url.searchParams.get("path");
        if (!path) return new Response("missing ?path=", { status: 400, headers: cors });
        const noteText = await readNoteOrEmpty(cfg.vault, path);
        return new Response(noteText, { status: 200, headers: cors });
      }
      if (url.pathname === "/file" && req.method === "PUT") {
        const { path, contents } = (await req.json()) as { path: string; contents: string };
        await writeNote(cfg.vault, path, contents);
        return new Response("ok", { headers: cors });
      }
      if (url.pathname === "/move" && req.method === "POST") {
        const { from, to } = (await req.json()) as { from: string; to: string };
        return mutate(() => {
          moveEntry(cfg.vault, from, to);
          return new Response("ok", { headers: cors });
        });
      }
      if (url.pathname === "/delete" && req.method === "POST") {
        const { path } = (await req.json()) as { path: string };
        return mutate(() => Response.json(deleteEntry(cfg.vault, path), { headers: cors }));
      }
      if (url.pathname === "/restore" && req.method === "POST") {
        const { trashPath, to } = (await req.json()) as { trashPath: string; to: string };
        return mutate(() => {
          moveEntry(cfg.vault, trashPath, to);
          return new Response("ok", { headers: cors });
        });
      }
      if (url.pathname === "/create" && req.method === "POST") {
        const { path, kind } = (await req.json()) as { path: string; kind: "file" | "dir" };
        return mutate(() => {
          createEntry(cfg.vault, path, kind);
          return new Response("ok", { headers: cors });
        });
      }
      if (url.pathname === "/set-property" && req.method === "POST") {
        // Used by the Bases kanban drag-drop: flip a single frontmatter key on a note.
        const { path, key, value } = (await req.json()) as { path: string; key: string; value: unknown };
        try {
          // Refuse to write to a path that doesn't exist — silently creating notes
          // (which readNoteOrEmpty + writeNote would do) hides mistakes from callers.
          const raw = await readNoteOrEmpty(cfg.vault, path);
          if (raw === "" && !(await Bun.file(join(cfg.vault, path)).exists())) {
            return new Response("note not found", { status: 404, headers: cors });
          }
          const next = setFrontmatterKey(raw, key, value);
          await writeNote(cfg.vault, path, next);
        } catch (e) {
          // e.g. the path-escape guard in resolveInVault — surface as a 400 like mutate() does.
          return new Response((e as Error).message, { status: 400, headers: cors });
        }
        return mutate(() => new Response("ok", { headers: cors }));
      }
      if (url.pathname === "/backup" && req.method === "POST") {
        const committed = await commitVault(cfg.vault, snapshotMessage());
        return Response.json({ committed }, { headers: cors });
      }
      if (url.pathname === "/meta" && req.method === "GET") {
        const path = url.searchParams.get("path");
        if (!path) return new Response("missing ?path=", { status: 400, headers: cors });
        const noteText = await readNoteOrEmpty(cfg.vault, path);
        const { data } = parseFrontmatter(noteText);
        return Response.json(data, { headers: cors });
      }
      if (url.pathname === "/agent-graph" && req.method === "GET") {
        return Response.json(buildAgentGraph(), { headers: cors });
      }
      if (url.pathname === "/tasks" && req.method === "GET") {
        return Response.json(await collectVaultTasks(cfg.vault), { headers: cors });
      }
      if (url.pathname === "/tasks/toggle" && req.method === "POST") {
        const { path, line } = (await req.json()) as { path: string; line: number };
        const content = await readNote(cfg.vault, path);
        const lines = content.split("\n");
        if (line < 0 || line >= lines.length) {
          return new Response("line out of range", { status: 400, headers: cors });
        }
        try {
          lines[line] = toggleTaskLine(lines[line], todayISO());
        } catch (e) {
          return new Response((e as Error).message, { status: 400, headers: cors });
        }
        await writeNote(cfg.vault, path, lines.join("\n"));
        invalidate();
        return new Response("ok", { headers: cors });
      }
      if (url.pathname === "/config" && req.method === "GET") {
        // Read-only view of how core was launched — surfaced in the settings page.
        return Response.json({ vault: cfg.vault, memory: cfg.memory ?? null }, { headers: cors });
      }
      if (url.pathname === "/cards/decks" && req.method === "GET") {
        return Response.json(await collectDecks(cfg.vault, todayISO()), { headers: cors });
      }
      if (url.pathname === "/cards/all" && req.method === "GET") {
        return Response.json(await collectCards(cfg.vault), { headers: cors });
      }
      if (url.pathname === "/cards/note" && req.method === "GET") {
        const path = url.searchParams.get("path");
        if (!path) return new Response("missing ?path=", { status: 400, headers: cors });
        return Response.json(await noteCards(cfg.vault, path), { headers: cors });
      }
      if (url.pathname === "/cards/due" && req.method === "GET") {
        const deck = url.searchParams.get("deck") ?? undefined;
        return Response.json(await dueCards(cfg.vault, todayISO(), deck), { headers: cors });
      }
      if (url.pathname === "/cards/review" && req.method === "POST") {
        const { id, response, question } = (await req.json()) as { id: string; response: ReviewResponse; question?: string };
        try {
          await applyReview(cfg.vault, id, response, todayISO(), question);
        } catch (e) {
          return new Response((e as Error).message, { status: 400, headers: cors });
        }
        invalidate();
        return new Response("ok", { headers: cors });
      }
      return new Response("not found", { status: 404, headers: cors });
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
