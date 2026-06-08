// Note creation + templates + daily note commands for the `bismuth` CLI.
// All mutations call core functions directly (no HTTP server); the app's file
// watcher picks up the change live.
import type { CommandMap } from "../types";
import { flag, positionals, requireVault, out, fail } from "../args";
import { createEntry, listTemplates, readNote, writeNote } from "../../../core/src/files";
import { expandTemplate } from "../../../core/src/templates";
import { dailyNotePath, dailyNoteContent, type DailyNoteConfig } from "../../../core/src/dailyNote";
import { readDailyNotes } from "../../../core/src/settings";

/** Title (filename without dir + `.md`) for a vault-relative note path. */
function titleFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

export const commands: CommandMap = {
  "note new": {
    summary: "Create a new note, optionally from a template",
    usage: "<path> [--template NAME]",
    async run(args) {
      const vault = requireVault(args);
      const [path] = positionals(args);
      if (!path) fail("note new: <path> required");
      const rel = path.endsWith(".md") ? path : `${path}.md`;

      createEntry(vault, rel, "file");

      const templateName = flag(args, "template");
      if (templateName) {
        const folder = flag(args, "template-folder") ?? "Templates";
        const templates = await listTemplates(vault, folder);
        const match = templates.find((t) => t.name === templateName || t.path === templateName);
        if (!match) fail(`note new: template not found: ${templateName}`);
        const raw = await readNote(vault, match.path);
        const { text } = expandTemplate(raw, { now: new Date(), title: titleFromPath(rel) });
        await writeNote(vault, rel, text);
      }

      out({ path: rel, created: true }, args);
    },
  },

  templates: {
    summary: "List available note templates",
    async run(args) {
      const vault = requireVault(args);
      const folder = flag(args, "template-folder") ?? "Templates";
      out(await listTemplates(vault, folder), args);
    },
  },

  daily: {
    summary: "Open (creating if needed) today's daily note",
    async run(args) {
      const vault = requireVault(args);
      const config: DailyNoteConfig =
        (await readDailyNotes(vault))[0] ?? {
          id: "daily",
          label: "Daily",
          icon: "CalendarDays",
          folder: "",
          fileName: "{{date}}",
          template: "",
        };

      const now = new Date();
      const path = dailyNotePath(config, now);

      if (await Bun.file(`${vault}/${path}`).exists()) {
        out({ path, created: false }, args);
        return;
      }

      let templateRaw: string | null = null;
      if (config.template && (await Bun.file(`${vault}/${config.template}`).exists())) {
        templateRaw = await readNote(vault, config.template);
      }
      await writeNote(vault, path, dailyNoteContent(config, now, templateRaw));
      out({ path, created: true }, args);
    },
  },
};
