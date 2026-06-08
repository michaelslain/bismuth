import { homedir } from "node:os";
import { join } from "node:path";

// PATH augmented with common install dirs so `claude` resolves even from a minimal
// GUI-app PATH — a Finder-launched bundle's sidecar inherits only
// /usr/bin:/bin:/usr/sbin:/sbin from launchd, missing homebrew/bun/local bins.
export function claudeLookupPath(env: Record<string, string | undefined> = process.env): string {
  return [
    env.PATH,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".bun", "bin"),
    join(homedir(), ".local", "bin"),
  ]
    .filter(Boolean)
    .join(":");
}

// Resolve the real `claude` binary against the augmented PATH, or null when not found.
export function whichClaude(): string | null {
  return Bun.which("claude", { PATH: claudeLookupPath() });
}
