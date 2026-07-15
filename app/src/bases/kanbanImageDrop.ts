// Pure, DOM-free helpers for attaching a DROPPED IMAGE to a kanban card note.
//
// Dropping an image (from Finder/desktop, or an OS file drag) onto a card copies the file into the
// vault's attachment folder and appends an `![[basename]]` embed to that card note's BODY — the same
// copy-into-attachments + `![[...]]` convention notes/tables use (Editor.tsx). Kept pure so the
// path/extension/embed/append logic is unit-tested without a DOM or the network; the KanbanView
// component owns only the DOM hit-test + the async upload/read/write orchestration.

// Image extensions we accept for a card attachment, keyed off the dropped file's NAME (an OS drag
// exposes only a path/basename, and some drag sources hand a File an empty `type`). Matches the
// editor's embeddable-IMAGE set (a superset of the chat composer's narrower SDK-image set).
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);

/** The basename of a path, tolerant of both `/` and `\` separators (native OS paths are `\` on
 *  Windows). Returns the input unchanged when it has no separator. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Is this filename/path an image we accept for a card attachment (by extension)? Case-insensitive. */
export function isImagePath(path: string): boolean {
  const base = baseName(path);
  const dot = base.lastIndexOf(".");
  return dot !== -1 && IMAGE_EXT.has(base.slice(dot + 1).toLowerCase());
}

/** Is this dropped browser File an image? MIME first (the reliable signal in a browser drop), with
 *  an extension fallback for sources that hand an empty `File.type`. */
export function isImageFile(file: { name: string; type: string }): boolean {
  if (file.type.startsWith("image/")) return true;
  return isImagePath(file.name);
}

/** The `![[name]]` wikilink embed for an attachment basename. */
export function imageEmbed(basename: string): string {
  return `![[${basename}]]`;
}

/** Vault-relative destination for a new attachment, honoring `settings.attachments.folder`:
 *  "" = vault root, "." = the CARD note's own folder, else a named subfolder. Mirrors Editor.tsx's
 *  `attachmentTarget` so a card drop lands exactly where a note-body drop of the same image would.
 *  Leading/trailing slashes on the folder are stripped so a stray `folder: /attachments` still
 *  resolves vault-relative (the backend rejects absolute-looking paths). */
export function attachmentTarget(folder: string, fileName: string, notePath: string | null): string {
  const f = folder.trim().replace(/^\/+|\/+$/g, "");
  if (f === ".") {
    const slash = (notePath ?? "").lastIndexOf("/");
    return (slash === -1 ? "" : (notePath ?? "").slice(0, slash + 1)) + fileName;
  }
  return f ? `${f}/${fileName}` : fileName;
}

/** Append an embed block to a note's content on its OWN line, keeping any frontmatter/body intact.
 *  Trailing whitespace is trimmed and a blank line is inserted before the block so the embed is a
 *  standalone line (→ renders as a resizable image, never glued to the previous paragraph). An
 *  empty note gets just the embed. `block` may itself be several `\n`-joined embeds (a multi-image
 *  drop) — they stay on consecutive lines. */
export function appendEmbedToNote(content: string, block: string): string {
  const body = content.replace(/\s+$/, "");
  if (body === "") return `${block}\n`;
  return `${body}\n\n${block}\n`;
}
