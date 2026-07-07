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
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, renameSync, readdirSync, readFileSync, unlinkSync } from "node:fs";

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

/** All current records. Tolerant: a missing dir or a malformed file is skipped, never thrown. */
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
    try {
      const rec = JSON.parse(readFileSync(join(dir, n), "utf8")) as RunRecord;
      if (rec && typeof rec.port === "number" && typeof rec.vault === "string") out.push(rec);
    } catch {
      /* skip a malformed record */
    }
  }
  return out;
}

/** Resolve a base URL from the registry: by exact vault match when a vault is given, else the single
 *  record when exactly one core is running. Undefined when ambiguous (many, no vault) or none. */
export function resolveRunRegistryBase(vault?: string): string | undefined {
  const recs = readRunRecords();
  if (vault) {
    const hit = recs.find((r) => r.vault === vault);
    return hit ? `http://localhost:${hit.port}` : undefined;
  }
  if (recs.length === 1) return `http://localhost:${recs[0].port}`;
  return undefined;
}
