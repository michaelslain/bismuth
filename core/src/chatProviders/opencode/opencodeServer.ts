// core/src/chatProviders/opencodeServer.ts
// Lifecycle for the ONE persistent `opencode serve` process shared by every opencode chat this core
// process hosts — started lazily on the first opencode chat, kept alive for the rest of the
// process's life, never one-per-chat — except that a change to the local-model config (the
// `OPENCODE_CONFIG_CONTENT` it was spawned with) replaces it, once no turn is in flight. Every
// request below carries a `directory` query param, so one server multiplexes every vault/chat this core process serves, mirroring the daemon's "one process,
// many vault brains" shape (core/src/daemon.ts).
//
// OPENCODE 2: the same lifecycle serves both majors; only the client differs. opencode 2's `serve`
// prints `server listening on <url>`, guards its `/api` routes with the password this module puts
// in `OPENCODE_SERVER_PASSWORD`, and is driven by opencodeV2Client.ts (the SDK below is opencode 1
// only). Its events carry the session in `data.sessionID`, and its turns end on an event rather
// than on an HTTP response, so a dead stream is announced to every listener (OPENCODE_STREAM_CLOSED).
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
// `opencode` binary. So this module resolves the binary itself (`whichBinary('opencode')` in claudeWhich.ts) and
// spawns `opencode serve` directly via Bun.spawn + claudeSpawnEnv, exactly like every other driver in
// this codebase (chat.ts, terminal.ts, chatProviders/acp/driver.ts) — then binds the SDK's typed
// client to the resulting URL via createOpencodeClient({baseUrl}). Startup detection mirrors the
// SDK's own createOpencodeServer (read directly, same technique): watch stdout for the "opencode
// server listening on <url>" banner within a timeout; anything else (an old opencode with no `serve`
// subcommand, a parse failure, a timeout) resolves null so the caller falls back to the per-turn
// `run` path rather than breaking the provider.
//
// VISIBILITY GATE (docs/vault/visibility.md): this module is deliberately VAULT-AGNOSTIC — the one
// server it starts is shared across every vault this core process hosts, scoped per-request only via
// each call's `directory` query param. That shape is exactly why it can NEVER carry an OS-level
// (Seatbelt) read-deny profile scoped to one vault's restricted files: a profile applied to THIS
// process would apply to every other vault's session riding it too (agentBackends/sandboxWrapper.ts's
// precondition P3 — "a dedicated per-session-or-per-turn process for ONE vault"). The constraint is
// therefore enforced by the CALLER, not here: chatProviders/opencode.ts's getOrCreateSession never
// even calls `ensureOpencodeServer` for a vault the visibility gate restricts, forcing it onto the
// per-turn `run` path (which CAN be wrapped, one profile per subprocess) instead. Nothing in this
// file needs to know which vault(s) are restricted for that invariant to hold.
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
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk'
import { claudeSpawnEnv } from '../../claudeWhich'
import { opencodeMajor, usesBackgroundService } from './opencodeCli'
import { withInjectedConfig } from './opencodeConfig'
import {
    createOpencodeV2Client,
    type OpencodeV2Client,
} from './opencodeV2Client'

/** What a server spawn needs from the local-model seam: the env (`OPENCODE_CONFIG_CONTENT`) — a
 *  `ResolvedLocal` from agentBackends/localModelProbe.ts satisfies it. */
export type OpencodeLocalEnv = { env: Record<string, string> }

/** The env `opencode serve` is spawned with: the base env (claudeSpawnEnv's) with PWD pinned to the
 *  server's own cwd, plus — when the local model is on — the inline config that declares the `local`
 *  provider. `OPENCODE_CONFIG_CONTENT` outranks the user's own opencode config and merges into it,
 *  and deep-merges over an inherited `OPENCODE_CONFIG_CONTENT` (`withInjectedConfig`), so nothing
 *  the user configured is lost and nothing of theirs is written. Pure. */
export function serverSpawnEnv(
    base: Record<string, string>,
    local?: OpencodeLocalEnv | null,
): Record<string, string> {
    return withInjectedConfig({ ...base, PWD: homedir() }, local?.env)
}

/** Identity of a server's config: the inline config content, or null for none. Two servers with
 *  the same key are interchangeable; a different key means the live one must be replaced. */
