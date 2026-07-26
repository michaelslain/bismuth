/** Server-only temp-path guard. Split out of pathUtils.ts so the pure path helpers there stay
 *  importable from the browser bundle — this file pulls in `node:os`/`node:path`, so it must
 *  only ever be imported by server-side modules (currently daemon.ts + runRegistry.ts). */
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** True for paths under the OS temp root(s) — throwaway by definition (mkdtemp test sandboxes,
 *  a dev server pointed at a temp dir), never something that belongs in a PERSISTENT, machine-wide
 *  registry (the run registry, the daemon's vaults.json). Shared by core/src/daemon.ts
 *  (registerVaultRoot) and core/src/runRegistry.ts (readRunRecords) so the two don't grow separate,
 *  possibly-drifting copies of the same guard.
 *
 *  IMPORTANT: a temp path is a reason to decline to REGISTER a record, or to EXCLUDE one from
 *  returned results — it is NEVER a licence to DELETE a record whose owning process is still
 *  alive. Liveness is the only licence to delete. See `readRunRecords` in runRegistry.ts. */
export function isTempPath(p: string): boolean {
  const roots = [resolve(tmpdir()), "/tmp", "/private/tmp", "/var/folders"];
  return roots.some((r) => p === r || p.startsWith(r + "/"));
}
