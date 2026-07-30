// core/test/support/openclawGateway.ts
// Test-only harness: spawns a REAL local `openclaw gateway run` process so openclawMocked.test.ts can
// drive `openclaw acp` (the ACP bridge Bismuth's own chatProviders/acp/driver.ts spawns) end to end
// with ZERO real account contact. This is the piece backendEnv.ts's `openclaw` case comment used to
// flag as "not completed within this task's time budget" — `openclaw acp` is documented as "a THIN
// BRIDGE to a separately-running (or auto-started) Gateway process" (its own --help: "Run an ACP
// bridge backed by the Gateway"), and this module is what stands that Gateway up.
//
// CONFIRMED LIVE (offline-testing openclaw task), reading the installed package directly
// (`~/`openclaw`'s `dist/acp-cli-BQ740PFm.js`'s `serveAcpGateway`/`buildGatewayConnectionDetails` in
// `dist/call-CQbSO4Fr.js`): the ACP bridge does NOT auto-start a Gateway. It connects, as a WebSocket
// CLIENT, to whatever `gateway.remote.url` config or `OPENCLAW_GATEWAY_URL` env resolves to, falling
// back to a hardcoded local-loopback default `ws://127.0.0.1:<gateway.port ?? 18789>` when neither is
// set — and simply fails (`gatewayReady` rejects) if nothing is listening there. So the bridge and a
// separately-run `openclaw gateway run` (this module) MUST agree on the same port via the SAME shared
// `OPENCLAW_CONFIG_PATH` config file's `gateway.port` — backendEnv.ts's `openclaw` case writes that
// file; this module only spawns/waits-for-ready/tears-down the Gateway process itself, mirroring
// mockLlm.ts's own spawn+banner-race+kill shape exactly (that file's own header: "Do not invent a
// different lifecycle shape for what is the same spawn+banner problem" — this is the same problem
// again, just a different child binary).
//
// READINESS SIGNAL: observed live, `openclaw gateway run` prints
// "[gateway] listening on ws://127.0.0.1:<port>, ws://[::1]:<port> (PID <pid>)" to stdout once its
// WebSocket server is actually accepting connections — that is what LISTEN_BANNER_RE waits for below,
// exactly the same "watch stdout for a banner within a timeout" technique mockLlm.ts/opencodeServer.ts
// already use for their own child processes.
//
// PROCESS TREE: `openclaw gateway run` is NOT a single process — it's a short-lived `openclaw`
// launcher (the direct child Bun.spawn returns a handle to) that itself spawns/execs a
// longer-lived `openclaw-gateway` process (visible via `ps` as a distinct, self-renamed PID.
// CONFIRMED LIVE: sending SIGTERM to the DIRECT CHILD (the handle this module holds) reliably brings
// down the grandchild too (the launcher forwards the signal / waits and exits) — verified via `ps`
// showing zero matching processes within 2s of a plain `proc.kill()`. No process-group tricks needed.
// stop() still races a grace-period timeout and escalates to SIGKILL as defense-in-depth (the same
// belt-and-suspenders posture mockLlm.ts's stopProcess takes), and the TEST FILE's own afterEach does
// an independent `ps`-based verification per this task's brief ("verify with ps that nothing
// survives") rather than trusting this module's resolution alone — `pid` below (the direct child's,
// i.e. the launcher's own pid — the one `ps` showed the grandchild's teardown rides along with) is
// what that check uses; it is NOT the renamed `openclaw-gateway` grandchild's own pid.
//
// CONFIG HYGIENE FINDING (not fully solved here, called out for the caller): a completely bare config
// makes `openclaw gateway run` perform a real outbound update-check HTTP request on startup
// (`[gateway] update available (latest): v2026.7.1-2 ...` was observed live) — NOT an account call
// (no auth, no login), but still real unwanted network egress from a test process. backendEnv.ts's
// `openclaw` case sets `update.checkOnStart: false` / `update.auto.enabled: false` in the config it
// writes specifically to suppress this; confirmed live that no such log line appears once set. This
// module does not re-verify that itself (it only owns the process, not the config content) — it
// relies on the caller (openclawMocked.test.ts, via backendMockEnv) having done so.
import { createServer } from "node:net";
import { whichBinary } from "../../src/claudeWhich";

