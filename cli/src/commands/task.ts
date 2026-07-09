// Task command group for the `bismuth` CLI.
// Wraps core's task extraction (collectVaultTasks), the Tasks-query DSL
// (runTaskQuery), and the in-place line toggler (toggleTaskLine). The toggle
// command mutates a vault file directly — the app's file watcher picks up the
// write live — mirroring server.ts's POST /tasks/toggle handler.
import type { CommandMap } from "../types";
import { fail, flag, out, positionals, requireVault, today } from "../args";
import { collectVaultTasks, toggleTaskLine } from "../../../core/src/tasks";
import { reorderTaskBlocks } from "../../../core/src/taskReorder";
import { runTaskQuery } from "../../../core/src/tasks-query";
import { readNote, writeNote } from "../../../core/src/files";

export const commands: CommandMap = {
  "task list": {
    summary: "List all checkbox tasks in the vault (optionally filtered by a Tasks-query DSL)",
    usage: "[--query <dsl>]",
    run: async (args) => {
      const vault = requireVault(args);
      const tasks = await collectVaultTasks(vault);
      const query = flag(args, "query");
      if (query !== undefined) {
        out(runTaskQuery(tasks, query, today()), args);
      } else {
        out(tasks, args);
      }
    },
  },
  "task toggle": {
    summary: "Toggle a task's done state at <file>:<line> (1-based line number)",
    usage: "<file> <line>",
    run: async (args) => {
      const vault = requireVault(args);
      const [file, lineStr] = positionals(args);
      if (!file || lineStr === undefined) fail("usage: task toggle <file> <line>");
      const line = Number(lineStr);
      if (!Number.isInteger(line) || line < 1) fail(`invalid line number: ${lineStr}`);
      const content = await readNote(vault, file);
      // Mirror POST /tasks/toggle: split on "\n", toggle the target line in place.
      // toggleTaskLine may return TWO lines (recurrence inserts the next occurrence
      // above the completed one); splicing into one slot preserves order after join.
      const lines = content.split("\n");
      const idx = line - 1; // 1-based → 0-based
      if (idx < 0 || idx >= lines.length) fail("line out of range");
      lines[idx] = toggleTaskLine(lines[idx], today());
      await writeNote(vault, file, reorderTaskBlocks(lines.join("\n")));
      out("ok", args);
    },
  },
};
