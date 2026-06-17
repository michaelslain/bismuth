// app/src/noteTitleOps.ts
// Pure helpers for the inline note title. The title is a pure function of the
// note's path: it is derived from the filename (no folder, no `.md`) and is
// never stored in the markdown body. Renaming the title rewrites the path,
// preserving the folder and the `.md` extension.

/** Title shown in the editor header: filename with no folder and no `.md`. */
export function deriveTitle(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

/**
 * Make a typed title safe to use as a filename. The title field is just a text
 * box, so users paste/type markdown (`# Heading`, `**bold**`) and path-ish text
 * (`a/b`, `C:foo`) into it — left raw, those break the rename:
 *   - `/` and `\` create nested folders (and `deriveTitle` then only round-trips
 *     the last segment, so the title appears to "lose" its prefix and re-renames
 *     fight each other);
 *   - `: * ? " < > |` are illegal on common filesystems and fail the write;
 *   - a leading `#…` heading marker just litters the filename.
 * So strip a leading markdown heading prefix and the filesystem-illegal set,
 * collapse the whitespace that leaves behind, and drop leading dots (hidden /
 * `.`/`..` names). Markdown emphasis falls out for free since `*` is illegal.
 */
export function sanitizeTitle(input: string): string {
  return input
    .replace(/^#{1,6}\s+/, "")          // "# Foo" / "### Foo" → "Foo"
    .replace(/[\u0000-\u001f]/g, "")  // strip control chars
    .replace(/[\\/:*?"<>|]/g, " ")        // filesystem-illegal chars → space
    .replace(/\s+/g, " ")                // collapse the gaps left behind
    .trim()
    .replace(/^\.+/, "")                  // no leading dots (hidden / "." / "..")
    .trim();
}

/**
 * New vault path after renaming the title, preserving the original folder and
 * the `.md` extension. `newTitle` is the bare title text (the user never types
 * the folder or extension). The title is sanitized to a legal filename first
 * (see sanitizeTitle). Returns null when the title is empty (even after
 * sanitizing) or unchanged from the current one (caller should revert / no-op).
 */
export function renamedPath(path: string, newTitle: string): string | null {
  const title = sanitizeTitle(newTitle);
  if (!title) return null; // empty / whitespace / all-illegal → no rename
  if (title === deriveTitle(path)) return null; // unchanged → no-op
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  return `${dir}${title}.md`;
}
