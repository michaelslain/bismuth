// Frontmatter-property command group for the `bismuth` CLI.
// Mirrors core's POST /set-property and /delete-property: read the note, mutate a
// single frontmatter key (preserving YAML formatting), write it back. Mutating
// commands call core directly — the app's file watcher picks up the writes live.
import type { CommandMap } from "../types";
import { out, positionals, requireVault } from "../args";
import { setFrontmatterKey, deleteFrontmatterKey } from "../../../core/src/frontmatter";
import { readNote, writeNote } from "../../../core/src/files";

/** Coerce a CLI string value: try JSON.parse (numbers, booleans, arrays, objects,
 *  quoted strings), fall back to the raw string when it isn't valid JSON. */
function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export const commands: CommandMap = {
  "prop set": {
    summary: "Set a frontmatter property on a note (value parsed as JSON, else raw string)",
    usage: "<file> <key> <value>",
    run: async (args) => {
      const vault = requireVault(args);
      const [file, key, value] = positionals(args);
      const md = await readNote(vault, file);
      const next = setFrontmatterKey(md, key, parseValue(value));
      await writeNote(vault, file, next);
      out({ ok: true }, args);
    },
  },
  "prop delete": {
    summary: "Delete a frontmatter property from a note",
    usage: "<file> <key>",
    run: async (args) => {
      const vault = requireVault(args);
      const [file, key] = positionals(args);
      const md = await readNote(vault, file);
      const next = deleteFrontmatterKey(md, key);
      await writeNote(vault, file, next);
      out({ ok: true }, args);
    },
  },
};
