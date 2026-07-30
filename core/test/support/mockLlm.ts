// core/test/support/mockLlm.ts
// Test-only harness: spawns a REAL local mock LLM server so integration tests can drive real
// agent CLIs end-to-end with ZERO real model API calls. Every backend under test (core/test/
// support/backendEnv.ts) gets pointed at this one server via env vars instead of the real
// provider's API host.
//
// PRECEDENT: this follows core/src/chatProviders/opencodeServer.ts's shape exactly (that file
// already solved "spawn a CLI-provided server, detect readiness from a stdout banner within a
// timeout, tear down on process exit" for `opencode serve`) — free "port 0" + Bun.spawn + a
// banner-regex race against a timeout + a stop() that kills the child. Do not invent a different
// lifecycle shape for what is the same spawn+banner problem.
//
// THE MOCK SERVER: package `@copilotkit/aimock` (a core devDependency), binary name `llmock` —
// NOT `aimock` (that name is a *different* bin in the same package, for a different subcommand
// set). Verified live on this machine:
//   - It prints `[aimock] aimock server listening on http://127.0.0.1:<port>` on stdout once
//     ready — that is the readiness signal this module waits for. Passing `-p 0` lets the OS
//     assign a free port, exactly like opencodeServer.ts's `--port 0`.
//   - ONE fixture set answers EVERY provider's wire shape on the SAME port: the same
//     `{"match":{"userMessage":"hello"},"response":{"content":"Hello!"}}` fixture was verified
//     to answer both an Anthropic-shaped `POST /v1/messages` (Claude Code's own wire format) and
//     an OpenAI-shaped `POST /v1/chat/completions` (Codex/goose/etc's) with the fixture's exact
//     text — so this one server is what backendEnv.ts's whole per-CLI mapping can point at,
//     regardless of which wire protocol a given backend actually speaks.
//
// WHY NOT `bunx llmock` / `npx -p @copilotkit/aimock llmock`: tried first, and it is a real
// landmine — resolution is CWD-dependent, and when the spawning process's cwd has no local
// `node_modules` containing `@copilotkit/aimock` (e.g. `bun test` invoked from the repo root
// rather than from `core/`), `bunx`/`npx` silently fall back to resolving the bare name `llmock`
// from a GLOBAL package cache/registry instead of erroring — and on the machine this was
// developed on, an entirely UNRELATED npm package also happens to be named `llmock` (a different
// LLM mock server, v3.3.4, already sitting in this machine's bun global cache from an unrelated
// project). That package silently started too — different banner text, different default port,
// different behavior — with no error at all. Exactly the "silently launches the wrong thing"
// failure mode this whole harness exists to prevent. Instead, this module resolves the EXACT
// installed `@copilotkit/aimock`'s own `bin.llmock` entry via `Bun.resolveSync` anchored at
// `import.meta.dir` (this module's own on-disk location, NOT the calling process's cwd — so
// resolution is deterministic regardless of what invoked the test), and spawns that exact file
// with `node` directly. No ambiguous bare-name lookup anywhere in the path.
//
// SAFETY: startMockLlm() REJECTS (never hangs, never resolves a "maybe it's fine" handle) if the
// banner never arrives within STARTUP_TIMEOUT_MS. A test harness whose mock failed to start must
// fail loud immediately, not silently let a caller's CLI fall through to a real API — the same
// property the task brief calls out for a misconfigured ANTHROPIC_BASE_URL.
//
// ORPHAN SAFETY NET: mirrors opencodeServer.ts's own `process.on("exit", shutdownAll)` — every
// spawned child is tracked in a module-level `liveProcs` Set (registered once, not per call, so a
// suite starting many servers doesn't accumulate `process` listeners) and killed on this host
// process's own exit, so a test that throws before reaching stop() (a genuine crash, not just a
// failed assertion) can't leave an orphaned `node .../aimock/dist/cli.js` holding its port forever
// — reproduced live: without this, exactly that happened.
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";

/** Every child this process has spawned and not yet confirmed exited. `process.on("exit", …)`
 *  below kills whatever's still in here when this host process itself is going down — whether
 *  from a normal end-of-suite exit, an explicit process.exit(), or an uncaught exception crashing
 *  the process (Node/Bun both still fire "exit" in that case). */
const liveProcs = new Set<ReturnType<typeof Bun.spawn>>();

/** Kill every still-tracked child. Safe to call more than once and safe to call on a child that
 *  already exited on its own (proc.kill() on a dead process is a no-op/rejects internally in Bun —
 *  either way wrapped in try/catch here, same idiom as opencodeServer.ts's shutdownAll) — an
 *  already-stopped server must never make this throw. */
