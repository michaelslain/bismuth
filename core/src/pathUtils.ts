/** Unified path utilities for vault path handling. */

/** Extract the basename (filename without .md or .base extension) from a path. */
export function fileBasename(path: string): string {
  const name = path.split("/").pop() ?? "";
  return name.replace(/\.md$/i, "").replace(/\.base$/i, "");
}
