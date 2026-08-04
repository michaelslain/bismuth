// core/src/agentBackends/sandboxWrapper.ts
//
// OS-level read-deny wrapper for a non-Claude agent backend, on macOS only: wraps a spawn argv in
// `sandbox-exec` (Seatbelt) so a vault's restricted files are unreadable to the wrapped process's
// Read tool AND its Bash `cat`/`grep`, with ZERO cooperation from the wrapped CLI — the kernel VFS
// enforces it against the whole process tree. This is what gives a backend with no native per-path
// deny (opencode today; possibly an ACP agent later) a REAL gate instead of "none" — see
// docs/vault/visibility.md and the spike this is built from:
// /private/tmp/claude-501/-Users-michaelslain-Documents-dev-bismuth/28ea2c63-ba06-4a2e-b1e2-e93bc7fd4baf/scratchpad/visibility/spike-seatbelt.md
// (live-verified end to end against a real `claude` turn) and the follow-up design pass's §2.3-2.5
// (live-verified against a real `opencode run` turn — both the structured read tool AND the Bash
// fallback denied, $0 cost, opencode/deepseek-v4-flash-free).
//
// Preconditions, ALL of which must hold or the wrapper is UNAVAILABLE — the caller MUST then refuse
// the session for a restricted vault rather than spawn unwrapped (see checkSandboxWrapperAvailability):
//  - P1 `process.platform === "darwin"` AND `/usr/bin/sandbox-exec` exists on disk.
//  - P2 the backend must not apply its OWN Seatbelt profile. Verified live: Seatbelt profiles do NOT
//    nest — an inner profile that isn't byte-identical to an outer one fails the WHOLE spawn with
//    `sandbox_apply: Operation not permitted` (exit 71). Claude Code (`sandbox.enabled: true`) and
//    Codex (`codex-rs/sandboxing/src/seatbelt.rs`) both self-sandbox, so wrapping either of them is a
//    bug (a spawn that can never start), never a stronger gate. See catalog.ts's `selfSandboxes`.
//  - P3 (asserted by the CALLER, not here — see chatProviders/opencode.ts) the wrapped process must
//    be a dedicated per-session-or-per-turn process for ONE vault. opencode's shared `serve` process
//    multiplexes every vault a core process hosts, so it can never carry a profile scoped to one
//    vault's restricted files; a restricted vault must be forced onto the per-turn `run` path instead.
//  - P4 exit code 71 from a WRAPPED spawn means `sandbox_apply` itself failed to apply the profile —
//    see {@link isSandboxApplyFailure}. Treat that as a REFUSAL, never as a signal to retry the same
//    turn unwrapped: the failure means the OS-level gate never engaged, not that the CLI misbehaved.
//
// Pure profile-text/argv building ({@link buildSeatbeltProfile}, {@link wrapArgv}) is separated
// from the one effectful helper ({@link materializeSandboxProfile}) so the interesting logic is
// unit-testable with no filesystem or subprocess involved. WHICH paths a profile denies is not
// decided here — every agent spawn, this one included, resolves that from visibility.ts's
// `buildSandboxDenyPaths` so the set cannot drift between backends.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

/** Where `sandbox-exec` lives on every Mac — a normal, Apple-signed, stock part of the OS (no
 *  install needed). It carries a decade-old "(DEPRECATED)" man-page label with no runtime warning
 *  on any invocation (verified — see spike-seatbelt.md §6); Bismuth's existing, shipped, Claude-only
 *  `sandbox.filesystem.denyRead` almost certainly rests on the same substrate already, so this
 *  isn't a new platform risk, just an explicit one. Overridable only for tests. */
export const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

/** `sandbox_apply` failed — Seatbelt could not apply THIS profile to the spawned process (most
 *  commonly: nesting inside an already-sandboxed parent — see P2/P4 above). MUST be surfaced as a
 *  refusal, never treated as an ordinary nonzero exit to retry unwrapped. */
export const SANDBOX_APPLY_FAILURE_EXIT_CODE = 71;

export function isSandboxApplyFailure(exitCode: number | null | undefined): boolean {
  return exitCode === SANDBOX_APPLY_FAILURE_EXIT_CODE;
}

export interface SandboxWrapperCheckOpts {
  /** Test seam — defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Test seam — defaults to {@link SANDBOX_EXEC_PATH}. */
  sandboxExecPath?: string;
  /** The backend's own `catalog.ts` `selfSandboxes` flag (P2). */
  selfSandboxes?: boolean;
}

/** Named so a refusal message can explain itself precisely instead of a bare "unavailable". */
export type SandboxWrapperUnavailableReason = "unsupported-platform" | "sandbox-exec-missing" | "backend-self-sandboxes";

export type SandboxWrapperAvailability = { available: true } | { available: false; reason: SandboxWrapperUnavailableReason };

/**
 * Assert every precondition (P1, P2) rather than assume them. Order matters only for which reason
 * a caller sees first when multiple fail; darwin is checked first because it's the cheapest and
 * most common reason on this codebase's non-macOS CI/dev hosts.
 */