function killAllLiveProcs(): void {
  for (const proc of liveProcs) {
    try {
      proc.kill();
    } catch {
      /* already exited */
    }
  }
  liveProcs.clear();
}
// Registered ONCE at module load, not per startMockLlm() call — this module is imported once per
// test file/process, so this never accumulates listeners across however many servers a suite
// starts (which would otherwise trip Node's max-listeners warning).
process.on("exit", killAllLiveProcs);

/** How long to wait for the "aimock server listening on <url>" banner before giving up. Generous
 *  relative to opencodeServer.ts's 8s to leave headroom on a loaded CI machine's first `node`
 *  process spawn of a test run. */
const STARTUP_TIMEOUT_MS = 15_000;

/** Observed live: "[aimock] aimock server listening on http://127.0.0.1:<port>". The `[aimock] `
 *  prefix is a plain console.log tag, not a documented contract, so the regex only anchors on the
 *  stable "... server listening on <url>" suffix — same defensiveness as opencodeServer.ts's own
 *  LISTEN_BANNER_RE against a similarly-unversioned banner string. */
const LISTEN_BANNER_RE = /aimock server listening on\s+(https?:\/\/\S+)/;

/** The default fixture directory every test gets if it doesn't supply its own. */
export const DEFAULT_FIXTURE_DIR = join(import.meta.dir, "..", "fixtures", "llm");

export interface MockLlmHandle {
  /** Base URL of the running mock server, e.g. "http://127.0.0.1:54231". */
  url: string;
  /** Kill the server and resolve once the process has fully exited (so the OS has released the
   *  port before the caller's next assertion). Idempotent-safe to call once. */
  stop(): Promise<void>;
}

/**
 * Resolve the exact `llmock` entry point of THIS project's own `@copilotkit/aimock`
 * devDependency — never a bare `llmock`/`bunx llmock`/`npx llmock` name lookup (see this file's
 * header for why that's unsafe). Anchored at `import.meta.dir` (this module's own on-disk
 * location) rather than any ambient cwd, so it resolves identically no matter which directory
 * `bun test` was invoked from.
 */
function resolveLlmockBin(): string {
  const pkgJsonPath = Bun.resolveSync("@copilotkit/aimock/package.json", import.meta.dir);
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { bin?: Record<string, string> };
  const rel = pkg.bin?.llmock;
  if (!rel) throw new Error("@copilotkit/aimock's package.json has no \"llmock\" bin entry — package layout changed?");
  return join(dirname(pkgJsonPath), rel);
}

/**
 * Start a local mock LLM server rooted at `fixtureDir` (defaults to {@link DEFAULT_FIXTURE_DIR}),
 * resolving once its readiness banner has been observed on stdout. Rejects (never resolves a
 * broken handle) on a spawn failure, an unrecognized/missing `llmock`, or a startup timeout.
 */
export function startMockLlm(fixtureDir: string = DEFAULT_FIXTURE_DIR): Promise<MockLlmHandle> {
  return new Promise((resolve, reject) => {
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      const bin = resolveLlmockBin();
      // Spawned via `node <resolved cli.js>` rather than relying on the file's own shebang +
      // execute bit (portable across filesystems/platforms where that bit might not survive).
      proc = Bun.spawn(["node", bin, "-p", "0", "-f", fixtureDir], {
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // Tracked from the moment it exists — even a child that never prints its banner (timeout, or
    // an immediate startup failure) still gets caught by the exit-time safety net until its own
    // `proc.exited` resolves and untracks it below.
    liveProcs.add(proc);
    void proc.exited.finally(() => liveProcs.delete(proc)).catch(() => {});

    let settled = false;
    const finishOk = (url: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ url, stop: () => stopProcess(proc) });
    };
    const finishFail = (reason: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
      reject(reason);
    };

    const timer = setTimeout(() => {
      finishFail(new Error(`mock LLM server ("llmock") did not print its listening banner within ${STARTUP_TIMEOUT_MS}ms`));
    }, STARTUP_TIMEOUT_MS);

    void (async () => {
      let pending = "";
      const decoder = new TextDecoder();
      try {
        for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
          if (settled) return;
          pending += decoder.decode(chunk, { stream: true });
          const m = pending.match(LISTEN_BANNER_RE);
          if (m) {
            finishOk(m[1]);
            return;
          }
        }
      } catch {
        /* stdout torn down before the banner appeared — fall through to the exit-driven failure below */
      }
      finishFail(new Error('mock LLM server ("llmock") exited before printing its listening banner'));
    })();

    proc.exited
      .then(() => finishFail(new Error('mock LLM server ("llmock") exited before printing its listening banner')))
      .catch(() => {});
  });
}

/** Kill the child and wait for it to fully exit, so the port is released before this resolves. */
async function stopProcess(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  try {
    proc.kill();
  } catch {
    /* already exited */
  }
  await proc.exited;
}
