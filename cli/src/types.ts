// Shared command contract for the `bismuth` CLI. Each command group module
// (cli/src/commands/*.ts) exports a `Record<string, Command>` keyed by the full
// command string ("task toggle", "graph", "row add", …). index.ts merges them
// into one registry and dispatches by longest-match (two words, then one).

export interface Command {
  /** One-line description shown in `bismuth --help`. */
  summary: string;
  /** Optional usage hint shown on bad input, e.g. "<file> <line>". */
  usage?: string;
  /** Run the command. `args` is argv after the command word(s) are stripped. */
  run: (args: string[]) => Promise<void> | void;
}

/** A group module's export shape: command-string → Command. */
export type CommandMap = Record<string, Command>;
