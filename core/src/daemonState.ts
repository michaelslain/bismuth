// core/src/daemonState.ts
// Shared low-level readers for the claude-bot daemon's on-disk state, factored out of
// daemon.ts and daemonGraph.ts so the genuinely identical helpers live in one place.
// Each helper is a pure file read that NEVER throws — missing/malformed input degrades
// to a safe default. (daemon.ts keeps its own name-based, null-returning JSON reader,
// whose error contract differs.)
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "./frontmatter";

/** True when an integer pid is alive (process.kill(pid, 0) doesn't throw). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Read + JSON-parse a file, returning {} on any failure (missing/malformed). */
export function readJsonObj(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Parse a cron/process `*.md`'s frontmatter, returning {} on any failure. */
export function readFrontmatter(path: string): Record<string, unknown> {
  try {
    return parseFrontmatter(readFileSync(path, "utf8")).data;
  } catch {
    return {};
  }
}

/** `enabled` defaults true; only an explicit `enabled: false` disables. */
export function isEnabled(data: Record<string, unknown>): boolean {
  return data.enabled !== false;
}