/** Observed live: "[gateway] listening on ws://127.0.0.1:<port>, ws://[::1]:<port> (PID <pid>)" — a
 *  plain console log tag, not a documented contract, so this only anchors on the stable "listening on
 *  <url>" fragment, same defensiveness as mockLlm.ts's own LISTEN_BANNER_RE. Captures the FIRST
 *  URL's port specifically (group 1) — startOpenclawGateway compares it against the port the caller
 *  actually asked for (the same one written into `gateway.port` in the shared config) and fails loud
 *  on a mismatch, rather than reporting ready on any "listening on" line regardless of which port.
 *  Readiness itself is genuinely observed (a real banner from a real process, not a fixed timer), but
 *  without this comparison a gateway that silently ignored the configured port would still report
 *  ready here and only surface later as an opaque ACP-connect error with no link back to the cause. */
const LISTEN_BANNER_RE = /\[gateway\][^\n]*listening on\s+wss?:\/\/[^:\s]+:(\d+)/;

/** Generous relative to opencodeServer.ts's 8s / mockLlm.ts's 15s — the Gateway does more startup
 *  work (heartbeat, health monitor, model-provider registration) than either of those. */
const STARTUP_TIMEOUT_MS = 20_000;

/** How long stop() waits for a graceful exit (SIGTERM) before escalating to SIGKILL. */
const STOP_GRACE_MS = 5_000;

/** Mirrors mockLlm.ts's own liveProcs/killAllLiveProcs pattern exactly — defense-in-depth for a
 *  plain `bun run`/standalone host process; NOT relied on as the primary teardown path under
 *  `bun test` (see openclawMocked.test.ts's own afterAll, which awaits stop() directly and this
 *  module's header note on why `process.on("exit")` alone is not trustworthy there). Registered
 *  once at module load, not per start() call. */
const liveProcs = new Set<ReturnType<typeof Bun.spawn>>();
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
process.on("exit", killAllLiveProcs);

export interface OpenclawGatewayHandle {
  /** The DIRECT child's pid (the short-lived `openclaw` launcher — see this module's header's
   *  PROCESS TREE note) — NOT the renamed `openclaw-gateway` grandchild's own pid. Exposed so a
   *  caller can do an OWNED `ps -p <pid>` check after stop() resolves, rather than a machine-wide
   *  `pgrep -f` that could just as easily match an unrelated `openclaw gateway run` a developer
   *  started themselves (the product's own normal deployment — it ships a `service` installer). */
  pid: number;
  /** Kill the Gateway process (and, per this module's header, its grandchild) and resolve once
   *  fully exited. Idempotent-safe to call more than once. */
  stop(): Promise<void>;
}

/**
 * Get a free TCP port by binding an ephemeral listener and immediately closing it. Racy in
 * principle (another process could grab the same port before `openclaw gateway run` binds it) —
 * the same accepted trade-off every "port 0, then reuse the assigned number" pattern makes when the
 * target tool (unlike llmock's `-p 0`) has no literal "auto-assign" mode of its own (confirmed live:
 * `openclaw gateway run --port 0` is REJECTED by its own config validation, "gateway.port: Too small:
 * expected number to be >0").
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("getFreePort: could not read the assigned ephemeral port"));
      });
    });
  });
}

/**
 * Spawn `openclaw gateway run` pointed at the given (already-isolated) config/state env, resolving
 * once its readiness banner has been observed on stdout AND that banner's own port matches
 * `expectedPort` (see LISTEN_BANNER_RE's doc comment for why the comparison matters, not just the
 * banner's presence). Rejects (never resolves a broken handle) on a spawn failure, a missing binary,
 * a startup timeout, or a port mismatch — same fail-loud contract as mockLlm.ts's startMockLlm.
 *
 * `env` must already carry `OPENCLAW_CONFIG_PATH`/`OPENCLAW_STATE_DIR` pointed at throwaway temp
 * dirs (see backendEnv.ts's `openclaw` case) — this function does not choose or validate isolation
 * itself, only spawns/waits/tears down the process. `expectedPort` must be the SAME port already
 * written into that config's `gateway.port` (see backendMockEnv's `openclaw` case, which is where a
 * caller gets both from the same `getFreePort()` call).
 */