export function opencodeServerConfigKey(
    local: OpencodeLocalEnv | null | undefined,
): string | null {
    return local?.env.OPENCODE_CONFIG_CONTENT ?? null
}

/** What to do with the live server when a caller wants config `want` (undefined = no preference,
 *  e.g. an abort or a history read; null = no local config). `turns` = turns in flight on it. */
export function planServerChange(s: {
    live: boolean
    liveKey: string | null
    want: string | null | undefined
    turns: number
}): 'keep' | 'restart' | 'wait' {
    if (!s.live || s.want === undefined || s.want === s.liveKey)
        return s.live ? 'keep' : 'restart'
    return s.turns > 0 ? 'wait' : 'restart'
}

/** The shared server, by the API it speaks: opencode 1 through @opencode-ai/sdk's typed client,
 *  opencode 2 through opencodeV2Client.ts (the SDK cannot drive its `/api` surface). */
export type OpencodeServerHandle =
    | { version: 1; client: OpencodeClient; url: string }
    | { version: 2; client: OpencodeV2Client; url: string }

/** How long to wait for the "opencode server listening on <url>" banner before giving up and
 *  falling back to the per-turn `run` path (an old opencode with no `serve` subcommand, or one
 *  that's simply slow to boot on a loaded machine). */
const STARTUP_TIMEOUT_MS = 8000
/** opencode 1 prints `opencode server listening on <url>`, opencode 2 `server listening on <url>`. */
const LISTEN_BANNER_RE = /(?:^|\s)server listening on\s+(https?:\/\/\S+)/m

type LiveServer = OpencodeServerHandle & {
    proc: ReturnType<typeof Bun.spawn>
}

/** The event a v2 listener receives when the shared event stream ends, so a turn waiting on its
 *  `session.execution.*` end event fails instead of waiting forever. */
export const OPENCODE_STREAM_CLOSED = 'bismuth.opencode.stream-closed'

/** Which server a caller wants. `default` is the chat's server; `compact` is a second one so a
 *  caller can run it under a different config without disturbing the first. */
export type OpencodeProfile = 'default' | 'compact'

/** Everything one profile's server owns. Each profile is its own slot with the lifecycle above:
 *  lazy start, replacement on a config change once the slot has no turn in flight, one retry after
 *  a crash. */
type Slot = {
    /** The slot's server, once started. */
    live: LiveServer | null
    /** In-flight or settled startup attempt. Deliberately NOT cleared after a startup FAILURE (an
     *  old opencode's inability to `serve` is a static fact about the installed binary — no point
     *  retrying every chat open) — only cleared after a live server later crashes (see watchExit),
     *  so a genuine mid-life crash gets one fresh retry on the next call. */
    starting: Promise<OpencodeServerHandle | null> | null
    /** sessionId -> the current turn's event handler. Registered by chatProviders/opencode.ts right
     *  before it sends a prompt/command, unregistered once that call settles — a session with no
     *  turn in flight has no listener, which is fine: permission asks and streaming deltas only
     *  happen mid-turn. */
    listeners: Map<string, (ev: unknown) => void>
    /** Resolvers parked by a pending replacement until no turn is in flight (see replaceServer). A
     *  turn is "in flight" exactly while its listener is registered. */
    idleWaiters: (() => void)[]
    /** The config key + env the live (or in-flight) server was started with — kept past a crash so
     *  a bare `ensureOpencodeServer(bin)` after one restarts it with the same local model. */
    liveKey: string | null
    lastLocal: OpencodeLocalEnv | null
    /** A replacement waiting on running turns; every caller that wants a different config queues
     *  on it. */
    replacing: Promise<void> | null
}

const slots = new Map<OpencodeProfile, Slot>()
function slotFor(profile: OpencodeProfile): Slot {
    let slot = slots.get(profile)
    if (!slot) {
        slot = {
            live: null,
            starting: null,
            listeners: new Map(),
            idleWaiters: [],
            liveKey: null,
            lastLocal: null,
            replacing: null,
        }
        slots.set(profile, slot)
    }
    return slot
}

