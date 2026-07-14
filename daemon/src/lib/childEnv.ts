import { homedir } from "node:os"
import { join } from "node:path"

// Install dirs a daemon-spawned worker's PATH MUST contain so a bare `bismuth` (Feature #51's
// `checkpoint diff/advance` change-scoping) — and other user CLIs the model shells out to —
// resolve, INDEPENDENT of the minimal PATH launchd/systemd hands the daemon process itself.
//
// The bug (Bug #105): a Finder-launched GUI app inherits launchd's bare PATH
// (`/usr/bin:/bin:/usr/sbin:/sbin`) and, at daemon-install time, bakes it into the launchd plist's
// EnvironmentVariables > PATH. The daemon then hands that same PATH to every cron worker it spawns,
// so the worker's Bash never sees the bismuth CLI and each `bismuth checkpoint …` fails with
// "command not found". The dream / vault-review crons then silently fall back to re-surveying the
// WHOLE vault/memory every run and their checkpoints never advance.
//
// The GUI app installs the bismuth CLI to `~/.bismuth/bin` and symlinks it onto `/usr/local/bin`
// (core/src/bismuthInstall.ts); Homebrew lives in `/opt/homebrew/bin` (Apple Silicon) or
// `/usr/local/bin` (Intel). Cross-machine — resolved from `os.homedir()`, never a hardcoded user.
// Pure over `home` for testability (accepts an override).
export function extraBinDirs(home: string = homedir()): string[] {
  return [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    join(home, ".bismuth", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".local", "bin"),
  ]
}

// Return `parentPath` with every extraBinDir appended that isn't already present, de-duplicated,
// PARENT ENTRIES FIRST — an explicitly-set PATH keeps its precedence; the daemon-critical install
// dirs are only ever ADDED as fallbacks, never allowed to shadow the parent. Pure: no fs existence
// checks, so a bare parent PATH ALWAYS yields a PATH containing the three critical install dirs —
// the property the daemon relies on at both the spawn layer (child env) and the plist layer.
export function augmentPath(parentPath: string | undefined, home: string = homedir()): string {
  const parts = (parentPath ?? "").split(":").filter(Boolean)
  const seen = new Set(parts)
  for (const dir of extraBinDirs(home)) {
    if (!seen.has(dir)) {
      seen.add(dir)
      parts.push(dir)
    }
  }
  return parts.join(":")
}
