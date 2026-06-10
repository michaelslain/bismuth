import type { CommandMap } from "../types";
import { requireVault, flag, positionals, out, fail } from "../args";
import {
  readNote,
  writeNote,
  moveEntry,
  deleteEntry,
  createEntry,
  listTree,
} from "../../../core/src/files";

export const commands: CommandMap = {
  read: {
    summary: "Print a vault note's raw contents",
    usage: "<path> [--vault <dir>]",
    run: async (args) => {
      const vault = requireVault(args);
      const [path] = positionals(args);
      if (!path) fail("read: <path> required");
      out(await readNote(vault, path), args);
    },
  },

  write: {
    summary: "Write a vault note (from --content or stdin)",
    usage: "<path> [--content <text>] [--vault <dir>]",
    run: async (args) => {
      const vault = requireVault(args);
      const [path] = positionals(args);
      if (!path) fail("write: <path> required");
      const content = flag(args, "content") ?? (await Bun.stdin.text());
      await writeNote(vault, path, content);
      out({ ok: true }, args);
    },
  },

  move: {
    summary: "Move/rename a vault entry",
    usage: "<from> <to> [--vault <dir>]",
    run: (args) => {
      const vault = requireVault(args);
      const [from, to] = positionals(args);
      if (!from || !to) fail("move: <from> <to> required");
      moveEntry(vault, from, to);
      out({ ok: true }, args);
    },
  },

  delete: {
    summary: "Move a vault entry to the trash",
    usage: "<path> [--vault <dir>]",
    run: (args) => {
      const vault = requireVault(args);
      const [path] = positionals(args);
      if (!path) fail("delete: <path> required");
      out(deleteEntry(vault, path), args);
    },
  },

  restore: {
    summary: "Restore a trashed entry to a destination path",
    usage: "<trashPath> <to> [--vault <dir>]",
    run: (args) => {
      const vault = requireVault(args);
      const [trashPath, to] = positionals(args);
      if (!trashPath || !to) fail("restore: <trashPath> <to> required");
      moveEntry(vault, trashPath, to);
      out({ ok: true }, args);
    },
  },

  mkdir: {
    summary: "Create a directory in the vault",
    usage: "<path> [--vault <dir>]",
    run: (args) => {
      const vault = requireVault(args);
      const [path] = positionals(args);
      if (!path) fail("mkdir: <path> required");
      createEntry(vault, path, "dir");
      out({ ok: true }, args);
    },
  },

  tree: {
    summary: "List the vault file tree as JSON",
    usage: "[--vault <dir>] [--pretty]",
    run: async (args) => {
      const vault = requireVault(args);
      out(await listTree(vault), args);
    },
  },
};
