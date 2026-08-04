// core/src/agentBackends/doctor.ts
// "Which agent backends actually work on THIS machine?"
//
// Bismuth's backend catalog declares what each CLI *can* do. That is a claim about the CLI, not
// about this computer: the binary may be absent, or a version too old for the flag a driver passes.
// Most of these CLIs could not be exercised on the machine where their drivers were written, so
// this probe exists to close that gap — it is the difference between "we believe cline works" and
// "cline 3.0.47 answered `--version` here".
//
// Deliberately CHEAP and SAFE. It resolves the binary and asks for a version string; it never runs
// an agent turn, never authenticates, never spends money, never starts a daemon/gateway/hub, and
// never writes to a config file. A backend that needs credentials still reports `installed: true` —
// login state is the CLI's business, and asking would mean spending tokens.
import { BACKEND_LIST, type BackendCapabilities, type BackendDescriptor } from "./catalog";
import { whichBinary } from "../claudeWhich";
import { ACP_AGENTS } from "../chatProviders/acp/agents";

/** How long any one `--version` probe may take before we call it unresponsive. */
const PROBE_TIMEOUT_MS = 5_000;

export interface BackendReport {
  id: string;
  label: string;
  binary: string;
  /** Resolved absolute path, or null when the binary isn't on the augmented lookup PATH. */
  path: string | null;
  installed: boolean;
  /** First line of the CLI's version output, when it answered. Null when absent or unresponsive. */
  version: string | null;
  /** Set when the binary exists but the probe failed (timeout, non-zero exit, empty output) — the
   *  interesting case, because it means the CLI is present but not behaving as a driver expects. */
  problem?: string;
  /**
   * Set for a backend that is a protocol ADAPTER fetched on demand rather than an installed CLI —
   * the npx-invoked ACP bridges. Their `binary` is the package RUNNER (`npx`), so probing it would
   * report npm's own version as the backend's and call the backend "installed" when the adapter
   * package may never have been fetched. Naming the package instead is the honest answer.
   */
  adapterPackage?: string;
  /** Which surfaces this backend claims, summarised for a human reading a table. */
  surfaces: {
    chat: boolean;
    terminal: boolean;
    relayReporting: BackendCapabilities["relayReporting"];
    daemon: boolean;
    mcp: BackendCapabilities["mcp"];
    memory: BackendCapabilities["memory"];
  };
  installHint?: string;
}

/** Pure: project a descriptor's capabilities into the report's surface summary. */
export function surfaceSummary(d: BackendDescriptor): BackendReport["surfaces"] {
  const c = d.capabilities;
  return {
    chat: c.chat,
    terminal: c.terminal,
    relayReporting: c.relayReporting,
    daemon: c.daemon,
    mcp: c.mcp,
    memory: c.memory,
  };
}

/**
 * Pure: the adapter package a backend is fetched as, or null for a normally-installed CLI.
 *
 * The npx-invoked ACP bridges (claude-code-acp, codex-acp) list `npx` as their binary, so a version
 * probe resolves npm and reports ITS version as the backend's — observed live as every adapter
 * claiming version "11.11.0" behind a confident ✓. There is nothing meaningful to probe for these:
 * npx fetches the package on first use, so "is it installed" has no answer before then, and
 * inventing one errs in the direction that hurts — a ✓ beside a backend that may not run.
 */
export function adapterPackageFor(id: string): string | null {
  const spec = ACP_AGENTS.find((a) => a.id === id);
  if (!spec?.adapter) return null;
  // The package is the first non-flag arg (`["-y", "@scope/pkg"]` → `@scope/pkg`).
  return spec.args.find((a) => !a.startsWith("-")) ?? null;
}

/**
 * Pure: the argv that asks a CLI for its version.
 *
 * `--version` is near-universal, but not quite: a few CLIs only implement a `version` subcommand.
 * Kept as data so a wrong guess is a one-line fix rather than a code change, and so the choice is
 * visible and testable instead of buried in a spawn call.
 */
export function versionArgs(binary: string): string[] {
  switch (binary) {
    // openclaw's own help documents `--version`; it also has no `version` subcommand.
    case "openclaw":
      return ["--version"];
    default:
      return ["--version"];
  }
}

/** Pure: reduce a probe's raw result to the report's `version`/`problem` pair. Separated from the
 *  spawn so every branch — clean output, empty output, non-zero exit, timeout — is unit-testable. */
export function interpretProbe(r: {
  timedOut?: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}): { version: string | null; problem?: string } {
  if (r.timedOut) return { version: null, problem: `no response within ${PROBE_TIMEOUT_MS}ms` };
  // Some CLIs print their version to stderr; accept either rather than calling a working CLI broken.
  const text = `${r.stdout ?? ""}\n${r.stderr ?? ""}`
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!text) {
    return { version: null, problem: `exited ${r.exitCode ?? "?"} with no version output` };
  }
  // A non-zero exit that still printed something is reported WITH the text: that combination is
  // usually a usage error from a version flag the CLI spells differently, and the output says so.
  if (r.exitCode !== undefined && r.exitCode !== 0) {
    return { version: text, problem: `version probe exited ${r.exitCode}` };
  }
  return { version: text };
}

/** Run one `<binary> --version`, bounded and side-effect-free. Never throws. */
async function probeVersion(path: string, binary: string): Promise<{ version: string | null; problem?: string }> {
  try {
    const proc = Bun.spawn([path, ...versionArgs(binary)], {
      // Never inherit stdin: a CLI that decides to prompt would otherwise hang the probe forever.
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    }, PROBE_TIMEOUT_MS);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      // A killed child reports a signal exit; treat "nothing printed and non-zero" as the timeout.
      const timedOut = !stdout.trim() && !stderr.trim() && exitCode !== 0;
      return interpretProbe({ timedOut, exitCode, stdout, stderr });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { version: null, problem: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Probe every backend in the catalog. Concurrent — these are independent 5s-bounded spawns, and
 * doing them in series would make the command feel broken with a dozen backends.
 */
export async function checkBackends(): Promise<BackendReport[]> {
  return Promise.all(
    BACKEND_LIST.map(async (d): Promise<BackendReport> => {
      const path = whichBinary(d.binary);
      const base: BackendReport = {
        id: d.id,
        label: d.label,
        binary: d.binary,
        path,
        installed: path != null,
        version: null,
        surfaces: surfaceSummary(d),
      };
      // An npx-fetched adapter: report the PACKAGE, never the runner's version, and never a bare ✓.
      const adapterPackage = adapterPackageFor(d.id);
      if (adapterPackage) {
        return {
          ...base,
          adapterPackage,
          // `installed` describes the runner being available, which is all that can be known before
          // npx fetches the package; the table renders this as "adapter" rather than a version.
          ...(path ? {} : { installHint: d.installHint }),
        };
      }
      if (!path) return { ...base, installHint: d.installHint };
      const { version, problem } = await probeVersion(path, d.binary);
      return { ...base, version, ...(problem ? { problem } : {}) };
    }),
  );
}