export function registerOpencodeServerListener(
    sessionId: string,
    handler: (ev: unknown) => void,
    profile: OpencodeProfile = 'default',
): () => void {
    const slot = slotFor(profile)
    slot.listeners.set(sessionId, handler)
    return () => {
        if (slot.listeners.get(sessionId) === handler)
            slot.listeners.delete(sessionId)
        if (slot.listeners.size === 0) {
            const waiting = slot.idleWaiters.splice(0)
            for (const wake of waiting) wake()
        }
    }
}

function whenNoTurnActive(slot: Slot): Promise<void> {
    if (slot.listeners.size === 0) return Promise.resolve()
    return new Promise(resolve => slot.idleWaiters.push(resolve))
}

/** Pull the opencode session id out of one raw event, whatever shape it turns out to carry — the
 *  live server's own field naming already drifted from its generated types once (see top-of-file
 *  note), so this stays defensive rather than trusting any single shape. Exported for unit testing. */
export function opencodeServerEventSessionId(raw: unknown): string | null {
    if (!raw || typeof raw !== 'object') return null
    const ev = raw as Record<string, unknown>
    // opencode 1 nests an event's payload under `properties`, opencode 2 under `data`.
    const props = (
        ev.properties && typeof ev.properties === 'object'
            ? ev.properties
            : ev.data && typeof ev.data === 'object'
              ? ev.data
              : ev
    ) as Record<string, unknown>
    if (typeof props.sessionID === 'string' && props.sessionID)
        return props.sessionID
    const part = (
        props.part && typeof props.part === 'object' ? props.part : null
    ) as Record<string, unknown> | null
    if (part && typeof part.sessionID === 'string' && part.sessionID)
        return part.sessionID
    const info = (
        props.info && typeof props.info === 'object' ? props.info : null
    ) as Record<string, unknown> | null
    if (info && typeof info.sessionID === 'string' && info.sessionID)
        return info.sessionID
    if (
        info &&
        typeof info.id === 'string' &&
        info.id &&
        typeof ev.type === 'string' &&
        ev.type.startsWith('session.')
    )
        return info.id
    return null
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
async function consumeEvents(
    slot: Slot,
    handle: LiveServer,
    stream: AsyncGenerator<unknown>,
    already: unknown[] = [],
): Promise<void> {
    const dispatch = (gev: unknown) => {
        const g = gev as { payload?: unknown } | null
        const payload =
            g && typeof g === 'object' && 'payload' in g ? g.payload : gev
        const sid = opencodeServerEventSessionId(payload)
        if (sid) slot.listeners.get(sid)?.(payload)
    }
    try {
        for (const ev of already) dispatch(ev)
        for await (const gev of stream) {
            if (slot.live !== handle) return // superseded by a restart
            dispatch(gev)
        }
    } catch {
        /* stream torn down (server exit/network hiccup) — handled by watchExit below */
    }
    // An opencode 2 turn ends only on an event, so every turn in flight is told the stream is gone.
    if (handle.version === 2)
        for (const handler of [...slot.listeners.values()])
            handler({ type: OPENCODE_STREAM_CLOSED })
}

/** Open the global event SUBSCRIPTION and return once it's established (the SDK's `global.event()`
 *  resolves only after the SSE connection is live, before any events have necessarily arrived) —
 *  AWAITED by ensureOpencodeServer before it hands a handle to its first caller, so a turn sent the
 *  moment the server becomes available can never race the subscription itself (only ever a
 *  near-zero-cost concern in practice, but cheap to close outright rather than rely on timing). The
 *  actual event consumption then runs detached (consumeEvents, fire-and-forget) for the rest of the
 *  server's life. */
async function subscribeToEvents(
    slot: Slot,
    handle: LiveServer,
): Promise<void> {
    if (handle.version === 2) {
        const stream = handle.client.events()
        // opencode 2 sends `server.connected` the moment the stream opens, so the first event is
        // the subscription's proof of life.
        const first = await stream.next()
        void consumeEvents(slot, handle, stream, first.done ? [] : [first.value])
        return
    }
    const { stream } = await handle.client.global.event()
    void consumeEvents(slot, handle, stream)
}

/** If the live server process exits on its own (crash, killed out-of-band), drop the cached handle
 *  so the NEXT ensureOpencodeServer() call spawns a fresh one rather than returning a dead client
 *  forever. A deliberate stop() (process shutdown) also exits the child, but by then nothing calls
 *  ensureOpencodeServer() again, so this is harmless either way. */
function watchExit(slot: Slot, handle: LiveServer): void {
    handle.proc.exited
        .then(() => {
            if (slot.live === handle) {
                slot.live = null
                slot.starting = null
            }
        })
        .catch(() => {})
}

/** Spawn `opencode serve --port 0` and resolve once its listening banner appears on stdout (or null
 *  on any failure/timeout) — same detection technique @opencode-ai/sdk's own createOpencodeServer
 *  uses (dist/server.js), reimplemented here so the spawn itself goes through Bun.spawn +
 *  claudeSpawnEnv (augmented PATH) instead of cross-spawn + bare process.env. */
function spawnAndWaitForBanner(
    bin: string,
    env: Record<string, string>,
    version: 1 | 2,
): Promise<LiveServer | null> {
    // opencode 2 guards its API with a password it reads from the env (and strips from every child
    // it spawns); a fresh random one per server keeps it private to this core process.
    const password = randomBytes(24).toString('base64url')
    if (version === 2) env = { ...env, OPENCODE_SERVER_PASSWORD: password }
    return new Promise(resolve => {
        let proc: ReturnType<typeof Bun.spawn>
        try {
            proc = Bun.spawn(
                [bin, 'serve', '--port', '0', '--hostname', '127.0.0.1'],
                {
                    // The server's own cwd is inconsequential — every request scopes itself via a `directory`
                    // query param (verified live: session/message/prompt/abort/permissions/config/command all
                    // accept it) — but Bun.spawn needs SOME existing directory; homedir() avoids coupling
                    // server startup to whichever vault happens to open a chat first.
                    cwd: homedir(),
                    stdout: 'pipe',
                    stderr: 'pipe',
                    // "chat": every session this shared server ever hosts is a chat session (the daemon has no
                    // opencode integration — see catalog.ts's OPENCODE.capabilities.daemon) — stamped so the
                    // CLI-dispatch visibility gate (core/src/visibilityCliGate.ts) can tell any `bismuth` Bash
                    // call this process's own children make from the vault owner's (unstamped) ones.
                    //
                    // PWD: homedir() — matches `cwd` above explicitly. Bun's `cwd` option chdir()s the child but
                    // does NOT update an inherited `PWD` env var, and `opencode run` was found LIVE to trust a
                    // stale `PWD` over the real working directory for its own tool calls (see opencode.ts's
                    // `opencodeSpawnEnv`, the per-turn RUN-mode equivalent of this same fix) — harmless here
                    // either way (every server-mode request scopes itself via its own `directory` query param,
                    // not process cwd), but cheap insurance against depending on that distinction staying true.
                    env,
                },
            )
        } catch {
            resolve(null)
            return
        }

        let settled = false
        const finish = (result: LiveServer | null) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(result)
        }

        const timer = setTimeout(() => {
            try {
                proc.kill()
            } catch {
                /* already exited */
            }
            finish(null)
        }, STARTUP_TIMEOUT_MS)

        void (async () => {
            let pending = ''
            const decoder = new TextDecoder()
            try {
                for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
                    if (settled) return
                    pending += decoder.decode(chunk, { stream: true })
                    const m = pending.match(LISTEN_BANNER_RE)
                    if (m) {
                        const url = m[1]
                        finish(
                            version === 2
                                ? {
                                      version,
                                      client: createOpencodeV2Client(
                                          url,
                                          password,
                                      ),
                                      url,
                                      proc,
                                  }
                                : {
                                      version,
                                      client: createOpencodeClient({
                                          baseUrl: url,
                                      }),
                                      url,
                                      proc,
                                  },
                        )
                        return
                    }
                }
            } catch {
                /* stdout torn down before the banner appeared */
            }
            // Stream ended (process exited) without ever printing the banner — unsupported/broken CLI.
            finish(null)
        })()

        proc.exited.then(() => finish(null)).catch(() => finish(null))
    })
}

