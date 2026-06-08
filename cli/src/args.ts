// Shared argument-parsing + output helpers for the `bismuth` CLI.
// Pure and dependency-free so every command group imports a stable contract.

/** Value of a `--name <value>` flag, or undefined if absent. */
export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

/** True if a boolean `--name` flag is present. */
export function bool(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

/** Positional (non-flag) args, in order. Skips `--name value` pairs. */
export function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      // Treat the next token as this flag's value unless it's another flag.
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** Print a fatal usage error and exit non-zero. */
export function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

/**
 * Resolve the vault dir: `--vault <dir>` flag wins, then `OA_VAULT` env, then
 * `BISMUTH_VAULT` env. Fails if none is set.
 */
export function requireVault(args: string[]): string {
  const v = flag(args, "vault") ?? process.env.OA_VAULT ?? process.env.BISMUTH_VAULT;
  if (!v) fail("no vault — pass --vault <dir> or set OA_VAULT");
  return v;
}

/** Resolve the memory dir (optional): `--memory` flag, then OA_MEMORY/BISMUTH_MEMORY env. */
export function memoryDir(args: string[]): string | undefined {
  return flag(args, "memory") ?? process.env.OA_MEMORY ?? process.env.BISMUTH_MEMORY;
}

/** Today's date as YYYY-MM-DD (local), for tasks/SRS/daily-note. */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Print a result. Objects/arrays → JSON (pretty when `--pretty` or a TTY),
 * strings → as-is, undefined/null → nothing. Use for every command's output so
 * the CLI is uniformly machine-parseable.
 */
export function out(data: unknown, args: string[] = []): void {
  if (data === undefined || data === null) return;
  if (typeof data === "string") {
    console.log(data);
    return;
  }
  const pretty = bool(args, "pretty");
  console.log(JSON.stringify(data, null, pretty ? 2 : 0));
}