export function checkSandboxWrapperAvailability(opts: SandboxWrapperCheckOpts = {}): SandboxWrapperAvailability {
  if ((opts.platform ?? process.platform) !== "darwin") return { available: false, reason: "unsupported-platform" };
  if (opts.selfSandboxes) return { available: false, reason: "backend-self-sandboxes" };
  if (!existsSync(opts.sandboxExecPath ?? SANDBOX_EXEC_PATH)) return { available: false, reason: "sandbox-exec-missing" };
  return { available: true };
}

/** Convenience boolean form of {@link checkSandboxWrapperAvailability}. */
export function sandboxWrapperAvailable(opts: SandboxWrapperCheckOpts = {}): boolean {
  return checkSandboxWrapperAvailability(opts).available;
}

/** A short, user-facing explanation of why the wrapper can't run — for a refusal message. Never
 *  claims a mechanism that wasn't checked. */
export function describeSandboxWrapperUnavailable(reason: SandboxWrapperUnavailableReason): string {
  switch (reason) {
    case "unsupported-platform":
      return "the OS read-deny sandbox is only available on macOS";
    case "sandbox-exec-missing":
      return "the OS read-deny sandbox (sandbox-exec) is not present on this machine";
    case "backend-self-sandboxes":
      return "this backend applies its own OS sandbox, which can't be nested inside another one";
  }
}

/** Escape a path for a Seatbelt profile string literal: backslash first (so a literal backslash in
 *  a later quote-escape isn't double-escaped), then the double quote. The profile language is a
 *  Scheme-like S-expression grammar with C-style string escapes. */
function seatbeltQuote(path: string): string {
  return `"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * PURE. One `(deny file-read* (subpath …))` clause per denied path, wrapped in a permissive-except
 * profile (`(allow default)` + N carve-outs) — verified against a real 3000-rule / 530 KB profile
 * with no practical size limit (spike-seatbelt.md's follow-up pass §2.3 R3).
 *
 * `subpath`, not `literal`, for EVERY entry — including individual files, not just the vault's
 * `.git` directory. On a real filesystem entry with no descendants (an ordinary restricted file)
 * `subpath` and `literal` deny the identical single path; the difference only shows up on a
 * directory, where `literal` blocks nothing but the directory entry's own listing/stat while files
 * inside it read totally fine — verified live (spike-seatbelt.md §4) — so `subpath` is the only
 * primitive that correctly covers `.git`'s contents. Using it uniformly avoids having to classify
 * each path as file-vs-directory here.
 *
 * Deduplicates and sorts its input first so the SAME logical deny set always produces byte-identical
 * profile text regardless of the caller's array order — this is what makes
 * {@link materializeSandboxProfile}'s content-addressed reuse actually reuse instead of rewriting a
 * new file every call for no reason.
 */
export function buildSeatbeltProfile(denyPaths: string[]): string {
  const unique = Array.from(new Set(denyPaths)).sort();
  const lines = ["(version 1)", "(allow default)", ...unique.map((p) => `(deny file-read* (subpath ${seatbeltQuote(p)}))`)];
  return `${lines.join("\n")}\n`;
}

/**
 * PURE. Prefix a spawn argv with the `sandbox-exec -f <profile>` wrapper. Returns `argv` UNCHANGED
 * when `profilePath` is null — an unrestricted vault (nothing to deny) must never pay sandbox-exec's
 * spawn overhead or its exit-71 risk, and a caller with no profile (wrapper unavailable) must not
 * silently wrap with nothing, which would be indistinguishable from "protected" while doing nothing.
 */
export function wrapArgv(argv: string[], profilePath: string | null, sandboxExecPath: string = SANDBOX_EXEC_PATH): string[] {
  if (!profilePath) return argv;
  return [sandboxExecPath, "-f", profilePath, ...argv];
}

/** `<vault>/.daemon/tmp` — where a materialized profile lives. Reused across turns whose deny set
 *  is byte-identical (content-addressed by {@link materializeSandboxProfile}); a vault whose
 *  restricted-note set keeps changing across turns accumulates one file per distinct set with no
 *  pruning here — small, static text files, and out of this module's scope to garbage-collect. */
function profileDir(vaultRoot: string): string {
  return join(vaultRoot, ".daemon", "tmp");
}

/**
 * Effectful: write a Seatbelt profile for `denyPaths` to a content-addressed file under
 * `<vaultRoot>/.daemon/tmp/visibility-<hash>.sb`, mode 0600 (this profile's text is never sensitive
 * on its own — it names restricted paths, not their contents — but 0600 costs nothing and matches
 * the run-record's own posture). An unchanged deny set reuses the same file rather than rewriting
 * it turn after turn. Returns null when there is nothing to deny — the caller's signal that
 * {@link wrapArgv} should leave the spawn unwrapped.
 */
export async function materializeSandboxProfile(vaultRoot: string, denyPaths: string[]): Promise<string | null> {
  if (denyPaths.length === 0) return null;
  const profile = buildSeatbeltProfile(denyPaths);
  const hash = createHash("sha256").update(profile).digest("hex").slice(0, 16);
  const dir = profileDir(vaultRoot);
  const path = join(dir, `visibility-${hash}.sb`);
  await mkdir(dir, { recursive: true });
  await writeFile(path, profile, { mode: 0o600 });
  return path;
}
