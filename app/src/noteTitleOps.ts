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
 * New vault path after renaming the title, preserving the original folder and
 * the `.md` extension. `newTitle` is the bare title text (the user never types
 * the folder or extension). Returns null when the trimmed title is empty or
 * unchanged from the current one (caller should revert / no-op).
 */
export function renamedPath(path: string, newTitle: string): string | null {
  const title = newTitle.trim();
  if (!title) return null; // empty / whitespace → no rename
  if (title === deriveTitle(path)) return null; // unchanged → no-op
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  return `${dir}${title}.md`;
}
