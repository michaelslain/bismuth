// Settings + folder-icon command group for the `bismuth` CLI.
// Reads the merged settings feed and the validation schema; mutates settings.yaml
// and the per-folder icon map in place via core (preserving comments/key order).
// Mutating commands call core directly — the app's file watcher picks up writes live.
import type { CommandMap } from "../types";
import { out, flag, bool, fail, parseValue, positionals, requireVault } from "../args";
import {
  serializeSettingsForFrontend,
  setSettingInFile,
  getVaultSchema,
  setFolderIcon,
} from "../../../core/src/settings";

/** Walk a dotted path into a value; returns undefined if any segment is missing. */
function walkPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export const commands: CommandMap = {
  "settings get": {
    summary: "Print the merged settings feed; pass --key a.b.c to read one dotted path",
    usage: "[--key a.b.c]",
    run: async (args) => {
      const vault = requireVault(args);
      const all = await serializeSettingsForFrontend(vault);
      const key = flag(args, "key");
      out(key ? walkPath(all, key) : all, args);
    },
  },
  "settings set": {
    summary: "Set a settings.yaml value at a dotted path (value parsed as JSON, else raw string)",
    usage: "<key.path> <value>",
    run: async (args) => {
      const vault = requireVault(args);
      const [keyPath, value] = positionals(args);
      if (!keyPath) fail("usage: settings set <key.path> <value>");
      if (value === undefined) fail("usage: settings set <key.path> <value>");
      await setSettingInFile(vault, keyPath.split("."), parseValue(value));
      out({ ok: true }, args);
    },
  },
  "settings schema": {
    summary: "Print the vault's property/validation schema",
    run: async (args) => {
      const vault = requireVault(args);
      out(await getVaultSchema(vault), args);
    },
  },
  "folder-icon": {
    summary: "Set (or --clear) a folder's icon in settings.yaml",
    usage: "<folder> <icon> [--clear]",
    run: async (args) => {
      const vault = requireVault(args);
      const [folder, icon] = positionals(args);
      const clear = bool(args, "clear");
      if (!folder) fail("usage: folder-icon <folder> <icon> [--clear]");
      if (!clear && !icon) fail("usage: folder-icon <folder> <icon> [--clear]");
      await setFolderIcon(vault, folder, clear ? null : icon);
      out({ ok: true }, args);
    },
  },
};
