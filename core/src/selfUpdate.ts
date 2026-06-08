// Git-based self-update for the bundled Bismuth app.
//
// The bundled app was built from a local clone of the repo; the build baked a
// build-origin.json (repoRoot + sha) into the tools resource. The sidecar uses it to:
//   - auto-detect when the local checkout is behind origin/main (getUpdateStatus), and
//   - on request, `git pull --ff-only` + `bun run tauri build`, then hand off to a detached
//     script that waits for the app to quit, swaps the .app bundle, and relaunches.
//
// Self-disables when there's no source build (no build-origin.json or no OA_APP_PATH) — e.g.
// dev (`bun run dev`). Never throws; failures surface as an "error" phase / a reason.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export interface UpdateStatus {
  available: boolean;
  behind: number;
  localSha: string | null;
  remoteSha: string | null;
  builtSha: string | null;
  dirty: boolean;
  /** When unavailable: why (e.g. "not-a-source-build", "not-a-git-repo", "no-upstream"). */
  reason?: string;
}

export type UpdatePhase = "idle" | "pulling" | "building" | "ready" | "error";
export interface UpdateProgress {
  phase: UpdatePhase;
  message?: string;
  log?: string;
}

// PATH augmented with the dirs a from-source rebuild needs (git, bun, cargo/rustup),
// since a Finder-launched sidecar inherits only the minimal launchd PATH.
function buildPath(): string {
  return [
    process.env.PATH,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".cargo", "bin"),
    join(homedir(), ".bun", "bin"),
    join(homedir(), ".local", "bin"),
  ]
    .filter(Boolean)
    .join(":");
}

