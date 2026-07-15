import { resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { listDocs, searchDocs, readDoc } from "./docs";
import { runCli, cliHelp, formatCliResult } from "./cli";
import { memoryDir, remember, recall, forget } from "./memory";
import { daemonTools, daemonEnabled, isDaemonTool, runDaemonTool } from "./daemon";

// mcp/src → repo root → docs/. In a machine-wide install the compiled binary lives in
// ~/.bismuth (import.meta.dir is virtual), so the installer sets BISMUTH_DOCS_DIR (→ the staged
// docs) and BISMUTH_CLI (→ the compiled cli binary, consumed in cli.ts).
const repoRoot = resolve(import.meta.dir, "..", "..");
const docsRoot = process.env.BISMUTH_DOCS_DIR ?? repoRoot + "/docs";

const server = new Server(
  { name: "bismuth", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// Raw JSON Schema tool definitions. Kept terse on purpose — token-frugal.
const tools = [
  {
    name: "bismuth_docs_list",
    description:
      "List all Bismuth doc pages (path + title). Start here to discover docs.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "bismuth_docs_search",
    description:
      "Search the Bismuth docs; returns matching {path, heading, snippet} (NOT full text) — cheap. Then read only the page you need.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms." },
        limit: { type: "number", description: "Max results." },
      },
      required: ["query"],
    },
  },
  {
    name: "bismuth_docs_read",
    description:
      "Read one Bismuth doc page (or a single section). path is relative like 'bases/overview.md'.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Doc path relative to docs/, e.g. 'bases/overview.md'.",
        },
        section: {
          type: "string",
          description: "Optional heading to return just that section.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "bismuth_cli",
    description:
      "Run the bismuth CLI with these args (e.g. ['task','list','--vault','/path']). Returns stdout/stderr/exit code.",
    inputSchema: {
      type: "object",
      properties: {
        args: {
          type: "array",
          items: { type: "string" },
          description: "CLI arguments.",
        },
      },
      required: ["args"],
    },
  },
  {
    name: "bismuth_cli_help",
    description:
      "Show the bismuth CLI reference (all commands, or one group like 'task').",
    inputSchema: {
      type: "object",
      properties: {
        group: {
          type: "string",
          description: "Optional command group, e.g. 'task'.",
        },
      },
    },
  },
] as const;

// Memory tools are exposed ONLY when the daemon is enabled for this vault — memoryDir()
// (mcp/src/memory.ts) trusts an inherited BISMUTH_MEMORY_DIR (set by core/src/terminal.ts
// for an in-app terminal tab, or the daemon's own session wiring) and otherwise resolves the
// vault itself (BISMUTH_VAULT, else cwd walked up to a `.settings` file) and checks that
// vault's own daemon.enabled — the path a machine-wide `-s user` session (a plain terminal/IDE)
// actually takes. So the bot never even sees remember/recall/forget outside a daemon-enabled
// Bismuth vault.
const memoryTools = [
  {
    name: "remember",
    description: "Save a note to THIS VAULT'S Bismuth memory graph (the '3rd brain') — a store SEPARATE from your own native memory. Overwrites by name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Note name (used as filename)." },
        type: { type: "string", description: "person | project | workflow | fact | preference | daily | auto" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for the note." },
        content: { type: "string", description: "Markdown content (can include [[backlinks]])." },
        folder: { type: "string", description: "Optional single-level subfolder (alphanumeric/dash/underscore). Omit for root." },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "recall",
    description: "Search THIS VAULT'S Bismuth memory graph (the '3rd brain'), a store separate from your own native memory (supports tag:, type:, keyword:, link:, after:, before: filters).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Query, e.g. 'type:person tag:active' or 'auth module'." },
        folder: { type: "string", description: "Optional. Restrict to a single subfolder. Omit to search all." },
      },
      required: ["query"],
    },
  },
  {
    name: "forget",
    description: "Remove a note from THIS VAULT'S Bismuth memory graph (the '3rd brain'), a store separate from your own native memory. Accepts folder-prefixed names (e.g. 'moltbook/foo').",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the note to forget (may be folder-prefixed)." },
      },
      required: ["name"],
    },
  },
] as const;

// The memory tools AND the daemon-management tools share ONE gate — the daemon being enabled
// for this vault (memoryDir()/daemonEnabled(), i.e. BISMUTH_MEMORY_DIR is injected). Outside a
// daemon-enabled session the server exposes only the always-on five; a machine-wide session
// with no daemon never sees remember/recall/forget nor the crons/processes/pages tools.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: daemonEnabled() ? [...tools, ...memoryTools, ...daemonTools] : tools,
}));

function asText(result: unknown): string {
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "bismuth_docs_list":
        return { content: [{ type: "text", text: asText(await listDocs(docsRoot)) }] };
      case "bismuth_docs_search": {
        const query = args.query as string;
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        return {
          content: [
            { type: "text", text: asText(await searchDocs(docsRoot, query, limit)) },
          ],
        };
      }
      case "bismuth_docs_read": {
        const path = args.path as string;
        const section =
          typeof args.section === "string" ? args.section : undefined;
        return {
          content: [
            { type: "text", text: asText(await readDoc(docsRoot, path, section)) },
          ],
        };
      }
      case "bismuth_cli": {
        const cliArgs = Array.isArray(args.args)
          ? (args.args as unknown[]).map(String)
          : [];
        const r = await runCli(repoRoot, cliArgs);
        return { content: [{ type: "text", text: formatCliResult(r) }] };
      }
      case "bismuth_cli_help": {
        const group = typeof args.group === "string" ? args.group : undefined;
        return {
          content: [{ type: "text", text: asText(await cliHelp(repoRoot, group)) }],
        };
      }
      case "remember":
      case "recall":
      case "forget": {
        const dir = memoryDir();
        if (!dir) {
          return {
            content: [{ type: "text", text: "Memory is unavailable — the daemon is not enabled for this vault." }],
            isError: true,
          };
        }
        const result =
          name === "remember"
            ? await remember(args as { name: string; type?: string; tags?: string[]; content: string; folder?: string }, dir)
            : name === "recall"
              ? await recall(args as { query: string; folder?: string }, dir)
              : await forget(args as { name: string }, dir);
        return { content: [{ type: "text", text: asText(result) }] };
      }
      default:
        // Daemon-management tools (crons/processes/pages/status/devices/owner) bridge the
        // bismuth CLI. They're only listed when the daemon is enabled; guard the call path too
        // so an out-of-context invocation degrades gracefully instead of hitting "Unknown tool".
        if (isDaemonTool(name)) {
          if (!daemonEnabled()) {
            return {
              content: [{ type: "text", text: "Daemon tools are unavailable — the daemon is not enabled for this vault." }],
              isError: true,
            };
          }
          const { text, isError } = await runDaemonTool(repoRoot, name, args);
          return { content: [{ type: "text", text }], isError };
        }
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: msg }], isError: true };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[bismuth-mcp] fatal:", err);
  process.exit(1);
});
