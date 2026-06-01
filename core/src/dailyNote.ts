// core/src/dailyNote.ts
// Pure computation for daily notes: a config + the current time → the note's
// vault-relative path and its initial content. All IO (existence check, reading the
// template, writing the note) stays in the server; this module stays pure + tested.
import { expandTemplate } from "./templates";

export interface DailyNoteConfig {
  id: string;
  label: string;
  icon: string;
  folder: string;
  fileName: string;
  template: string;
}

/** The note's filename base (fileName tokens expanded, no extension). */
function fileBase(cfg: DailyNoteConfig, now: Date): string {
  return expandTemplate(cfg.fileName, { now, title: "" }).text.trim();
}

/** Vault-relative ".md" path: expanded fileName joined with folder. Empty folder = root. */
export function dailyNotePath(cfg: DailyNoteConfig, now: Date): string {
  const file = `${fileBase(cfg, now)}.md`;
  const folder = cfg.folder.trim().replace(/\/+$/, "");
  return folder ? `${folder}/${file}` : file;
}

/** Initial body for a freshly created daily note. templateRaw === null → "" (no
 *  template); otherwise the template is expanded with title = the filename base. */
export function dailyNoteContent(cfg: DailyNoteConfig, now: Date, templateRaw: string | null): string {
  if (templateRaw === null) return "";
  return expandTemplate(templateRaw, { now, title: fileBase(cfg, now) }).text;
}
