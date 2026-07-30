// core/src/chatProviders/opencodeServer.ts
// Lifecycle for the ONE persistent `opencode serve` process shared by every opencode chat this core
// process hosts — started lazily on the first opencode chat, kept alive for the rest of the
// process's life, never one-per-chat. Every request below carries a `directory` query param, so one
// server multiplexes every vault/chat this core process serves, mirroring the daemon's "one process,
// many vault brains" shape (core/src/daemon.ts).
//
// SDK-vs-raw-HTTP: this module uses @opencode-ai/sdk's TYPED CLIENT (createOpencodeClient) — the
// documented, generated-from-opencode's-own-OpenAPI-schema client, so request/response shapes for the
// calls WE build (session.create, session.prompt, session.abort, the permission-response endpoint)
// stay in sync with opencode's own releases. It deliberately does NOT use the SDK's own
// `createOpencode()` / `createOpencodeServer()` process-spawning helpers: reading their compiled
// source directly (node_modules/@opencode-ai/sdk/dist/server.js) shows they spawn via `cross-spawn`
// with `env: {...process.env}` HARD-CODED into the helper — no way to inject the augmented PATH
// (`claudeWhich.ts`'s `claudeLookupPath`/`claudeSpawnEnv`) every other Bismuth-spawned CLI needs so a
// Finder-launched bundle (a minimal launchd PATH with no Homebrew/nvm dirs) can still find the user's
// `opencode` binary. So this module resolves the binary itself (opencode.ts's `whichOpencode`) and
// spawns `opencode serve` directly via Bun.spawn + claudeSpawnEnv, exactly like every other driver in
// this codebase (chat.ts, terminal.ts, chatProviders/acp/driver.ts) — then binds the SDK's typed
// client to the resulting URL via createOpencodeClient({baseUrl}). Startup detection mirrors the
// SDK's own createOpencodeServer (read directly, same technique): watch stdout for the "opencode
// server listening on <url>" banner within a timeout; anything else (an old opencode with no `serve`
// subcommand, a parse failure, a timeout) resolves null so the caller falls back to the per-turn
// `run` path rather than breaking the provider.
//
// Event shapes verified LIVE against opencode 1.18.4 (`GET /event`, a real prompt + a real
// permission ask/reply cycle, captured byte-for-byte) differ from @opencode-ai/sdk@1.18.9's
// generated types.gen.d.ts in real, load-bearing ways:
//   - the SDK types declare a permission event as "permission.updated" with a
//     Permission{id,type,pattern,title,...} shape; the LIVE server instead emits "permission.asked"
//     with {id,permission,patterns,metadata,always,tool:{messageID,callID}} — no `type`/`title` at
//     all, "permission" instead of "type", "patterns" (plural, array) instead of "pattern".
//   - the SDK types declare streaming deltas as EventMessagePartUpdated.properties.delta; the LIVE
//     server instead emits a SEPARATE event type, "message.part.delta", shaped
//     {sessionID,messageID,partID,field,delta}.
//   - "permission.replied" carries `requestID`/`reply`, not the SDK's `permissionID`/`response`.
// So event PARSING here and in ./opencodeTranslate.ts treats every event as untyped JSON and reads
// fields defensively (never trusts the SDK's Event union for the WIRE shape). The REQUEST shapes we
// build ourselves — session.create, session.prompt, session.command, session.abort, and
// POST /session/{id}/permissions/{permissionID} — WERE independently verified live to match the
// generated types exactly, so those go through the typed client normally.
import { homedir } from "node:os";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { claudeSpawnEnv } from "../claudeWhich";

export interface OpencodeServerHandle {
  client: OpencodeClient;
  url: string;
}

/** How long to wait for the "opencode server listening on <url>" banner before giving up and
 *  falling back to the per-turn `run` path (an old opencode with no `serve` subcommand, or one
 *  that's simply slow to boot on a loaded machine). */
