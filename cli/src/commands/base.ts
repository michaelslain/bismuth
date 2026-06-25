// Bases + rows command group for the `bismuth` CLI.
// Mirrors core's POST /rows and /row/* handlers: parse a base file's rows,
// resolve a SourceSpec to a uniform Row[], or mutate a base's GFM table rows.
// Mutating commands call core directly — the app's file watcher picks up the
// writes live, no HTTP server required.
import type { CommandMap } from "../types";
import { fail, flag, out, positionals, requireVault, today } from "../args";
import { readNote, writeNote } from "../../../core/src/files";
import { parseBaseFile } from "../../../core/src/bases/parse";
import { resolveSource } from "../../../core/src/bases/source";
import { upsertRow, deleteRow, reorderRow } from "../../../core/src/bases/rowOps";
import { fileBasename } from "../../../core/src/pathUtils";
import type { SourceSpec } from "../../../core/src/bases/types";

/** Read a base file's note text + metadata (name, path) the way core does. */
async function readBase(vault: string, file: string): Promise<{ text: string; name: string }> {
  const text = await readNote(vault, file);
  return { text, name: fileBasename(file) };
}

/** Parse a required `--json '{...}'` flag into a note record (the row's fields). */
function requireJson(args: string[]): Record<string, unknown> {
  const raw = flag(args, "json");
  if (raw === undefined) fail("--json '{...}' required");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("--json is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("--json must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Parse an integer positional, failing on a non-number. */
function intArg(raw: string | undefined, label: string): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n)) fail(`${label} must be an integer`);
  return n;
}

export const commands: CommandMap = {
  "base read": {
    summary: "Parse a type:base note and print its config + table rows",
    usage: "<path>",
    run: async (args) => {
      const vault = requireVault(args);
      const [path] = positionals(args);
      if (!path) fail("<path> required");
      const { text, name } = await readBase(vault, path);
      const { config, rows } = parseBaseFile(text, { name, path });
      out({ config, rows }, args);
    },
  },

  rows: {
    summary: "Resolve a source (base | notes | tasks) to rows, following composition",
    usage: "[--of '[[Base]]' | --where EXPR | --tasks DSL]",
    run: async (args) => {
      const vault = requireVault(args);
      const of = flag(args, "of");
      const where = flag(args, "where");
      const tasks = flag(args, "tasks");

      // Construct a SourceSpec from exactly one selector. `--of` composes another base;
      // `--tasks` runs a task DSL (its value is the where-expression); `--where` filters
      // vault notes. With no selector, default to all vault notes (kind: notes).
      let spec: SourceSpec;
      if (of !== undefined) spec = { kind: "base", ref: of };
      else if (tasks !== undefined) spec = { kind: "tasks", where: tasks || undefined };
      else if (where !== undefined) spec = { kind: "notes", where };
      else spec = { kind: "notes" };

      const resolved = await resolveSource(spec, { root: vault, today: today() });
      out(resolved, args);
    },
  },

  "row add": {
    summary: "Append a row to a base's table (fields from --json)",
    usage: "<basePath> --json '{...}'",
    run: async (args) => {
      const vault = requireVault(args);
      const [basePath] = positionals(args);
      if (!basePath) fail("<basePath> required");
      const note = requireJson(args);
      const { text, name } = await readBase(vault, basePath);
      const next = upsertRow(text, { name, path: basePath }, null, note);
      await writeNote(vault, basePath, next);
      out({ ok: true }, args);
    },
  },

  "row update": {
    summary: "Replace the row at <index> in a base's table (fields from --json)",
    usage: "<basePath> <index> --json '{...}'",
    run: async (args) => {
      const vault = requireVault(args);
      const [basePath, indexStr] = positionals(args);
      if (!basePath) fail("<basePath> required");
      const index = intArg(indexStr, "<index>");
      const note = requireJson(args);
      const { text, name } = await readBase(vault, basePath);
      const next = upsertRow(text, { name, path: basePath }, index, note);
      await writeNote(vault, basePath, next);
      out({ ok: true }, args);
    },
  },

  "row delete": {
    summary: "Remove the row at <index> from a base's table",
    usage: "<basePath> <index>",
    run: async (args) => {
      const vault = requireVault(args);
      const [basePath, indexStr] = positionals(args);
      if (!basePath) fail("<basePath> required");
      const index = intArg(indexStr, "<index>");
      const { text, name } = await readBase(vault, basePath);
      const next = deleteRow(text, { name, path: basePath }, index);
      await writeNote(vault, basePath, next);
      out({ ok: true }, args);
    },
  },

  "row reorder": {
    summary: "Move a base's table row from one position to another",
    usage: "<basePath> <from> <to>",
    run: async (args) => {
      const vault = requireVault(args);
      const [basePath, fromStr, toStr] = positionals(args);
      if (!basePath) fail("<basePath> required");
      const from = intArg(fromStr, "<from>");
      const to = intArg(toStr, "<to>");
      const { text, name } = await readBase(vault, basePath);
      const next = reorderRow(text, { name, path: basePath }, from, to);
      await writeNote(vault, basePath, next);
      out({ ok: true }, args);
    },
  },
};
