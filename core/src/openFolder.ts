// core/src/openFolder.ts
//
// "Open folder" backs the file-menu command of the same name. Instead of switching
// a running server's vault root at runtime (fragile: caches, watchers, and open tabs
// would all have to be torn down and rebuilt), we follow Obsidian's process-per-vault
// model: spawn a *sibling* core server pointed at the chosen folder on a free port.
// The caller then opens a window with `?api=<url>` so the same frontend talks to that
// new backend. One folder = one brain = one backend = one window.
//
// This is the dev/desktop mechanism. In a packaged build the same spawn happens from
// the app shell; only the folder *picker* differs (native dialog vs. typed path).

import { statSync } from "node:fs";
import { basename } from "node:path";
import { createServer } from "node:net";
import { createError } from "./error";

/**
 * Build the argv to launch a core server for a vault on a port. Two runtimes:
 * - **dev / from source**: `process.execPath` is the `bun` binary → `bun run <server.ts> …`.
 * - **packaged (Tauri sidecar)**: core is a `bun build --compile` single-file binary, so
 *   `process.execPath` IS the server — re-exec it directly with the new vault/port (the
 *   embedded `serverEntry` path isn't a real file and must not be passed).
 * Detected by the executable's basename ("bun" ⇒ dev; anything else ⇒ compiled).
 */
export function coreLaunchArgv(serverEntry: string, vault: string, memory: string, port: number): string[] {
  const tail = ["--vault", vault, "--memory", memory, "--port", String(port)];
  const compiled = basename(process.execPath) !== "bun";
  return compiled ? [process.execPath, ...tail] : [process.execPath, "run", serverEntry, ...tail];
}

/** Reject anything that isn't an existing directory before we spawn a server at it. */
export function validateVaultFolder(folder: unknown): string {
  if (typeof folder !== "string" || folder.trim() === "") {
    throw createError("EINVAL", "folder is required");
  }
  let st;
  try {
    st = statSync(folder);
  } catch {
    throw createError("ENOENT", `Folder not found: ${folder}`);
  }
  if (!st.isDirectory()) {
    throw createError("EINVAL", `Not a folder: ${folder}`);
  }
  return folder;
}

/** Ask the OS for a currently-free TCP port (bind :0, read it back, release). */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

export interface SpawnedBackend {
  /** Base URL of the new backend, e.g. http://localhost:4519 — pass as `?api=`. */
  url: string;
  port: number;
  /** The folder the new backend is serving as its vault. */
  vault: string;
  pid: number;
}

export interface SpawnOptions {
  folder: string;
  /** 3rd-brain memory dir (required by the core server CLI). */
  memory: string;
  /** Absolute path to core/src/server.ts (the entry to re-launch). */
  serverEntry: string;
  /** Working dir for the child (defaults to the server entry's dir). */
  cwd?: string;
  /** How long to wait for the child to answer /version before giving up. */
  waitMs?: number;
  /** Injectable spawner (tests) — defaults to Bun.spawn. `exited` (if provided)
   *  lets us detect a child that dies before it ever becomes ready. */
  spawn?: (cmd: string[], cwd?: string) => { pid: number; kill: () => void; exited?: Promise<number> };
  /** Injectable readiness probe (tests) — defaults to fetching /version. */
  probe?: (url: string) => Promise<boolean>;
}

function defaultSpawn(cmd: string[], cwd?: string): { pid: number; kill: () => void; exited: Promise<number> } {
  // process.execPath is the bun binary — more robust than relying on "bun" in PATH.
  const proc = Bun.spawn({ cmd, cwd, stdout: "inherit", stderr: "inherit" });
  return { pid: proc.pid, kill: () => proc.kill(), exited: proc.exited };
}

async function defaultProbe(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/version`);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Spawn a core server for `folder` on a free port and resolve once it answers
 * /version. Rejects (and kills the child) if it never comes up within `waitMs`.
 */
export async function spawnVaultBackend(opts: SpawnOptions): Promise<SpawnedBackend> {
  const vault = validateVaultFolder(opts.folder);
  if (!opts.memory) throw createError("EINVAL", "no memory dir configured");
  const port = await findFreePort();
  const url = `http://localhost:${port}`;
  const spawn = opts.spawn ?? defaultSpawn;
  const probe = opts.probe ?? defaultProbe;

  const child = spawn(coreLaunchArgv(opts.serverEntry, vault, opts.memory, port), opts.cwd);

  // Watch for the child dying before it's ready (bad entry, port clash, crash on
  // boot) so we fail fast with a clear message instead of waiting out the timeout.
  let exitCode: number | null = null;
  child.exited?.then((c) => { exitCode = c; }).catch(() => { exitCode = -1; });

  const deadline = Date.now() + (opts.waitMs ?? 8000);
  while (Date.now() < deadline) {
    if (await probe(url)) return { url, port, vault, pid: child.pid };
    if (exitCode !== null) {
      throw createError("INTERNAL_ERROR", `backend for ${vault} exited before it was ready (code ${exitCode})`, 500);
    }
    await new Promise((res) => setTimeout(res, 150));
  }
  child.kill();
  throw createError("INTERNAL_ERROR", `backend for ${vault} did not become ready`, 500);
}