function startServer(
    slot: Slot,
    bin: string,
    local: OpencodeLocalEnv | null,
): Promise<OpencodeServerHandle | null> {
    slot.liveKey = opencodeServerConfigKey(local)
    slot.lastLocal = local
    const env = serverSpawnEnv(
        claudeSpawnEnv(process.env, 'chat') as Record<string, string>,
        local,
    )
    const attempt = (async () => {
        const version = usesBackgroundService(await opencodeMajor(bin)) ? 2 : 1
        const handle = await spawnAndWaitForBanner(bin, env, version)
        if (!handle) return null
        slot.live = handle
        watchExit(slot, handle)
        // Awaited: see subscribeToEvents's note on why the SUBSCRIBE step (not the consume loop) must
        // land before any caller gets to send a turn. Best-effort: a subscribe failure doesn't fail
        // server startup itself (session.prompt's own response is still authoritative for turn
        // completion — see opencode.ts's runTurnServer), it just means no live deltas/permission asks
        // for whatever's in flight until a later successful subscribe (there is no retry loop here;
        // this is judged good-enough for a same-machine localhost connection that just proved itself
        // reachable by printing its own listening banner moments ago).
        await subscribeToEvents(slot, handle).catch(() => {})
        const { proc: _proc, ...rest } = handle
        return rest as OpencodeServerHandle
    })()
    slot.starting = attempt
    return attempt
}

