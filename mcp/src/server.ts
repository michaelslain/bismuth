import { resolve } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type CallToolRequest,
    type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { listDocs, searchDocs, readDoc } from './docs'
import { SERVER_INSTRUCTIONS } from './instructions'
import { runCli, cliHelp, cliToolResult } from './cli'
import {
    memoryDir,
    remember,
    recall,
    forget,
    MEMORY_UNAVAILABLE,
} from './memory'
import { mcpChannel } from '../../core/src/visibilityCliGate'
import {
    daemonTools,
    daemonEnabled,
    isDaemonTool,
    runDaemonTool,
} from './daemon'

// mcp/src → repo root → docs/. In a machine-wide install the compiled binary lives in
// ~/.bismuth (import.meta.dir is virtual), so the installer sets BISMUTH_DOCS_DIR (→ the staged
// docs) and BISMUTH_CLI (→ the compiled cli binary, consumed in cli.ts).
const repoRoot = resolve(import.meta.dir, '..', '..')
const docsRoot = process.env.BISMUTH_DOCS_DIR ?? repoRoot + '/docs'
// `instructions` reaches the client BEFORE any tool call — see mcp/src/instructions.ts's header
// comment for why the tagging guidance lives there specifically.
export const server = new Server(
    { name: 'bismuth', version: '0.1.0' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
)

// Raw JSON Schema tool definitions. Kept terse on purpose — token-frugal.
const tools = [
    {
        name: 'bismuth_docs_list',
        description:
            'List all Bismuth doc pages (path + title). Start here to discover docs.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'bismuth_docs_search',
        description:
            'Search the Bismuth docs; returns matching {path, heading, snippet} (NOT full text) — cheap. Then read only the page you need.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search terms.' },
                limit: { type: 'number', description: 'Max results.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'bismuth_docs_read',
        description:
            "Read one Bismuth doc page (or a single section). path is relative like 'bases/overview.md'.",
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description:
                        "Doc path relative to docs/, e.g. 'bases/overview.md'.",
                },
                section: {
                    type: 'string',
                    description:
                        'Optional heading to return just that section.',
                },
            },
            required: ['path'],
        },
    },
    {
        name: 'bismuth_doctor',
        description:
            'Check this machine (and a vault) for leftovers from older Bismuth builds, version skew and pending migrations; fix:true repairs. (bismuth doctor)',
        inputSchema: {
            type: 'object',
            properties: {
                fix: {
                    type: 'boolean',
                    description: 'Apply the repairs. Omit to only report.',
                },
                safeOnly: {
                    type: 'boolean',
                    description:
                        'With fix: apply only repairs that cannot lose data.',
                },
                only: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Only these finding ids, e.g. legacy.claude-bot-service.',
                },
                section: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                        'Only these sections: legacy, install, daemon, runtime, vault, backends.',
                },
                vault: {
                    type: 'string',
                    description: 'Vault path to include the vault checks.',
                },
            },
        },
    },
    {
        name: 'bismuth_cli',
        description:
            "Run the bismuth CLI with these args (e.g. ['task','list','--vault','/path']). Returns stdout/stderr/exit code.",
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
    {
        name: 'bismuth_cli_help',
        description:
            "Show the bismuth CLI reference (all commands, or one group like 'task').",
        inputSchema: {
            type: 'object',
            properties: {
                group: {
                    type: 'string',
                    description: "Optional command group, e.g. 'task'.",
                },
            },
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
                        'person | project | workflow | fact | preference | daily | auto',
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
            },
            required: ['name', 'content'],
        },
    },
    {
        name: 'recall',
        description:
            "Search THIS VAULT'S Bismuth memory graph (the '3rd brain'), a store separate from your own native memory (supports tag:, type:, keyword:, link:, after:, before: filters).",
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

// The memory tools AND the daemon-management tools share ONE gate — the daemon being enabled
// for this vault (memoryDir()/daemonEnabled(), i.e. BISMUTH_MEMORY_DIR is injected). Outside a
// daemon-enabled session the server exposes only the always-on six; a machine-wide session
// with no daemon never sees remember/recall/forget nor the crons/processes/pages tools.
/** Every tool this server can ever list — the always-on set plus the daemon-gated memory and
 *  daemon tools. `cli/test/mcpParity.test.ts` checks each against CLI_TWINS (./cliTwins.ts). */
export const ALL_TOOL_NAMES: string[] = [
    ...tools,
    ...memoryTools,
    ...daemonTools,
].map(t => t.name)

/** PURE: the CLI argv a bismuth_doctor call runs. Always `--json`, so the agent gets the full
 *  report (findings, fixed, failed, pending) rather than the terminal table. */
export function doctorCliArgs(a: Record<string, unknown>): string[] {
    const argv = ['doctor', '--json']
    if (a.fix === true) argv.push('--fix')
    if (a.safeOnly === true) argv.push('--safe-only')
    const list = (v: unknown): string | undefined => {
        const items = Array.isArray(v)
            ? v.map(String).filter(x => x.length > 0)
            : []
        return items.length > 0 ? items.join(',') : undefined
    }
    const only = list(a.only)
    if (only) argv.push('--only', only)
    const section = list(a.section)
    if (section) argv.push('--section', section)
    if (typeof a.vault === 'string' && a.vault.length > 0)
        argv.push('--vault', a.vault)
    return argv
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: daemonEnabled() ? [...tools, ...memoryTools, ...daemonTools] : tools,
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
// determines isError — instead of only exercising the helpers (cliToolResult, cliHelp) it calls.
export async function handleCallTool(
    request: CallToolRequest,
): Promise<CallToolResult> {
    const { name, arguments: rawArgs } = request.params
    const args = (rawArgs ?? {}) as Record<string, unknown>
    try {
        switch (name) {
            case 'bismuth_docs_list':
                return textResult(asText(await listDocs(docsRoot)))
            case 'bismuth_docs_search': {
                const query = args.query as string
                const limit =
                    typeof args.limit === 'number' ? args.limit : undefined
                return textResult(
                    asText(await searchDocs(docsRoot, query, limit)),
                )
            }
            case 'bismuth_docs_read': {
                const path = args.path as string
                const section =
                    typeof args.section === 'string' ? args.section : undefined
                return textResult(
                    asText(await readDoc(docsRoot, path, section)),
                )
            }
            case 'bismuth_doctor':
                return cliToolResult(await runCli(repoRoot, doctorCliArgs(args)))
            case 'bismuth_cli': {
                const cliArgs = Array.isArray(args.args)
                    ? (args.args as unknown[]).map(String)
                    : []
                return cliToolResult(await runCli(repoRoot, cliArgs))
            }
            case 'bismuth_cli_help': {
                const group =
                    typeof args.group === 'string' ? args.group : undefined
                const { text, ok } = await cliHelp(repoRoot, group)
                return textResult(text, !ok)
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
                // Daemon-management tools (crons/processes/pages/status/devices/owner) bridge the
                // bismuth CLI. They're only listed when the daemon is enabled; guard the call path too
                // so an out-of-context invocation degrades gracefully instead of hitting "Unknown tool".
                if (isDaemonTool(name)) {
                    if (!daemonEnabled()) {
                        return textResult(
                            'Daemon tools are unavailable — the daemon is not enabled for this vault.',
                            true,
                        )
                    }
                    const { text, isError } = await runDaemonTool(
                        repoRoot,
                        name,
                        args,
                    )
                    return textResult(text, isError)
                }
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