async function runProc(
  cmd: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      env: { ...process.env, PATH: buildPath() },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = opts.timeoutMs ? setTimeout(() => proc.kill(), opts.timeoutMs) : undefined;
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stdout, stderr };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (e) {
    return { code: -1, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs a git subcommand in a repo. Injectable so getUpdateStatus is unit-testable. */
export type GitRunner = (
  repoRoot: string,
  args: string[],
  timeoutMs?: number,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const realGit: GitRunner = (repoRoot, args, timeoutMs = 15_000) =>
  runProc(["git", "-C", repoRoot, ...args], { timeoutMs });

function tail(s: string, n = 2000): string {
  const t = s.trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

interface BuildOrigin {
  repoRoot: string;
  sha: string;
}

export function readBuildOrigin(): BuildOrigin | null {
  const src = process.env.OA_BISMUTH_INSTALL_SRC;
  if (!src) return null;
  const file = join(src, "build-origin.json");
  if (!existsSync(file)) return null;
  try {
    const o = JSON.parse(readFileSync(file, "utf8")) as Partial<BuildOrigin>;
    return o.repoRoot ? { repoRoot: o.repoRoot, sha: o.sha ?? "" } : null;
  } catch {
    return null;
  }
}

/** Read-only update status. Auto-fetches origin/main. Never throws. Deps injectable for tests. */
export async function getUpdateStatus(
  deps: { git?: GitRunner; origin?: BuildOrigin | null } = {},
): Promise<UpdateStatus> {
  const git = deps.git ?? realGit;
  const base: UpdateStatus = {
    available: false,
    behind: 0,
    localSha: null,
    remoteSha: null,
    builtSha: null,
    dirty: false,
  };
  const origin = deps.origin !== undefined ? deps.origin : readBuildOrigin();
  if (!origin?.repoRoot) return { ...base, reason: "not-a-source-build" };
  const { repoRoot, sha: builtSha } = origin;
  base.builtSha = builtSha || null;

  if ((await git(repoRoot, ["rev-parse", "--is-inside-work-tree"])).code !== 0) {
    return { ...base, reason: "not-a-git-repo" };
  }
  // Best-effort fetch; if offline we still report against the last-known remote.
  await git(repoRoot, ["fetch", "--quiet", "origin", "main"], 20_000);
  const remote = await git(repoRoot, ["rev-parse", "origin/main"]);
  if (remote.code !== 0) return { ...base, reason: "no-upstream" };

  const localSha = (await git(repoRoot, ["rev-parse", "HEAD"])).stdout.trim() || null;
  const remoteSha = remote.stdout.trim() || null;
  const behindOut = await git(repoRoot, ["rev-list", "--count", "HEAD..origin/main"]);
  const behind = behindOut.code === 0 ? parseInt(behindOut.stdout.trim() || "0", 10) || 0 : 0;
  const dirty = (await git(repoRoot, ["status", "--porcelain"])).stdout.trim().length > 0;
  return { available: behind > 0, behind, localSha, remoteSha, builtSha: builtSha || null, dirty };
}

let state: UpdateProgress = { phase: "idle" };
export function getUpdateProgress(): UpdateProgress {
  return state;
}

/**
 * Kick off an update (idempotent while running). Validates first (must be available, clean,
 * a real source build), sets phase=pulling, and fires the pipeline WITHOUT awaiting so the
 * HTTP request returns immediately — the frontend polls getUpdateProgress(). Never throws.
 */
export async function startUpdate(): Promise<UpdateProgress> {
  if (state.phase === "pulling" || state.phase === "building") return state;
  const origin = readBuildOrigin();
  const appPath = process.env.OA_APP_PATH;
  if (!origin?.repoRoot || !appPath) {
    state = { phase: "error", message: "self-update unavailable (not a bundled source build)" };
    return state;
  }
  const status = await getUpdateStatus();
  if (!status.available) {
    state = { phase: "idle", message: "already up to date" };
    return state;
  }
  if (status.dirty) {
    state = { phase: "error", message: "the Bismuth repo has uncommitted changes — won't overwrite" };
    return state;
  }
  state = { phase: "pulling", message: "pulling latest…" };
  void runPipeline(origin.repoRoot, appPath);
  return state;
}

async function runPipeline(repoRoot: string, appPath: string): Promise<void> {
  try {
    const pull = await realGit(repoRoot, ["pull", "--ff-only", "origin", "main"], 120_000);
    if (pull.code !== 0) {
      state = { phase: "error", message: "git pull failed (diverged or conflict)", log: tail(pull.stderr || pull.stdout) };
      return;
    }
    state = { phase: "building", message: "rebuilding Bismuth (this takes a few minutes)…" };
    // `bun run tauri build --bundles app` in app/ — rebuilds frontend + sidecar + tools +
    // the .app, but SKIPS the .dmg: self-update only swaps the .app, and the dmg packaging
    // step (bundle_dmg.sh) is intermittently flaky, so building it would just add a failure
    // mode. Resolve bun from PATH: in the COMPILED sidecar process.execPath is the sidecar
    // binary, NOT bun, so we must look bun up (buildPath includes ~/.bun/bin).
    const bun = Bun.which("bun", { PATH: buildPath() }) ?? "bun";
    const build = await runProc([bun, "run", "tauri", "build", "--bundles", "app"], {
      cwd: join(repoRoot, "app"),
      timeoutMs: 900_000,
    });
    if (build.code !== 0) {
      state = { phase: "error", message: "build failed", log: tail(build.stderr || build.stdout) };
      return;
    }
    spawnRelauncher(repoRoot, appPath);
    state = { phase: "ready", message: "update ready — relaunching…" };
  } catch (e) {
    state = { phase: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

// Write + spawn a DETACHED script that waits for the app to quit, swaps the .app bundle,
// and relaunches. Detached (nohup + reparent) so it survives the sidecar being killed when
// the app exits. The frontend calls the Tauri `quit_app` command once phase=ready.
function spawnRelauncher(repoRoot: string, appPath: string): void {
  const builtApp = join(repoRoot, "app", "src-tauri", "target", "release", "bundle", "macos", "Bismuth.app");
  const appPid = process.env.OA_APP_PID ?? "";
  const script = `#!/bin/bash
# Bismuth self-update relauncher (generated). Wait for the app to quit, swap, relaunch.
set -e
NEW=${JSON.stringify(builtApp)}
DEST=${JSON.stringify(appPath)}
APP_PID=${JSON.stringify(appPid)}
[[ -d "$NEW" ]] || exit 1
if [[ -n "$APP_PID" ]]; then
  for _ in $(seq 1 240); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.5; done
fi
sleep 1
rm -rf "$DEST"
/usr/bin/ditto "$NEW" "$DEST"
/usr/bin/open "$DEST"
`;
  const scriptPath = join(tmpdir(), `bismuth-update-${process.pid}-${performance.now().toFixed(0)}.sh`);
  writeFileSync(scriptPath, script, { mode: 0o755 });
  // nohup + & so the job reparents to launchd and outlives this sidecar.
  Bun.spawn(["/bin/bash", "-c", `nohup bash ${JSON.stringify(scriptPath)} >/tmp/bismuth-update.log 2>&1 &`], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
}
