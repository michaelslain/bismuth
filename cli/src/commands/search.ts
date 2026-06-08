// Search + replace command group for the `bismuth` CLI.
// Wraps core's searchVault (ranked full-text search) and replaceInVault
// (vault-wide find-and-replace). Mutating commands call core directly — the
// app's file watcher picks up the writes live.
import type { CommandMap } from "../types";
import { bool, out, positionals, requireVault } from "../args";
import { searchVault, type SearchOpts } from "../../../core/src/search";
import { replaceInVault } from "../../../core/src/replace";

/** Build SearchOpts from the shared --regex/--case/--word boolean flags. */
function buildOpts(args: string[]): SearchOpts {
  return {
    regex: bool(args, "regex"),
    caseSensitive: bool(args, "case"),
    wholeWord: bool(args, "word"),
  };
}

export const commands: CommandMap = {
  search: {
    summary: "Search the vault for a query (ranked, with match snippets)",
    usage: "<query> [--regex] [--case] [--word]",
    run: async (args) => {
      const vault = requireVault(args);
      const [query] = positionals(args);
      const results = await searchVault(vault, query ?? "", buildOpts(args));
      out(results, args);
    },
  },
  replace: {
    summary: "Replace a query with a replacement across the whole vault",
    usage: "<query> <replacement> [--regex] [--case] [--word]",
    run: async (args) => {
      const vault = requireVault(args);
      const [query, replacement] = positionals(args);
      const result = await replaceInVault(vault, query ?? "", replacement ?? "", buildOpts(args), "vault");
      out(result, args);
    },
  },
};
