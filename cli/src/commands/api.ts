// Commands that reach a RUNNING bismuth server, for capabilities that live in the
// server process's memory and therefore can't be computed by a standalone CLI
// process: the relay/agent graph (in-memory registry) and any route you want to
// hit directly. Everything else in the CLI works headlessly without a server; these
// don't. API base: --api <url> → BISMUTH_API/OA_API env → http://localhost:4321.
import type { CommandMap } from "../types";
import { flag, positionals, fail, out } from "../args";

function apiBase(args: string[]): string {
  return flag(args, "api") ?? process.env.BISMUTH_API ?? process.env.OA_API ?? "http://localhost:4321";
}

async function call(base: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return fail(`could not reach a running server at ${base} — start one with \`bismuth serve\` (or pass --api <url>)`);
  }
  const text = await res.text();
  if (!res.ok) fail(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const commands: CommandMap = {
  "agent-graph": {
    summary: "Live agents graph (terminal sessions + subagents) from a running server",
    usage: "[--api <url>]",
    run: async (args) => out(await call(apiBase(args), "GET", "/agent-graph"), args),
  },
  "api": {
    summary: "Call any server route directly (for in-memory/server-only capabilities)",
    usage: "<GET|POST|PUT> <path> [--json '<body>'] [--api <url>]",
    run: async (args) => {
      const [method, path] = positionals(args);
      if (!method || !path) fail("usage: bismuth api <GET|POST|PUT> <path> [--json '<body>']");
      const raw = flag(args, "json");
      const body = raw !== undefined ? JSON.parse(raw) : undefined;
      out(await call(apiBase(args), method.toUpperCase(), path, body), args);
    },
  },
};
