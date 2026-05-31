/** Unified path utilities for vault path handling. */

/** Extract the basename (filename without .md extension) from a path. */
export function fileBasename(path: string): string {
  const name = path.split("/").pop() ?? "";
  return name.replace(/\.md$/, "").replace(/\.base$/, "");
}

/** Extract the directory path (everything before the last /). */
export function dirName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Join a directory and filename into a relative path. */
export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** Check if a path is valid for vault operations (no traversal, not absolute). */
export function isValidVaultPath(path: string): boolean {
  if (!path || path.startsWith("/")) return false;
  const segments = path.split("/");
  return !segments.some((s) => s === ".." || s === "." || s === "");
}

/** Get the top-level folder of a path (first segment, or empty string). */
export function topFolder(path: string): string {
  const segment = path.split("/")[0];
  return segment === path ? "" : segment ?? "";
}
