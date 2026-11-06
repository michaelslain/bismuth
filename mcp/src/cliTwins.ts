// MCP <=> CLI parity table: every tool the MCP server can list, mapped to the `bismuth` CLI phrase
// that does the same thing. The project rule is "the CLI owns every feature; the MCP server is a thin
// adapter over it": `bismuth_cli` reaches every CLI command, and the only named tools are the memory
// tools, each with a CLI twin. `cli/test/mcpParity.test.ts` pins both halves, so a tool added to
// server.ts without an entry here fails a test instead of shipping a capability only one surface
// has. `null` is reserved for `bismuth_cli`, which IS the CLI.
//
// A plain data module (no imports) so the CLI's test can load it without pulling in the server.
export const CLI_TWINS: Record<string, string | null> = {
    bismuth_cli: null,
    // daemon-gated: memory
    remember: 'memory remember',
    recall: 'memory recall',
    forget: 'memory forget',
}

// Argument-level parity. `cli/test/mcpArgParity.test.ts` pairs every input parameter of an MCP tool
// with a flag or positional of its CLI twin (each command declares them in its `args`), both ways.
// A parameter or flag with no partner must be listed here with the reason it is one-sided; an entry
// that no longer names an unpaired parameter or flag fails the test, so this table cannot go stale.
// `TODO(user): …` marks a one-sided argument whose fate is the user's call.
//
// Names pair after dropping `-` and `_` and lowercasing (`safe-only` is `safeOnly`, `deliver-at` is
// `deliver_at`); a command's `args` names the param when the spelling differs (`--off` is `enabled`).
export type ArgException = {
    tool: string | readonly string[]
    reason: string
} & ({ param: string } | { flag: string } | { positional: string })

/** The memory tools: each twin prints through `out(…, args)` and resolves a vault with `--vault`. */
const MEMORY_TOOLS = ['remember', 'recall', 'forget'] as const

export const ARG_EXCEPTIONS: readonly ArgException[] = [
    {
        tool: MEMORY_TOOLS,
        flag: 'pretty',
        reason: 'only sets the JSON indentation for a person reading a terminal; the MCP tool returns its result in the format it chose',
    },
    {
        tool: MEMORY_TOOLS,
        flag: 'vault',
        reason: 'the MCP server acts on the memory graph of the session it serves, so an agent cannot aim a tool at another vault',
    },
    {
        tool: MEMORY_TOOLS,
        flag: 'memory',
        reason: 'the MCP tools always act on the session memory graph (memoryDir()); an arbitrary directory is for owner scripts',
    },
]
