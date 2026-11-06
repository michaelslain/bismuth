import { resolve } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type CallToolRequest,
    type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { SERVER_INSTRUCTIONS } from './instructions'
import { runCli, cliToolResult } from './cli'
import {
    memoryDir,
    remember,
    recall,
    forget,
    MEMORY_UNAVAILABLE,
} from './memory'
import { mcpChannel } from '../../core/src/visibilityCliGate'

// The MCP server is a thin adapter over the `bismuth` CLI, which owns every feature: an agent with a
// shell runs `bismuth …` itself, and `bismuth_cli` carries the same argv for a host with no shell.
// Only the memory tools are named tools, because their content is a structured note rather than
// argv. mcp/src → repo root, for the dev-repo CLI fallback; in a machine-wide install the installer
// sets BISMUTH_CLI (→ the compiled cli binary, consumed in cli.ts).
const repoRoot = resolve(import.meta.dir, '..', '..')
// `instructions` reaches the client BEFORE any tool call — see mcp/src/instructions.ts's header
// comment for why the tagging guidance lives there specifically.
export const server = new Server(
    { name: 'bismuth', version: '0.1.0' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
)

// Raw JSON Schema tool definitions. Kept terse on purpose — token-frugal.
const tools = [
    {
        name: 'bismuth_cli',
        description:
            "Run the bismuth CLI, which does everything Bismuth does: one argument per array element, exactly as you would type after `bismuth` in a shell. ['--help'] lists every command, ['task','--help'] one group, ['docs','search','<words>'] and ['docs','read','<page>'] read the docs, ['app','open','notes/x.md'] opens a file as a tab in the running app. The vault is the one your session runs in unless you pass --vault. Returns stdout, stderr and the exit code.",
        inputSchema: {
            type: 'object',
            properties: {
                args: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'CLI arguments.',
                },
            },
            required: ['args'],
        },
    },
] as const

// Memory tools are exposed ONLY when the daemon is enabled for this vault — memoryDir()
// (mcp/src/memory.ts) trusts an inherited BISMUTH_MEMORY_DIR (set by core/src/terminal.ts
// for an in-app terminal tab, or the daemon's own session wiring) and otherwise resolves the
// vault itself (BISMUTH_VAULT, else cwd walked up to a `.settings` file) and checks that
// vault's own daemon.enabled — the path a machine-wide `-s user` session (a plain terminal/IDE)
// actually takes. So the bot never even sees remember/recall/forget outside a daemon-enabled
// Bismuth vault.
const memoryTools = [
    {
        name: 'remember',
        description:
            "Save a note to THIS VAULT'S Bismuth memory graph (the '3rd brain') — a store SEPARATE from your own native memory. Overwrites by name.",
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Note name (used as filename).',
                },
                type: {
                    type: 'string',
                    description:
                        'person | project | workflow | fact | preference | daily | auto | profile | hub',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags for the note.',
                },
                content: {
                    type: 'string',
                    description:
                        'Markdown content (can include [[backlinks]]).',
                },
                folder: {
                    type: 'string',
                    description:
                        'Optional single-level subfolder (alphanumeric/dash/underscore). Omit for root.',
                },
                description: {
                    type: 'string',
                    description:
                        'One line (≤160 chars) saying when this note matters; shown in the always-on memory index at session start. Overwriting without it keeps the existing one.',
                },
            },
            required: ['name', 'content'],
        },
    },
    {
        name: 'recall',
        description:
            "Search THIS VAULT'S Bismuth memory graph (the '3rd brain'), a store separate from your own native memory (supports tag:, type:, keyword:, link:, after:, before: filters). Returns the best matches whole in `notes` and the rest in `more` as name/description/path pointers; read a pointer's path for its full note.",
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description:
                        "Query, e.g. 'type:person tag:active' or 'auth module'.",
                },
                folder: {
                    type: 'string',
                    description:
                        'Optional. Restrict to a single subfolder. Omit to search all.',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'forget',
        description:
            "Remove a note from THIS VAULT'S Bismuth memory graph (the '3rd brain'), a store separate from your own native memory. Accepts folder-prefixed names (e.g. 'moltbook/foo').",
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description:
                        'Name of the note to forget (may be folder-prefixed).',
                },
            },
            required: ['name'],
        },
    },
] as const

