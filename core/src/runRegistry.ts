// A tiny on-disk registry of RUNNING core servers so an out-of-app caller (the `bismuth app …` CLI,
// the daemon) can discover which port serves which vault. The bundled app binds a DYNAMIC free port
// (lib.rs pick_free_port()), injected only into the webview as window.__BISMUTH_API__ — invisible to
// a shell. In-app terminal tabs already get the right URL via CLAUDE_RELAY_URL/BISMUTH_API
// (terminal.ts), but a separate process (the launchd daemon service) has neither, so each core drops
// a record here on boot: ~/.bismuth/run/<b64url(vault)>.json = {port, vault, pid}.
//
// Best-effort and never authoritative: a hard-killed core leaves a stale file, so the CLI's fetch
// simply fails and falls through — discovery is a convenience, not a correctness guarantee. Atomic
// temp+rename writes mirror daemonPages.ts's writePageState idiom.
//
// One rule governs the cleanup below: a record is only ever DELETED on proof its owner is dead.
// See the block comment above readRunRecords.
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, renameSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { pidAlive } from "./daemonState";
import { isTempPath } from "./pathUtils";

/** One running-core record: which port serves which vault (+ pid, for future liveness checks). */
export interface RunRecord {
  port: number;
  vault: string;
  pid: number;
}

/** `~/.bismuth/run` — where each running core drops its discovery record. Overridable via
 *  BISMUTH_RUN_DIR (tests). */
export function runRegistryDir(): string {
  return process.env.BISMUTH_RUN_DIR || join(homedir(), ".bismuth", "run");
}

/** Stable per-vault filename (base64url of the absolute vault path), so relaunching the same vault
 *  overwrites its own record rather than piling up stale ones. */
export function runKey(vault: string): string {
  return Buffer.from(vault).toString("base64url");
}

function recordFile(vault: string): string {
  return join(runRegistryDir(), `${runKey(vault)}.json`);
}

let cleanupVault: string | null = null;
let cleanupInstalled = false;

/** Write this core's discovery record atomically (temp+rename) and arrange best-effort cleanup on
 *  exit/termination. Never throws — a failure just means discovery falls back to :4321. */
export function writeRunRecord(rec: RunRecord): void {
  try {
    const dir = runRegistryDir();
    mkdirSync(dir, { recursive: true });
    const file = recordFile(rec.vault);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(rec, null, 2));
    renameSync(tmp, file);
    cleanupVault = rec.vault;
    if (!cleanupInstalled) {
      cleanupInstalled = true;
      const clean = () => {
        if (cleanupVault) deleteRunRecord(cleanupVault);
      };
      process.on("exit", clean);
      for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, clean);
    }
  } catch {
    /* best-effort — discovery is a convenience, not a requirement */
  }
}

export function deleteRunRecord(vault: string): void {
  try {
    unlinkSync(recordFile(vault));
  } catch {
    /* already gone */
  }
}

// A hard-killed core (SIGKILL, OOM, a `bun test` worker that never reaches writeRunRecord's
// exit/SIGINT/SIGTERM cleanup) leaves its record behind forever — readdirSync/JSON.parse is O(n)
// per call, so a registry that only ever grows eventually makes EVERY `bismuth app …` invocation
// pay for parsing tens of thousands of dead files (measured: 4.5s over ~33k records). readRunRecords
// therefore prunes as it reads.
//
// LIVENESS IS THE ONLY LICENCE TO DELETE. A record is unlinked when — and only when — its owning
// process is PROVABLY gone (`!pidAlive`). That is positive identification: nothing can be using a
// port held by a pid that no longer exists.
//
// A throwaway-LOOKING vault path (a temp dir) is emphatically NOT such proof. Verification servers,
// sandbox/preview cores and `bun run dev` against a scratch vault are all real, RUNNING cores whose
// record must survive: delete it and `bismuth app …` silently falls through to :4321 and drives the
// WRONG window, permanently (the record is gone, so it never recovers). A temp path only downgrades
// a record in the no-vault AMBIGUITY guess — see resolveRunRegistryBase. It never deletes one.
//
// The prune is UNBOUNDED, deliberately. An earlier cap (200 unlinks/call) bounded the wrong
// operation: the readdir + read + JSON.parse runs over EVERY record regardless and is what costs
// the seconds, so a capped drain made each of ~165 successive CLI calls pay the full multi-second
// stall instead of one call paying it once. unlinkSync is the cheap part; let it finish.

/** All current, LIVE records. A record whose pid is dead is filtered out AND unlinked from disk;
 *  everything else is returned as-is (including temp-path vaults — a live core is a live core).
 *  Tolerant: a missing dir or a malformed file is skipped, never thrown. */
export function readRunRecords(): RunRecord[] {
  const dir = runRegistryDir();
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: RunRecord[] = [];
  for (const n of names) {
    const file = join(dir, n);
    let rec: RunRecord;
    try {
      rec = JSON.parse(readFileSync(file, "utf8")) as RunRecord;
    } catch {
      continue; // malformed/unreadable — skip, leave it for a future pass to reconsider
    }
    if (!rec || typeof rec.port !== "number" || typeof rec.vault !== "string" || typeof rec.pid !== "number") {
      continue; // wrong shape — skip without pruning (be conservative about deleting the unknown)
    }
    if (!pidAlive(rec.pid)) {
      try { unlinkSync(file); } catch { /* best-effort; a future call retries */ }
      continue;
    }
    out.push(rec);
  }
  return out;
}

/**
 * Resolve a base URL from the registry.
 *
 * With a vault this is POSITIVE IDENTIFICATION — an exact path match, honoured whatever the path
 * looks like, so a sandbox core on `/tmp/…` is still reachable by name.
 *
 * Without one it is a GUESS, only safe when unambiguous. Persistent vaults win the guess: a stray
 * sandbox/verification core on a temp path must not hijack a bare `bismuth app …` typed in a shell
 * that meant the user's real vault. If temp-path cores are ALL that is running, they become the
 * pool — inside a sandbox that IS the right answer. Undefined when still ambiguous, or none.
 */
export function resolveRunRegistryBase(vault?: string): string | undefined {
  const recs = readRunRecords();
  if (vault) {
    const hit = recs.find((r) => r.vault === vault);
    return hit ? `http://localhost:${hit.port}` : undefined;
  }
  const persistent = recs.filter((r) => !isTempPath(r.vault));
  const pool = persistent.length > 0 ? persistent : recs;
  if (pool.length === 1) return `http://localhost:${pool[0].port}`;
  return undefined;
}
