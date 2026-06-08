import { resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { listDocs, searchDocs, readDoc } from "./docs";
import { runCli, cliHelp } from "./cli";

// mcp/src → repo root → docs/. In a machine-wide install the compiled binary lives in
// ~/.bismuth (import.meta.dir is virtual), so the installer sets OA_DOCS_DIR (→ the staged
// docs) and OA_BISMUTH_CLI (→ the compiled cli binary, consumed in cli.ts).
const repoRoot = resolve(import.meta.dir, "..", "..");
const docsRoot = process.env.OA_DOCS_DIR ?? repoRoot + "/docs";

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

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

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
        let text = r.stdout ?? "";
        if (r.code !== 0) {
          if (r.stderr) text += (text ? "\n" : "") + r.stderr;
          text += `${text ? "\n" : ""}[exit ${r.code}]`;
        } else if (r.stderr) {
          text += (text ? "\n" : "") + r.stderr;
        }
        return { content: [{ type: "text", text: text || "(no output)" }] };
      }
      case "bismuth_cli_help": {
        const group = typeof args.group === "string" ? args.group : undefined;
        return {
          content: [{ type: "text", text: asText(await cliHelp(repoRoot, group)) }],
        };
      }
      default:
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