/** The slice of a tool definition the parity audits read: its name and its input parameters. */
export type ToolDef = {
    name: string
    inputSchema: {
        required?: readonly string[]
        properties: Record<
            string,
            {
                type?: string
                enum?: readonly string[]
                items?: { type?: string }
            }
        >
    }
}

/** Every tool this server can ever list — `bismuth_cli` plus the daemon-gated memory tools. `cli/test/mcpParity.test.ts` checks each against CLI_TWINS (./cliTwins.ts) and
 *  `cli/test/mcpArgParity.test.ts` checks each one's input parameters against its twin's arguments. */
export const ALL_TOOLS = [...tools, ...memoryTools] as readonly ToolDef[]

export const ALL_TOOL_NAMES: string[] = ALL_TOOLS.map(t => t.name)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: memoryDir() ? [...tools, ...memoryTools] : tools,
}))

function asText(result: unknown): string {
    if (typeof result === 'string') return result
    return JSON.stringify(result, null, 2)
}

/** A one-text-block tool result; `isError` is only present when given. */
function textResult(text: string, isError?: boolean): CallToolResult {
    return isError === undefined
        ? { content: [{ type: 'text', text }] }
        : { content: [{ type: 'text', text }], isError }
}

// The memory tools, keyed by name. Each takes the raw tool args + the resolved memory dir.
const memoryHandlers: Record<
    string,
    (args: Record<string, unknown>, dir: string) => Promise<unknown>
> = {
    remember: (args, dir) =>
        remember(
            args as {
                name: string
                type?: string
                tags?: string[]
                content: string
                folder?: string
                description?: string
            },
            dir,
            { channel: mcpChannel() },
        ),
    recall: (args, dir) =>
        recall(args as { query: string; folder?: string }, dir),
    forget: (args, dir) =>
        forget(args as { name: string }, dir, { channel: mcpChannel() }),
}

// Exported (rather than left as an inline callback) so tests can dispatch a fabricated
// CallToolRequest straight through the real switch/case wiring — the thing that actually
// determines isError — instead of only exercising the helpers (cliToolResult) it calls.
export async function handleCallTool(
    request: CallToolRequest,
): Promise<CallToolResult> {
    const { name, arguments: rawArgs } = request.params
    const args = (rawArgs ?? {}) as Record<string, unknown>
    try {
        switch (name) {
            case 'bismuth_cli': {
                const cliArgs = Array.isArray(args.args)
                    ? (args.args as unknown[]).map(String)
                    : []
                return cliToolResult(await runCli(repoRoot, cliArgs))
            }
            case 'remember':
            case 'recall':
            case 'forget': {
                const dir = memoryDir()
                if (!dir) {
                    return textResult(MEMORY_UNAVAILABLE, true)
                }
                return textResult(asText(await memoryHandlers[name](args, dir)))
            }
            default:
                return textResult(`Unknown tool: ${name}`, true)
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return textResult(msg, true)
    }
}

server.setRequestHandler(CallToolRequestSchema, handleCallTool)

async function main(): Promise<void> {
    const transport = new StdioServerTransport()
    await server.connect(transport)
}

// Only when this module IS the entry point — otherwise importing it (serverInstructions.test.ts
// asserts against the wired `server` instance) attaches a StdioServerTransport to the test
// process's own stdin/stdout (final review). `core/src/server.ts` guards its own `if
// (import.meta.main)` entry point the same way, and is built the same way ONE line down this
// file's own header names it: `app/scripts/build-bismuth-tools.ts` compiles THIS file with `bun
// build --compile mcp/src/server.ts --outfile bismuth-mcp` — the same compiler core/src/server.ts
// already ships through, so `import.meta.main` is a proven-working guard for a compiled binary
// here, not just for `bun run`.
if (import.meta.main) {
    main().catch(err => {
        console.error('[bismuth-mcp] fatal:', err)
        process.exit(1)
    })
}
