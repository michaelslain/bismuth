// Pure, DOM-free helpers for embedding a DROPPED IMAGE into a kanban card.
//
// Dropping an image (from Finder/desktop, or an OS file drag) onto a card copies the file into the
// vault's attachment folder and embeds `![[basename]]` in the card's DESCRIPTION — the same
// copy-into-attachments + `![[...]]` convention notes/tables use (Editor.tsx). Kept pure so the
// path/extension/embed/append logic is unit-tested without a DOM or the network; the components own
// the DOM hit-test, and cardImageDrop.ts owns the async upload/read orchestration.
//
// THE DESCRIPTION, NOT THE BODY: an earlier cut appended the embed to the card note's BODY, which
// neither the card face nor the edit modal renders (both show the title + declared PROPERTIES) — so
// the picture was written to disk and shown nowhere ("the image is invisibly attached"). The drop
// now targets the card's markdown property, which BOTH surfaces already render.

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

/** Append an embed block to a markdown PROPERTY's value on its OWN line, keeping existing prose
 *  intact. Trailing whitespace is trimmed and a blank line inserted before the block so the embed
 *  is a standalone paragraph (never glued onto the previous one). An empty value becomes just the
 *  embed. `block` may itself be several `\n`-joined embeds (a multi-image drop) — they stay on
 *  consecutive lines.
 *
 *  NO trailing newline: this value is written into YAML frontmatter, and it must round-trip
 *  byte-for-byte with what the modal's Milkdown surface serializes — createDocEditor's
 *  `normalizeTrailing` strips trailing newlines, so emitting one here would make a card's
 *  description differ depending on whether the image was dropped on the board or in the modal. */
export function appendEmbedToValue(value: string, block: string): string {
  const body = (value ?? "").replace(/\s+$/, "");
  return body === "" ? block : `${body}\n\n${block}`;
}

/** The property an image dropped on a card should land in: the first WRITABLE markdown-kind
 *  property among the card's columns (conventionally `description` — propertyEdit.ts types a bare
 *  `description` as markdown even when the base declares nothing). Null when the board has no such
 *  property, in which case the drop has nowhere VISIBLE to go and the caller must say so rather
 *  than write the image somewhere invisible. `kindOf`/`writable` are injected so this stays pure. */
export function markdownDropTarget(
  cols: string[],
  kindOf: (id: string) => { kind: string },
  writable: (id: string) => boolean,
): string | null {
  return cols.find((id) => writable(id) && kindOf(id).kind === "markdown") ?? null;
}