/** Replace the shared server with one carrying `local`. Waits for any in-flight turn on the old
 *  server to settle first (the old server keeps serving that turn), then kills it and starts anew. */
function replaceServer(
    slot: Slot,
    bin: string,
    local: OpencodeLocalEnv | null,
): Promise<OpencodeServerHandle | null> {
    const prior = slot.starting
    const swap = (async () => {
        await prior?.catch(() => null)
        await whenNoTurnActive(slot)
        const old = slot.live
        slot.live = null
        slot.starting = null
        if (old) {
            try {
                old.proc.kill()
            } catch {
                /* already exited */
            }
        }
    })()
    const pending: Promise<void> = swap.finally(() => {
        if (slot.replacing === pending) slot.replacing = null
    })
    slot.replacing = pending
    return swap.then(() => startServer(slot, bin, local))
}

/**
 * Lazily start the one shared opencode server for this core process, or return the already-running
 * one. `bin` is only consulted on the FIRST successful spawn attempt for the process's lifetime (or
 * again after a genuine mid-life crash) — resolves null when the installed opencode can't serve
 * (old CLI, spawn failure, banner timeout), so callers fall back to the per-turn `run` path.
 *
 * `local` is the local-model env the CALLER wants the server to carry: omitted = no preference (turn
 * calls, aborts, history reads just use whatever is live); `null` = none; an object = that config.
 * When it differs from the live server's, the server is replaced — immediately if no turn is in
 * flight, else once the running turn settles (this call waits for that), so a turn is never cut off.
 */
export function ensureOpencodeServer(
    bin: string,
    local?: OpencodeLocalEnv | null,
    profile: OpencodeProfile = 'default',
): Promise<OpencodeServerHandle | null> {
    const slot = slotFor(profile)
    if (
        slot.replacing &&
        local !== undefined &&
        opencodeServerConfigKey(local) !== slot.liveKey
    ) {
        // A replacement is pending: queue behind it, then re-evaluate against the server it leaves.
        return slot.replacing.then(() =>
            ensureOpencodeServer(bin, local, profile),
        )
    }
    const plan = planServerChange({
        live: !!slot.starting,
        liveKey: slot.liveKey,
        want: local === undefined ? undefined : opencodeServerConfigKey(local),
        turns: slot.listeners.size,
    })
    if (plan === 'keep')
        return slot.starting as Promise<OpencodeServerHandle | null>
    if (!slot.starting)
        return startServer(
            slot,
            bin,
            local === undefined ? slot.lastLocal : local,
        )
    return replaceServer(slot, bin, local ?? null)
}

/** Kill every slot's `opencode serve` and forget it, so the next ensure starts afresh. `bun test`
 *  never fires `process.on('exit')`, so a test that starts real servers calls this in `afterAll`. */
export function stopAllOpencodeServers(): void {
    for (const slot of slots.values()) {
        try {
            slot.live?.proc.kill()
        } catch {
            /* already exited */
        }
        slot.live = null
        slot.starting = null
    }
}

// Never leave an orphaned `opencode serve` running past this core process's own life.
let shuttingDown = false
function shutdownAll(): void {
    if (shuttingDown) return
    shuttingDown = true
    stopAllOpencodeServers()
}
process.on('exit', shutdownAll)
