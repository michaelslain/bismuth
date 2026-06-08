// `bismuth` CLI entry point. Merges every command group (cli/src/commands/*.ts)
// into one registry and dispatches by longest-match: it tries a two-word command
// phrase ("task toggle") first, then a one-word command ("graph"). Each group is a
// thin wrapper over `@oa/core` functions — no running server required for the
// file-based commands (the app's vault watcher picks up writes live).
import type { CommandMap } from "./types";
import { commands as fileCmds } from "./commands/file";
import { commands as noteCmds } from "./commands/note";
import { commands as searchCmds } from "./commands/search";
import { commands as graphCmds } from "./commands/graph";
import { commands as taskCmds } from "./commands/task";
import { commands as baseCmds } from "./commands/base";
import { commands as cardCmds } from "./commands/card";
import { commands as propCmds } from "./commands/prop";
import { commands as settingsCmds } from "./commands/settings";
import { commands as daemonCmds } from "./commands/daemon";
import { commands as drawCmds } from "./commands/draw";
import { commands as serveCmds } from "./commands/serve";
import { commands as exportCmds } from "./commands/export";
import { commands as apiCmds } from "./commands/api";
import { commands as installCmds } from "./commands/install";

const registry: CommandMap = {
  ...fileCmds, ...noteCmds, ...searchCmds, ...graphCmds, ...taskCmds, ...baseCmds,
  ...cardCmds, ...propCmds, ...settingsCmds, ...daemonCmds, ...drawCmds, ...serveCmds,
  ...exportCmds, ...apiCmds, ...installCmds,
};

function printHelp(): void {
  console.log("bismuth — control every aspect of a Bismuth vault from the shell\n");
  console.log("usage: bismuth <command> [args] [--vault <dir>] [--memory <dir>] [--pretty]\n");
  const keys = Object.keys(registry).sort();
  const width = Math.max(...keys.map((k) => k.length));
  for (const k of keys) {
    const c = registry[k];
    const usage = c.usage ? ` ${c.usage}` : "";
    console.log(`  ${k.padEnd(width)}  ${c.summary}${usage}`);
  }
  console.log("\nmost commands need a vault: pass --vault <dir> or set OA_VAULT.");
}

const argv = Bun.argv.slice(2);

if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
  printHelp();
  process.exit(0);
}

// Longest-match dispatch: prefer a two-word phrase, then a single word.
const two = argv.length >= 2 ? `${argv[0]} ${argv[1]}` : null;
let cmdKey: string | null = null;
let rest: string[] = [];
if (two && registry[two]) {
  cmdKey = two;
  rest = argv.slice(2);
} else if (registry[argv[0]]) {
  cmdKey = argv[0];
  rest = argv.slice(1);
}

if (!cmdKey) {
  console.error(`unknown command: ${argv.slice(0, 2).join(" ")}\n`);
  printHelp();
  process.exit(1);
}

try {
  await registry[cmdKey].run(rest);
} catch (e) {
  console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