const STARTUP_TIMEOUT_MS = 8000;
const LISTEN_BANNER_RE = /opencode server listening on\s+(https?:\/\/\S+)/;

interface LiveServer extends OpencodeServerHandle {
  proc: ReturnType<typeof Bun.spawn>;
}

/** The one shared server for this core process, once started. */
let live: LiveServer | null = null;
/** In-flight or settled startup attempt. Deliberately NOT cleared after a startup FAILURE (an old
 *  opencode's inability to `serve` is a static fact about the installed binary — no point retrying
 *  every chat open) — only cleared after a live server later crashes (see watchExit), so a genuine
 *  mid-life crash gets one fresh retry on the next call. */
let starting: Promise<OpencodeServerHandle | null> | null = null;

/** sessionId -> the current turn's event handler. Registered by chatProviders/opencode.ts right
 *  before it sends a prompt/command, unregistered once that call settles — a session with no turn in
 *  flight has no listener, which is fine: permission asks and streaming deltas only happen mid-turn. */
const listeners = new Map<string, (ev: unknown) => void>();

export function registerOpencodeServerListener(sessionId: string, handler: (ev: unknown) => void): () => void {
  listeners.set(sessionId, handler);
  return () => {
    if (listeners.get(sessionId) === handler) listeners.delete(sessionId);
  };
}

/** Pull the opencode session id out of one raw event, whatever shape it turns out to carry — the
 *  live server's own field naming already drifted from its generated types once (see top-of-file
 *  note), so this stays defensive rather than trusting any single shape. Exported for unit testing. */
export function opencodeServerEventSessionId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const ev = raw as Record<string, unknown>;
  const props = (ev.properties && typeof ev.properties === "object" ? ev.properties : ev) as Record<string, unknown>;
  if (typeof props.sessionID === "string" && props.sessionID) return props.sessionID;
  const part = (props.part && typeof props.part === "object" ? props.part : null) as Record<string, unknown> | null;
  if (part && typeof part.sessionID === "string" && part.sessionID) return part.sessionID;
  const info = (props.info && typeof props.info === "object" ? props.info : null) as Record<string, unknown> | null;
  if (info && typeof info.sessionID === "string" && info.sessionID) return info.sessionID;
  if (info && typeof info.id === "string" && info.id && typeof ev.type === "string" && ev.type.startsWith("session.")) return info.id;
  return null;
}

/** Consume an already-ESTABLISHED global event stream for the lifetime of the process, dispatching
 *  each event to whichever session's listener (if any) is currently registered. ONE subscription for
 *  the whole server — every chat/vault this core process hosts shares it (the `directory` on the
 *  underlying GlobalEvent is not needed for routing since we dispatch by opencode session id, which
 *  is already globally unique). Self-heals nothing on stream death: the next ensureOpencodeServer()
 *  caller gets a fresh server + a fresh subscription; any turn in flight against the dead server just
 *  sees its own session.prompt()/command() call reject naturally. Deliberately takes the STREAM, not
 *  the handle, and is never awaited by ensureOpencodeServer — see subscribeToEvents below for why the
 *  SUBSCRIBE step (not this consume loop) is what callers actually need to wait for. */
async function consumeEvents(handle: LiveServer, stream: AsyncGenerator<unknown>): Promise<void> {
  try {
    for await (const gev of stream) {
      if (live !== handle) return; // superseded by a restart
      const g = gev as { payload?: unknown } | null;
      const payload = g && typeof g === "object" && "payload" in g ? g.payload : gev;
      const sid = opencodeServerEventSessionId(payload);
      if (sid) listeners.get(sid)?.(payload);
    }
  } catch {
    /* stream torn down (server exit/network hiccup) — handled by watchExit below */
  }
}

/** Open the global event SUBSCRIPTION and return once it's established (the SDK's `global.event()`
 *  resolves only after the SSE connection is live, before any events have necessarily arrived) —
 *  AWAITED by ensureOpencodeServer before it hands a handle to its first caller, so a turn sent the
 *  moment the server becomes available can never race the subscription itself (only ever a
 *  near-zero-cost concern in practice, but cheap to close outright rather than rely on timing). The
 *  actual event consumption then runs detached (consumeEvents, fire-and-forget) for the rest of the
 *  server's life. */
