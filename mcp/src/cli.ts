// Bridge to the bismuth CLI (cli/src/index.ts). Spawns it via `bun run` and
// captures stdout/stderr/exit code. The CLI is a thin wrapper over @bismuth/core and
// reads OA_VAULT/OA_MEMORY from the environment, so we pass process.env through.
// Never throws — every failure mode resolves to a CliResult.

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Run the bismuth CLI. In a machine-wide install, OA_BISMUTH_CLI points at the compiled
 * `bismuth` binary (no Bun/repo on disk), so we exec it directly; otherwise fall back to
 * `bun run <repoRoot>/cli/src/index.ts` (the dev repo). Inherits process.env (so
 * OA_VAULT/OA_MEMORY carry through). On timeout the child is killed and the result has
 * code -1 plus a stderr note. Never throws.
 */
export async function runCli(
  repoRoot: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<CliResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cliBin = process.env.OA_BISMUTH_CLI;
  const cmd = cliBin ? [cliBin, ...args] : ["bun", "run", `${repoRoot}/cli/src/index.ts`, ...args];

  try {
    const proc = Bun.spawn(cmd, {
      cwd: opts?.cwd ?? repoRoot,
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      if (timedOut) {
        const note = `cli timed out after ${timeoutMs}ms`;
        return {
          stdout,
          stderr: stderr ? `${stderr}\n${note}` : note,
          code: -1,
        };
      }

      return { stdout, stderr, code };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { stdout: "", stderr: `failed to spawn cli: ${msg}`, code: -1 };
  }
}

/**
 * Fetch the CLI's own help text. For a group, tries `<group> --help`; if that
 * exits non-zero or yields nothing, falls back to the global `--help` (which the
 * CLI prints on `--help`/`-h`/`help`/no args). Returns trimmed stdout, or a
 * short message on total failure.
 */
export async function cliHelp(repoRoot: string, group?: string): Promise<string> {
  if (group) {
    const scoped = await runCli(repoRoot, [group, "--help"]);
    const out = scoped.stdout.trim();
    if (scoped.code === 0 && out) return out;
  }

  const global = await runCli(repoRoot, ["--help"]);
  const out = global.stdout.trim();
  if (out) return out;

  return "bismuth CLI help is unavailable.";
}
