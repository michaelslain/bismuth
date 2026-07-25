// core/src/newNoteTemplate.ts
// A brand-new note created from an optional configured template (settings.templates.newNote —
// core/src/schema/settingsSchema.ts). Mirrors dailyNote.ts's "config + now -> initial content"
// shape: all IO stays in the caller, this module stays headless + tested.
//
// The wrinkle that shapes this whole file: unlike a daily note (whose filename is decided up
// front and never renamed), a new note is created under a PLACEHOLDER name ("Untitled.md") and
// dropped straight into the file tree's inline rename — the user's Enter MOVES it. So the name a
// note is CREATED with is almost never the name it KEEPS. Anything bound to the create-time path
// (the expanded {{title}}, the {{cursor}} offset, the primed note-cache entry) is bound to a path
// that stops existing a keystroke later. `applyNewNoteTemplate` therefore sequences the write on
// the note's FINAL path: it prefetches the template immediately (so the user's typing overlaps
// the read) but expands + writes only once the rename has settled.
import { expandTemplate } from "./templates";
import { noteStem } from "./pathUtils";

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

/**
 * The side effects applying a new-note template needs, injected so the orchestration below stays
 * headless and unit-testable. The file tree supplies `api.read`/`api.write` plus the two
 * client-side channels that MUST be keyed to the final path: the note-body LRU
 * (`noteCache.primeNoteCache`) and the one-shot caret channel (`pendingCursor.setPendingCursor`).
 */
export interface NewNoteTemplateIO {
  /** Read the configured template file. Rejecting = missing/unreadable = "no template". */
  readTemplate(path: string): Promise<string>;
  /** Overwrite the (already created, still empty) note with its expanded body. */
  write(path: string, text: string): Promise<void>;
  /** Seed the client note cache so the first open is an instant hit on the TEMPLATED body. */
  primeCache(path: string, text: string): void;
  /** Record where {{cursor}} landed so the editor seeds its initial selection there. */
  setCursor(path: string, offset: number): void;
}

export interface ApplyNewNoteTemplateOptions {
  /** `settings.templates.newNote` verbatim; "" (the default) means no template. */
  templatePath: string;
  /** Clock for {{date}}/{{time}} — the moment the note was created, not the moment it settled. */
  now: Date;
  /**
   * Resolves with the note's FINAL vault path once its inline rename has settled — the renamed
   * path if the user typed a name, or the created path if they abandoned the rename (Escape,
   * empty input, kept "Untitled", or a move that failed). The caller must only resolve this
   * AFTER any `api.move` has landed on disk, so the write below can't race the move.
   */
  settledPath: Promise<string>;
  io: NewNoteTemplateIO;
}

/**
 * Apply the configured new-note template to a just-created note.
 *
 * Ordering is the whole point:
 *   1. the template read starts NOW, overlapping the user typing the note's name;
 *   2. the expansion waits for `settledPath`, so `{{title}}` is the name the user actually
 *      typed rather than the "Untitled" placeholder the note was created under;
 *   3. the write, cache prime and cursor record all target that same final path, so none of them
 *      is stranded at a key nothing reads — the note cache re-keys itself on `bismuth-moved`
 *      BEFORE the move resolves, which is exactly what a create-time write loses to.
 *
 * Never throws for "there is no usable template" (unset / missing / unreadable / empty) — the
 * note is simply left as the empty file the create already made, byte-identical to the behavior
 * before this setting existed. A failing WRITE does reject, so the caller can surface it.
 */
export async function applyNewNoteTemplate(opts: ApplyNewNoteTemplateOptions): Promise<void> {
  const templatePath = opts.templatePath.trim();
  if (!templatePath) return; // unset (the default) → empty note, unchanged behavior
  // Kick the read off before awaiting the rename so the only latency left after the user hits
  // Enter is the write itself. `.then(ok, fail)` attaches the rejection handler synchronously,
  // so a missing template can never surface as an unhandled rejection while we wait.
  const rawP = opts.io.readTemplate(templatePath).then(
    (raw) => raw,
    () => null, // missing/unreadable template → empty note, never blocks or errors the create
  );
  const path = await opts.settledPath;
  const raw = await rawP;
  if (raw === null) return;
  const { text, cursorOffset } = newNoteContent(raw, opts.now, noteStem(path));
  if (!text) return; // empty template → nothing to write; caret stays at the default start
  await opts.io.write(path, text);
  opts.io.primeCache(path, text);
  opts.io.setCursor(path, cursorOffset);
}
