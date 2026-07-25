/** Unified path utilities for vault path handling. */
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** Extract the basename (filename without .md or .base extension) from a path. */
export function fileBasename(path: string): string {
  const name = path.split("/").pop() ?? "";
  return name.replace(/\.md$/i, "").replace(/\.base$/i, "");
}

/** True for paths under the OS temp root(s) — throwaway by definition (mkdtemp test sandboxes,
 *  a dev server pointed at a temp dir), never something that belongs in a PERSISTENT, machine-wide
 *  registry (the run registry, the daemon's vaults.json). Shared by core/src/daemon.ts
 *  (registerVaultRoot) and core/src/runRegistry.ts (readRunRecords) so the two don't grow separate,
 *  possibly-drifting copies of the same guard. */
export function isTempPath(p: string): boolean {
  const roots = [resolve(tmpdir()), "/tmp", "/private/tmp", "/var/folders"];
  return roots.some((r) => p === r || p.startsWith(r + "/"));
}
