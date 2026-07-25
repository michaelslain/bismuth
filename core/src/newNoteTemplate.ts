// core/src/newNoteTemplate.ts
// Pure computation for a brand-new note created from an optional configured template
// (settings.templates.newNote — core/src/schema/settingsSchema.ts). Mirrors dailyNote.ts's
// "config + now -> initial content" shape: all IO (reading the template file, writing the new
// note) stays in the caller (server or, for the file-tree create path, the frontend); this module
// stays pure + tested. Unlike a daily note (whose filename is fixed and never renamed by the
// user), a brand-new note's caret position matters the moment it's created, so this keeps the
// full expandTemplate() result instead of discarding cursorOffset.
import { expandTemplate } from "./templates";

/** A brand-new note's resolved initial content + where the caret should land. */
export interface NewNoteContent {
  /** The note's initial body: "" when there's no template (unset setting, missing/unreadable
   *  file — never throws), otherwise the template with {{...}} tokens expanded. */
  text: string;
  /** Caret offset into `text`. 0 when there's no template; otherwise the first {{cursor}}
   *  token's position, or text.length when the template has none. */
  cursorOffset: number;
}

/**
 * Resolve a brand-new note's initial content from its (already-read) template text.
 *
 * `templateRaw` is `null` whenever the template shouldn't apply — the setting is unset, names a
 * file that doesn't exist, or the file couldn't be read. The caller is responsible for that
 * existence/read check (mirroring how POST /daily-note resolves `templateRaw` before calling
 * `dailyNoteContent`) so this stays pure and side-effect free.
 */
export function newNoteContent(templateRaw: string | null, now: Date, title: string): NewNoteContent {
  if (templateRaw === null) return { text: "", cursorOffset: 0 };
  return expandTemplate(templateRaw, { now, title });
}
