// MCP <=> CLI parity table: every tool the MCP server can list, mapped to the `bismuth` CLI phrase
// that does the same thing. The project rule is "every MCP tool has a CLI twin, and every CLI
// command is reachable from MCP through bismuth_cli" — `cli/test/mcpParity.test.ts` pins both
// halves, so a tool added to server.ts without an entry here fails a test instead of shipping a
// capability only one surface has. `null` is reserved for the two tools that ARE the CLI bridge.
//
// A plain data module (no imports) so the CLI's test can load it without pulling in the server.
export const CLI_TWINS: Record<string, string | null> = {
    // always-on
    bismuth_docs_list: 'docs list',
    bismuth_docs_search: 'docs search',
    bismuth_docs_read: 'docs read',
    bismuth_doctor: 'doctor',
    vault_map: 'map',
    brain: 'brain',
    ocr: 'ocr',
    pdf_to_markdown: 'pdf md',
    bismuth_cli: null,
    bismuth_cli_help: null,
    // daemon-gated: memory
    remember: 'memory remember',
    recall: 'memory recall',
    forget: 'memory forget',
    // daemon-gated: daemon management (the phrases daemonCliArgs in daemon.ts runs)
    daemon_status: 'daemon status',
    daemon_devices: 'daemon devices',
    daemon_owner: 'daemon owner',
    daemon_list: 'daemon graph',
    cron_run: 'daemon cron run',
    cron_toggle: 'daemon cron toggle',
    process_toggle: 'daemon process toggle',
    daemon_logs: 'daemon logs',
    page_list: 'page list',
    page_create: 'page create',
    page_resolve: 'page resolve',
}

// Argument-level parity. `cli/test/mcpArgParity.test.ts` pairs every input parameter of an MCP tool
// with a flag or positional of its CLI twin (each command declares them in its `args`), both ways.
// A parameter or flag with no partner must be listed here with the reason it is one-sided; an entry
// that no longer names an unpaired parameter or flag fails the test, so this table cannot go stale.
// `TODO(user): …` marks a one-sided argument whose fate is the user's call.
//
// Names pair after dropping `-` and `_` and lowercasing (`safe-only` is `safeOnly`, `deliver-at` is
// `deliver_at`); a command's `args` names the param when the spelling differs (`--off` is `enabled`).
export type ArgException = { tool: string | readonly string[]; reason: string } & (
    | { param: string }
    | { flag: string }
    | { positional: string }
)

/** Every twin whose command prints through `out(…, args)`, which is what reads `--pretty`. */
const PRETTY_TOOLS = [
    'bismuth_docs_list',
    'bismuth_docs_search',
    'bismuth_doctor',
    'vault_map',
    'brain',
    'ocr',
    'pdf_to_markdown',
    'remember',
    'recall',
    'forget',
    'daemon_status',
    'daemon_devices',
    'daemon_owner',
    'daemon_list',
    'cron_run',
    'cron_toggle',
    'process_toggle',
    'daemon_logs',
    'page_list',
    'page_create',
    'page_resolve',
] as const

/** Every twin whose command resolves a vault with `--vault` and has no matching param. */
const VAULT_TOOLS = [
    'vault_map',
    'brain',
    'ocr',
    'pdf_to_markdown',
    'remember',
    'recall',
    'forget',
    'daemon_list',
    'cron_run',
    'cron_toggle',
    'process_toggle',
    'daemon_logs',
    'page_list',
    'page_create',
    'page_resolve',
] as const

export const ARG_EXCEPTIONS: readonly ArgException[] = [
    {
        tool: PRETTY_TOOLS,
        flag: 'pretty',
        reason: 'only sets the JSON indentation for a person reading a terminal; the MCP tool returns its result in the format it chose',
    },
    {
        tool: VAULT_TOOLS,
        flag: 'vault',
        reason: 'the MCP server runs the CLI against the vault of the session it serves, so an agent cannot aim a tool at another vault',
    },
    {
        tool: ['remember', 'recall', 'forget'],
        flag: 'memory',
        reason: 'the MCP tools always act on the session memory graph (memoryDir()); an arbitrary directory is for owner scripts',
    },
    {
        tool: 'vault_map',
        flag: 'api',
        reason: 'picks which running core answers the similar-notes query; the MCP-spawned CLI finds it from BISMUTH_API or the run registry',
    },
    {
        tool: 'vault_map',
        flag: 'json',
        reason: 'output format: the MCP tool returns the markdown map an agent reads, --json is the same data for scripts',
    },
    {
        tool: 'bismuth_doctor',
        flag: 'json',
        reason: 'output format: doctorCliArgs always passes --json so the agent gets the full report, never the terminal table',
    },
    {
        tool: 'bismuth_docs_read',
        param: 'full',
        reason: 'the CLI never caps a page (it prints the whole page unless --section is given), so full is already its only behaviour',
    },
]
