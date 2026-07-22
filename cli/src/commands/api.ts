// Commands that reach a RUNNING bismuth server, for capabilities that live in the
// server process's memory and therefore can't be computed by a standalone CLI
// process: the relay/agent graph (in-memory registry) and any route you want to
// hit directly. Everything else in the CLI works headlessly without a server; these
// don't. API base: --api <url> → BISMUTH_API env → http://localhost:4321.
import type { CommandMap } from "../types";
import { flag, positionals, fail, out } from "../args";
import { call } from "../http";

function apiBase(args: string[]): string {
  return flag(args, "api") ?? process.env.BISMUTH_API ?? "http://localhost:4321";
}

/** Wording shown when no server is reachable at `base`. */
const unreachable = (base: string) =>
  `could not reach a running server at ${base} — start one with \`bismuth serve\` (or pass --api <url>)`;

export const commands: CommandMap = {
  "agent-graph": {
    summary: "Live agents graph (terminal sessions + subagents) from a running server",
    usage: "[--api <url>]",
    run: async (args) => out(await call(apiBase(args), "GET", "/agent-graph", undefined, unreachable), args),
  },
  "api": {
    summary: "Call any server route directly (for in-memory/server-only capabilities)",
    usage: "<GET|POST|PUT> <path> [--json '<body>'] [--api <url>]",
    run: async (args) => {
      const [method, path] = positionals(args);
      if (!method || !path) fail("usage: bismuth api <GET|POST|PUT> <path> [--json '<body>']");
      const raw = flag(args, "json");
      let body: unknown;
      if (raw !== undefined) {
        try {
          body = JSON.parse(raw);
        } catch {
          fail(`--json is not valid JSON: ${raw}`);
        }
      }
      out(await call(apiBase(args), method.toUpperCase(), path, body, unreachable), args);
    },
  },
};
