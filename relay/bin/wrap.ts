#!/usr/bin/env bun
// Generic session reporter for "wrapper"-mode agent-CLI backends (BackendCapabilities.agentsGraph
// === "wrapper" in core/src/agentBackends/catalog.ts): CLIs with no hook/plugin system of their
// own, so the PTY shim wrapping the binary is the ONLY telemetry path into the agents graph —
// unlike claude, which reports itself via real hooks (relay/hooks/hooks.json) and needs none of
// this.
//
// Usage: bun run wrap.ts <backendId> <realBinaryPath> [args…]
//
// Wired up by core/src/terminal.ts's shimSpecsFor(): a "wrapper"-mode entry's zsh function (or,
// for non-zsh shells, its relay/shim/agent-shim symlink) execs THIS script instead of the real
// binary directly, with the real binary's resolved path as an argv, so this can run it with
// inherited stdio while reporting around it.
//
// NEVER wraps Claude Code — see the guard below. Claude has real hooks and is a daily driver for
// most users; adding a process layer to it would be pure risk (signal handling, tty ownership,
// exit-code fidelity) for zero telemetry gain, since it already reports itself better than a
// wrapper ever could. Structurally this should never even be reached for claude (its
// agentsGraph capability is "hooks", so shimSpecsFor never emits a "wrapper" spec for it, and
// nothing symlinks "claude" at relay/shim/agent-shim) — the guard here is defense in depth for a
// misconfigured invocation, not the primary safeguard.
//
// Same discipline as relay/lib/report.ts's hooks: reporting is best-effort (short timeout, every
// error swallowed, never blocks or fails the user's session). Reuses that module's `terminalId`/
// `postRelay` rather than duplicating them. Unlike a hook script, though, this process's OWN
// exit-code/signal fidelity matters — it lives for the CLI's whole interactive session, not a
// single quick hook invocation, so (unlike lib/report.ts's `runHook`) it must relay the real
// binary's actual exit code and forward interactive signals (Ctrl+C, `kill`) to it, not just
// exit 0 quickly.
import { randomUUID } from "node:crypto";
import { terminalId, postRelay } from "../lib/report.ts";

const [backendId, realBinaryPath, ...args] = process.argv.slice(2);

if (!backendId || !realBinaryPath) {
  console.error("bismuth wrap: usage: wrap.ts <backendId> <realBinaryPath> [args…]");
  process.exit(127);
}

const sessionId = randomUUID();
const tid = terminalId();
// Report only when launched from a Bismuth terminal tab (the same gate every relay hook uses) AND
// never for claude (see header) — a stray/misconfigured invocation degrades to "run transparently,
// report nothing" rather than either failing the session or wrapping the one CLI that must not be.
const shouldReport = Boolean(tid) && backendId !== "claude";

if (shouldReport) {
  await postRelay("/relay/session", { sessionId, terminalId: tid, cwd: process.cwd(), backend: backendId });
}

let child: ReturnType<typeof Bun.spawn>;
try {
  child = Bun.spawn([realBinaryPath, ...args], {
    stdio: ["inherit", "inherit", "inherit"],
  });
} catch (err) {
  // Mirror what the shell would print for a bad exec, rather than a raw stack trace — the user
  // typed a command name, not "run this wrapper".
  console.error(`bismuth wrap: failed to run '${realBinaryPath}': ${err instanceof Error ? err.message : err}`);
  process.exit(127);
}

// Ctrl+C/terminate must reach the CLI, not just this wrapper. Registering a handler suppresses
// Node/Bun's default terminate-on-signal action for THIS process, so the wrapper survives long
// enough to forward the signal, await the child's real exit, and report session end — instead of
// the wrapper dying first and leaving the child's fate (and our own cleanup) to chance. Verified
// end to end against a stub child (a bash script trapping SIGINT/SIGTERM) with real `kill -INT`/
// `-TERM` against the wrapper's own pid: the child received the forwarded signal and the wrapper
// relayed its exact exit code.
const forward = (sig: NodeJS.Signals) => {
  try {
    child.kill(sig);
  } catch {
    // child already gone
  }
};
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));

// child.exited already encodes signal termination as 128+N (verified: a SIGTERM-killed child
// resolves to 143) — the same convention a shell reports, so no extra branching is needed here.
const exitCode = await child.exited;

if (shouldReport) {
  await postRelay("/relay/session/end", { sessionId });
}

process.exit(exitCode);
