import { join } from "node:path";
import { watch } from "node:fs";
import { buildGraph } from "./engine";
import { attachLayout } from "./layout-cache";
import { listMarkdown, readNote, writeNote } from "./files";
import { commitVault } from "./backup";
import { parseFrontmatter } from "./frontmatter";
import { buildAgentGraph } from "./agents";
import type { GraphData } from "./graph";

export interface CoreConfig { vault: string; memory?: string; port?: number }

export function createServer(cfg: CoreConfig) {
  // ── In-memory cache ────────────────────────────────────────────────────────
  let cachedGraph: GraphData | null = null;
  let version = 0;

  // Debounce timer handle
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function invalidate() {
    cachedGraph = null;
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
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
      if (req.method === "OPTIONS") return new Response(null, { headers: cors });

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
        return Response.json(await listMarkdown(cfg.vault), { headers: cors });
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
      if (url.pathname === "/backup" && req.method === "POST") {
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        const committed = await commitVault(cfg.vault, `vault snapshot ${stamp}`);
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
      if (url.pathname === "/config" && req.method === "GET") {
        // Read-only view of how core was launched — surfaced in the settings page.
        return Response.json({ vault: cfg.vault, memory: cfg.memory ?? null }, { headers: cors });
      }
      return new Response("not found", { status: 404, headers: cors });
    },
  });
}

if (import.meta.main) {
  const arg = (k: string) => { const i = Bun.argv.indexOf(`--${k}`); return i >= 0 ? Bun.argv[i + 1] : undefined; };
  const portArg = arg("port");
  const s = createServer({
    vault: arg("vault") ?? "test/fixtures/sample-vault",
    memory: arg("memory"),
    port: portArg ? Number(portArg) : 4321,
  });
  console.log(`core listening on http://localhost:${s.port}`);
}
