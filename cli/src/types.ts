// Shared command contract for the `bismuth` CLI. Each command group module
// (cli/src/commands/*.ts) exports a `Record<string, Command>` keyed by the full
// command string ("task toggle", "graph", "row add", …). index.ts merges them
// into one registry and dispatches by longest-match (two words, then one).

/** One flag a command accepts, as the MCP parity audit sees it. A bare kind is enough when the MCP
 *  param has the same name (`safe-only` pairs with `safeOnly`, `deliver-at` with `deliver_at`); the
 *  object form names a differently-spelled param (`--off` is the inverse of the boolean `enabled`). */
export type FlagDecl = 'value' | 'bool' | { kind: 'value' | 'bool'; param: string }

/** The arguments a command takes, declared for the MCP parity audit (`cli/test/mcpArgParity.test.ts`).
 *  The audit pairs each entry with a parameter of the command's MCP twin, and a scan of `run` fails
 *  when the body reads a flag that is not declared here, or this declares one the body never reads. */
export interface CommandArgs {
    /** The MCP param each positional carries, in order. */
    positionals?: string[]
    /** Every `--flag` the command reads, directly or through a shared helper such as `requireVault`. */
    flags?: Record<string, FlagDecl>
}

export interface Command {
    /** One-line description shown in `bismuth --help`. */
    summary: string
    /** Optional usage hint shown on bad input, e.g. "<file> <line>". */
    usage?: string
    /** Required on a command with an MCP twin (`CLI_TWINS`); see `CommandArgs`. */
    args?: CommandArgs
    /** Run the command. `args` is argv after the command word(s) are stripped. */
    run: (args: string[]) => Promise<void> | void
}

/** A group module's export shape: command-string → Command. */
export type CommandMap = Record<string, Command>
