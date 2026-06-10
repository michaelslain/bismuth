// Checkpoint command group for the `bismuth` CLI.
// A checkpoint is a lightweight git ref (refs/bismuth/<name>) marking how far a periodic
// consumer has processed a repo's autosave history — so background jobs only handle "what
// changed since I last ran" instead of re-scanning everything. Generic over any tracked
// dir: vault-review → the vault repo, the dream cron → the memory repo. Headless (no server).
//
//   bismuth checkpoint diff dream --dir ~/.claude-bot/memory      # changed files since last dream
//   …process the delta…
//   bismuth checkpoint advance dream --dir ~/.claude-bot/memory   # move the bookmark to HEAD
import type { CommandMap } from "../types";
import { flag, bool, positionals, out, fail } from "../args";
import {
  checkpointDelta,
  advanceCheckpoint,
  checkpointRef,
  snapshotMessage,
} from "../../../core/src/backup";

/** The repo to operate on: --dir wins, then --vault, then OA_VAULT. */
function repoDir(args: string[]): string {
  const d = flag(args, "dir") ?? flag(args, "vault") ?? process.env.OA_VAULT;
  if (!d) fail("no dir — pass --dir <path> (the vault or memory repo)");
  return d;
}

function refName(args: string[], cmd: string): string {
  const ref = positionals(args)[0];
  if (!ref) fail(`usage: checkpoint ${cmd} <ref> --dir <path>`);
  return ref;
}

// Commit pending changes before the op unless --no-commit (so the delta/advance reflects
// the latest on-disk state even when nothing else is autosaving the repo).
const commitMsg = (args: string[]): string | undefined =>
  bool(args, "no-commit") ? undefined : snapshotMessage(new Date(), "checkpoint");

export const commands: CommandMap = {
  "checkpoint diff": {
    summary: "List files changed in a repo since a checkpoint ref (refs/bismuth/<ref>)",
    usage: "<ref> --dir <path> [--no-commit]",
    run: async (args) => {
      out(await checkpointDelta(repoDir(args), refName(args, "diff"), commitMsg(args)), args);
    },
  },
  "checkpoint advance": {
    summary: "Advance a checkpoint ref to HEAD (after processing its delta)",
    usage: "<ref> --dir <path> [--no-commit]",
    run: async (args) => {
      const ref = refName(args, "advance");
      const head = await advanceCheckpoint(repoDir(args), ref, commitMsg(args));
      out({ ref, head }, args);
    },
  },
  "checkpoint ref": {
    summary: "Print a checkpoint ref's current SHA (null if unset)",
    usage: "<ref> --dir <path>",
    run: async (args) => {
      const ref = refName(args, "ref");
      out({ ref, sha: await checkpointRef(repoDir(args), ref) }, args);
    },
  },
};
