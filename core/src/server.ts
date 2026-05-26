import { join } from "node:path";
import { buildGraph } from "./engine";
import { listMarkdown, readNote, writeNote } from "./files";
import { commitVault } from "./backup";
import { parseFrontmatter } from "./frontmatter";
import { buildAgentGraph } from "./agents";

export interface CoreConfig { vault: string; memory?: string; port?: number }

export function createServer(cfg: CoreConfig) {
  return Bun.serve({
    port: cfg.port ?? 4321,
    async fetch(req) {
      const url = new URL(req.url);
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
      if (req.method === "OPTIONS") return new Response(null, { headers: cors });

      if (url.pathname === "/graph" && req.method === "GET") {
        const g = await buildGraph(cfg.vault, cfg.memory);
        return Response.json(g, { headers: cors });
      }
      if (url.pathname === "/tree" && req.method === "GET") {
        return Response.json(await listMarkdown(cfg.vault), { headers: cors });
      }
      if (url.pathname === "/file" && req.method === "GET") {
        const path = url.searchParams.get("path");
        if (!path) return new Response("missing ?path=", { status: 400, headers: cors });
        const fullPath = join(cfg.vault, path);
        const exists = await Bun.file(fullPath).exists();
        if (!exists) return new Response("", { status: 200, headers: cors });
        return new Response(await readNote(cfg.vault, path), { headers: cors });
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
        const metaFullPath = join(cfg.vault, path);
        const metaExists = await Bun.file(metaFullPath).exists();
        const noteText = metaExists ? await readNote(cfg.vault, path) : "";
        const { data } = parseFrontmatter(noteText);
        return Response.json(data, { headers: cors });
      }
      if (url.pathname === "/agent-graph" && req.method === "GET") {
        return Response.json(buildAgentGraph(), { headers: cors });
      }
      return new Response("not found", { status: 404, headers: cors });
    },
  });
}

if (import.meta.main) {
  const arg = (k: string) => { const i = Bun.argv.indexOf(`--${k}`); return i >= 0 ? Bun.argv[i + 1] : undefined; };
  const s = createServer({
    vault: arg("vault") ?? "sample-vault",
    memory: arg("memory"),
    port: arg("port") ? Number(arg("port")) : 4321,
  });
  console.log(`core listening on http://localhost:${s.port}`);
}