export function startOpenclawGateway(env: Record<string, string | undefined>, expectedPort: number): Promise<OpenclawGatewayHandle> {
  return new Promise((resolve, reject) => {
    const bin = whichBinary("openclaw");
    if (!bin) {
      reject(new Error("startOpenclawGateway: no `openclaw` binary resolved on PATH — caller must gate on whichBinary(\"openclaw\") first."));
      return;
    }
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      // No `--allow-unconfigured`: confirmed live it's unnecessary (and its own --help says it's
      // specifically for starting WITHOUT `gateway.mode=local` in config) once the written config
      // already sets `gateway.mode: "local"` explicitly (see backendEnv.ts's openclaw case) — a
      // fresh, unconfigured install's escape hatch, not something a caller who already wrote a
      // valid config needs to reach for.
      proc = Bun.spawn([bin, "gateway", "run"], { env, stdout: "pipe", stderr: "pipe" });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    liveProcs.add(proc);
    void proc.exited.finally(() => liveProcs.delete(proc)).catch(() => {});

    let settled = false;
    const finishOk = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ pid: proc.pid, stop: () => stopProcess(proc) });
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
      finishFail(new Error(`openclaw gateway did not print its listening banner within ${STARTUP_TIMEOUT_MS}ms`));
    }, STARTUP_TIMEOUT_MS);

    let stderrTail = "";
    void (async () => {
      try {
        const decoder = new TextDecoder();
        for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
          stderrTail = (stderrTail + decoder.decode(chunk, { stream: true })).slice(-4000);
        }
      } catch {
        /* best-effort diagnostic capture only */
      }
    })();

    void (async () => {
      let pending = "";
      const decoder = new TextDecoder();
      try {
        for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
          if (settled) return;
          pending += decoder.decode(chunk, { stream: true });
          const m = LISTEN_BANNER_RE.exec(pending);
          if (m) {
            const bannerPort = Number(m[1]);
            if (bannerPort !== expectedPort) {
              finishFail(
                new Error(
                  `openclaw gateway printed its listening banner on port ${bannerPort}, not the requested ${expectedPort} ` +
                    `(gateway.port in the config it read) — refusing to report ready against the wrong port.`,
                ),
              );
              return;
            }
            finishOk();
            return;
          }
        }
      } catch {
        /* stdout torn down before the banner appeared — fall through to the exit-driven failure below */
      }
      finishFail(new Error(`openclaw gateway exited before printing its listening banner. stderr tail:\n${stderrTail}`));
    })();

    proc.exited
      .then(() => finishFail(new Error(`openclaw gateway exited before printing its listening banner. stderr tail:\n${stderrTail}`)))
      .catch(() => {});
  });
}

/** Graceful SIGTERM, escalating to SIGKILL after STOP_GRACE_MS if the process (and, per this
 *  module's header, its grandchild) hasn't exited yet. Always resolves once `proc.exited` settles,
 *  so the caller's next assertion never races a still-shutting-down Gateway holding its port. */
async function stopProcess(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  try {
    proc.kill();
  } catch {
    /* already exited */
  }
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), STOP_GRACE_MS)),
  ]);
  if (timedOut) {
    try {
      proc.kill(9);
    } catch {
      /* already exited */
    }
    await proc.exited;
  }
}