async function subscribeToEvents(handle: LiveServer): Promise<void> {
  const { stream } = await handle.client.global.event();
  void consumeEvents(handle, stream);
}

/** If the live server process exits on its own (crash, killed out-of-band), drop the cached handle
 *  so the NEXT ensureOpencodeServer() call spawns a fresh one rather than returning a dead client
 *  forever. A deliberate stop() (process shutdown) also exits the child, but by then nothing calls
 *  ensureOpencodeServer() again, so this is harmless either way. */
function watchExit(handle: LiveServer): void {
  handle.proc.exited
    .then(() => {
      if (live === handle) {
        live = null;
        starting = null;
      }
    })
    .catch(() => {});
}

/** Spawn `opencode serve --port 0` and resolve once its listening banner appears on stdout (or null
 *  on any failure/timeout) — same detection technique @opencode-ai/sdk's own createOpencodeServer
 *  uses (dist/server.js), reimplemented here so the spawn itself goes through Bun.spawn +
 *  claudeSpawnEnv (augmented PATH) instead of cross-spawn + bare process.env. */
function spawnAndWaitForBanner(bin: string): Promise<LiveServer | null> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([bin, "serve", "--port", "0", "--hostname", "127.0.0.1"], {
        // The server's own cwd is inconsequential — every request scopes itself via a `directory`
        // query param (verified live: session/message/prompt/abort/permissions/config/command all
        // accept it) — but Bun.spawn needs SOME existing directory; homedir() avoids coupling
        // server startup to whichever vault happens to open a chat first.
        cwd: homedir(),
        stdout: "pipe",
        stderr: "pipe",
        env: claudeSpawnEnv() as Record<string, string>,
      });
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (result: LiveServer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
      finish(null);
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
            const url = m[1];
            const client = createOpencodeClient({ baseUrl: url });
            finish({ client, url, proc });
            return;
          }
        }
      } catch {
        /* stdout torn down before the banner appeared */
      }
      // Stream ended (process exited) without ever printing the banner — unsupported/broken CLI.
      finish(null);
    })();

    proc.exited.then(() => finish(null)).catch(() => finish(null));
  });
}

/**
 * Lazily start the one shared opencode server for this core process, or return the already-running
 * one. `bin` is only consulted on the FIRST successful spawn attempt for the process's lifetime (or
 * again after a genuine mid-life crash) — resolves null when the installed opencode can't serve
 * (old CLI, spawn failure, banner timeout), so callers fall back to the per-turn `run` path.
 */
export function ensureOpencodeServer(bin: string): Promise<OpencodeServerHandle | null> {
  if (starting) return starting;
  starting = (async () => {
    const handle = await spawnAndWaitForBanner(bin);
    if (!handle) return null;
    live = handle;
    watchExit(handle);
    // Awaited: see subscribeToEvents's note on why the SUBSCRIBE step (not the consume loop) must
    // land before any caller gets to send a turn. Best-effort: a subscribe failure doesn't fail
    // server startup itself (session.prompt's own response is still authoritative for turn
    // completion — see opencode.ts's runTurnServer), it just means no live deltas/permission asks
    // for whatever's in flight until a later successful subscribe (there is no retry loop here;
    // this is judged good-enough for a same-machine localhost connection that just proved itself
    // reachable by printing its own listening banner moments ago).
    await subscribeToEvents(handle).catch(() => {});
    return { client: handle.client, url: handle.url };
  })();
  return starting;
}

// Never leave an orphaned `opencode serve` running past this core process's own life.
let shuttingDown = false;
function shutdownAll(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (live) {
    try {
      live.proc.kill();
    } catch {
      /* already exited */
    }
  }
}
process.on("exit", shutdownAll);
