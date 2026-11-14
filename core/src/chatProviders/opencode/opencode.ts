// core/src/chatProviders/opencode.ts
// The opencode chat provider: drives the user's own `opencode` CLI and speaks the SAME ChatFrame
// wire protocol chat.ts does, so ChatView renders an opencode conversation with zero rendering
// changes. TWO session modes coexist behind one registry/sink/queue (SessionSink from ./sessionSink,
// shared with chat.ts and the ACP driver):
//
//  - SERVER mode (preferred): one persistent `opencode serve` process, owned by
//    ./opencodeServer.ts and shared by every opencode chat this core process hosts (lazily started
//    on the first opencode chat, never one-per-chat). On opencode 1 sessions/turns ride
//    @opencode-ai/sdk's typed HTTP client; on opencode 2 they ride ./opencodeV2Client.ts, whose prompt
//    returns at once and whose turn ends on a `session.execution.*` event (runTurnServerV2); real-time deltas/tool progress/permission asks ride the server's GLOBAL event
//    stream (one subscription for the whole process — see opencodeServer.ts). This closes the
//    degradations the old per-turn subprocess had: real token-level streaming
//    (`message.part.delta`), a genuine permission request/response cycle (`permission.asked` +
//    `postSessionIdPermissionsPermissionId`), image attachments (`FilePartInput` with a `data:` URL),
//    and per-turn memory injection (`session.prompt`'s `system` field, from the recall service).
//  - RUN mode (fallback): the ORIGINAL one `opencode run --format json` subprocess PER TURN,
//    continued with `-s <sessionID>`. Used when `ensureOpencodeServer` reports the installed opencode
//    can't serve (no `serve` subcommand, or the startup banner never appears within its timeout) —
//    kept verbatim so an older opencode install still works, just without the server-mode wins above.
//    stdout is NDJSON (one event per line) → translateOpencodeEvent → ChatFrames; `--auto` auto-
//    approves permissions (no way to park on a prompt in this mode); images are refused with a
//    friendly error (see dispatchTurn).
//
// A session's mode is decided ONCE, at creation (whichever `ensureOpencodeServer` resolves to at that
// moment), and never flips mid-session — a session started before opencode's server support was
// detected (or before the shared server crashed) simply keeps running the mode it started in.
//
// VISIBILITY GATE (docs/vault/visibility.md): opencode has no native per-path deny of its own, so
// the only real gate available is agentBackends/sandboxWrapper.ts's OS-level Seatbelt wrapper. A
// prior design pass verified the raw mechanism live against a real `opencode run` turn
// (opencode/deepseek-v4-flash-free, $0 cost via Zen's free rotation — see the design pass's
// §2.5); THIS integration (getOrCreateSession/runTurnLegacy/runTurn below) was independently
// re-verified live end to end through openSession/setModel/sendMessage exactly as chatProviders/
// index.ts calls them — opencode/big-pickle (also a free Zen model, $0 cost) — the read tool AND a
// Bash `cat` fallback of a hidden note were BOTH denied in one real turn, with the secret in no
// frame, while a sibling PUBLIC note in the SAME restricted vault stayed fully readable in a second
// turn (the wrapper gates per-file, not per-vault). Two hard consequences follow:
//  - The wrapper can only apply to a DEDICATED per-turn subprocess (sandboxWrapper.ts's P3), never
//    the shared `opencode serve` process — that ONE process is multiplexed across every vault this
//    core hosts, so a profile scoped to one vault's restricted files can't be applied to it without
//    leaking (or wrongly restricting) every OTHER vault's session on the same process. A RESTRICTED
//    vault is therefore forced onto RUN mode unconditionally — see getOrCreateSession below — even
//    when the installed opencode is perfectly capable of serving.
//  - Where the wrapper itself is unavailable (non-macOS, `sandbox-exec` missing — see
//    checkSandboxWrapperAvailability) and the vault restricts anything, the session/turn is REFUSED
//    outright. Never silently spawn unwrapped: a gate that quietly does nothing on failure isn't one.
// An UNRESTRICTED vault (buildDenyPaths returns nothing) is completely unaffected by any of this —
// the feature stays invisible until the vault actually marks something hidden/chat-only.
//
// Both modes share: the Zen free-model rotation (`withZenFreeRotate`/`pickZenFreeModel`, card #90),
// the command registry powering `/` autocomplete (server mode: `GET /command`; run mode: `opencode
// debug config` + built-ins), the auth pill (`opencode auth list` — a plain CLI spawn, safe to run
// alongside a live server: it only reads `~/.local/share/opencode/auth.json`, verified live to not
// contend with the server's own sqlite), "a run that streamed an error still exits 0" rule (run mode
// only — server mode gets its error signal from the awaited HTTP response, not an exit code), and the
// sqlite-cold-start serialization note (run mode's `ensureOpenInfo`/first-turn spawns stay
// sequential — irrelevant once a server is already up and warm).
import type {
    ChatAgentOption,
    ChatFrame,
    ChatImage,
    ChatSink,
} from '../../chat'
import { recallServiceFor, recallWithin } from '../../memoryRecall'
import {
    detachSessionSink,
    emit,
    reattachSessionSink,
    rebindSessionSink,
    scheduleSessionClose,
} from '../sessionSink'
import { claudeSpawnEnv, whichBinary } from '../../claudeWhich'
import { titleFromPrompt } from '../titleFromPrompt'
import { CHAT_RENDERING_NOTE } from '../../chatRenderingNote'
import { chatLineRefNoteFor } from '../../chatLineRefNote'
import {
    opencodeCliArgs,
    opencodeMajor,
    usesBackgroundService,
} from './opencodeCli'
import {
    ensureOpencodeServer,
    OPENCODE_STREAM_CLOSED,
    registerOpencodeServerListener,
    type OpencodeProfile,
    type OpencodeServerHandle,
} from './opencodeServer'
import {
    OpencodeV2Error,
    type OpencodeV2Client,
    type OpencodeV2File,
} from './opencodeV2Client'
import {
    agentEntriesFromV2,
    commandEntriesFromV2,
    defaultModelFromV2,
    modelGroupFor,
    providerInfosFromV2,
    type OpencodeProviderInfo,
    type OpencodeV2TurnState,
    modelEntriesFromV2Models,
    newOpencodeV2TurnState,
    opencodeV2ModelRef,
    opencodeV2RetryGiveUp,
    opencodeV2TurnModel,
    parseOpencodeV2PermissionAsk,
    providerListFromV2,
    translateOpencodeV2Event,
} from './opencodeV2Translate'
import {
    buildDenyPaths,
    buildSandboxDenyPaths,
    type DenyEntry,
} from '../../visibility'
import { can } from '../../agentBackends/catalog'
import { LOCAL_PROVIDER_ID, normalizeUrl } from '../../agentBackends/localModel'
import type { LocalServerKind } from '../../agentBackends/contextWindow'
import {
    detectWindow,
    probeLocalServer,
} from '../../agentBackends/contextWindowProbe'
import {
    opencodeConfigContent,
    windowLimit,
    withInjectedConfig,
    type OpencodeConfigInput,
    type OpencodeInjectedServer,
    type OpencodeModelLimit,
} from './opencodeConfig'
import { readOpencodeServers } from './opencodeLocalServers'
import { contextOverflowMessage, isContextOverflow } from './opencodeOverflow'
import {
    localUnreachableMessage,
    resolveLocalSpawn,
    type ResolvedLocal,
} from '../../agentBackends/localModelProbe'
import type { OpencodeClient } from '@opencode-ai/sdk'
import {
    checkSandboxWrapperAvailability,
    describeSandboxWrapperUnavailable,
    isSandboxApplyFailure,
    materializeSandboxProfile,
    wrapArgv,
} from '../../agentBackends/sandboxWrapper'
import {
    agentEntriesFromV1,
    buildOpencodePromptParts,
    commandEntriesFromApi,
    modelEntriesFromProviders,
    newOpencodeServerTurnState,
    reconcileOpencodeFinalParts,
    newOpencodeTurnState,
    opencodeErrorMessage,
    opencodePermissionResponse,
    opencodeTurnCost,
    parseOpencodeAuthList,
    parseOpencodeDebugConfigCommands,
    parseOpencodeModels,
    parseOpencodeModelsVerbose,
    parseOpencodePermissionAsk,
    parseOpencodeRunCommand,
    pickZenFreeModel,
    splitOpencodeModelId,
    translateOpencodeEvent,
    translateOpencodeExport,
    translateOpencodeServerEvent,
    translateOpencodeSessionMessages,
    withOpencodeBuiltinCommands,
    withZenFreeRotate,
    zenFreeModelIds,
    ZEN_FREE_ROTATE_ID,
    type OpencodeCommandEntry,
    type OpencodeModelEntry,
} from './opencodeTranslate'

interface OpencodeSession {
    id: string
    cwd: string
    sink: ChatSink
    /** opencode's durable session id (ses_…), learned from server.session.create()/the first run's
     *  events; preset when resuming. `-s`/the server session id continues it on every later turn. */
    sessionId: string | null
    /** The `provider/model` the user picked in the header (set_model); rides every turn. With the
     *  local model on and no pick, defaults to `local/<model>` (the server ignores the inline
     *  config's `model` key until a turn names one — see backendEnv.ts's opencode note). */
    model?: string
    /** The local-model env this session was opened under (null = off). Server mode carries it on the
     *  shared server; a RUN-mode turn (restricted vault / no `serve`) spawns with it directly. */
    localEnv: Record<string, string> | null
    bin: string
    /** Decided once at session creation — see top-of-file note. */
    mode: 'server' | 'run'
    /** This vault's `.daemon/memory` when the daemon is enabled — gates per-turn memory injection
     *  (server mode only; run mode has no system-prompt override to inject it through). */
    memoryDir?: string
    /** The in-flight turn's child process (run mode only; killed by abortTurn/closeChat). */
    proc: ReturnType<typeof Bun.spawn> | null
    turnActive: boolean
    /** Set by abortTurn right before killing/cancelling the turn, so the completion handler reports a
     *  deliberate Stop (isError:false), mirroring ChatSession.aborting. */
    aborting: boolean
    /** Turns staged while one is in flight (the client also queues; this is the backend guard). */
    queue: { text: string; images?: ChatImage[] }[]
    /** Completed-turn count — drives the Zen free-model ROTATION (turn N runs free model N mod roster
     *  size) when the virtual `ZEN_FREE_ROTATE_ID` is the selected model. */
    turnCount: number
    detached: boolean
    buffer: ChatFrame[]
    closeTimer?: ReturnType<typeof setTimeout>
    titleSent?: boolean
    /** opencode 2: the session was created here without a title, so the first prompt names it first
     *  (opencode otherwise spends a model call generating one before the turn). */
    untitled?: boolean
    lastActivityAt: number
    /** The chat's private toggle (setPrivate): erase the session from opencode's store on close. */
    private?: boolean
    /** Permission ids this session has asked about and not yet answered (server mode only) — guards
     *  respondPermission against answering an id twice or one from a stale/foreign session. */
    pendingPermissions: Set<string>
    /** opencode 2 only: the model and variant the server session currently runs (`provider/model#
     *  variant`; its model is per session, not per prompt), so a turn switches only on a change. */
    serverModel?: string
    /** The reasoning-effort level the user picked (set_effort). On opencode 2 it rides the turn's
     *  model as its variant when that model lists the level; nothing else reads it. */
    effort?: string
    /** The primary agent the user picked (setAgent); rides the next turn once it differs from
     *  `appliedAgent`. */
    agent?: string
    /** The agent the opencode session currently runs, so a turn switches only on a change. */
    appliedAgent?: string
    /** The server slot the opencode session's model, agent and instructions were last applied on. */
    slot: OpencodeProfile
    /** The server handle the session was last adopted on: a replaced default server re-adopts. */
    slotServer?: OpencodeServerHandle
    /** The profile of the server the in-flight turn runs on (Stop and permission replies go there). */
    turnProfile?: OpencodeProfile
    /** The env a RUN-mode turn spawns with: the injected config (`OPENCODE_CONFIG_CONTENT`), or null. */
    spawnEnv: Record<string, string> | null
    /** The config this session's server was opened with; the compact profile is built from it. */
    configInput: OpencodeConfigInput
    /** A `set_model` waiting on the model fetch; the next turn waits for it. */
    modelPick?: Promise<void>
}

type ServerV1 = Extract<OpencodeServerHandle, { version: 1 }>
type ServerV2 = Extract<OpencodeServerHandle, { version: 2 }>

/** The opencode 2 instructions-entry key Bismuth's per-turn system text rides in. */
const SYSTEM_ENTRY_KEY = 'bismuth-memory'

// Frame buffering + reconnect lifecycle (emit / rebindSessionSink / scheduleSessionClose) is
// transport-agnostic and shared with the Claude provider — see ./sessionSink. OpencodeSession
// satisfies its SessionSink shape structurally.

const sessions = new Map<string, OpencodeSession>()
// The session-start brain block, fetched once per session and carried on every turn.
const brainBySession = new WeakMap<OpencodeSession, string>()

/** Where a provider's models are served from, so a model's loaded window can be read again before a
 *  turn: the local model, a saved server, or a loopback provider opencode listed on its own. */
type ProviderSource = {
    url: string
    apiKey: string
    kind: LocalServerKind | null
}
/** `provider -> where it is served` for every provider whose window Bismuth detects. */
let providerSources = new Map<string, ProviderSource>()
/** `provider/model -> the loaded window` last injected or seen. */
let injectedWindows = new Map<string, number>()
/** Provider ids Bismuth declared, with the name their model group is headed by. */
let injectedNames: Record<string, string> = {}
/** The providers opencode listed at the last open (their loopback flag orders the model groups). */
let providerInfos: OpencodeProviderInfo[] = []
/** The limits injected for providers Bismuth did not declare, as of the last open; a reopen starts
 *  from them so an unchanged window keeps the live server. */
let rememberedLimits: OpencodeModelLimit[] = []
/** The config the live default server carries. */
let liveInput: OpencodeConfigInput | null = null
/** Models whose prompt overflowed the loaded window: their later turns start on the compact profile.
 *  Keyed `provider/model|window` (`?` when no window was detected). */
const compactModels = new Set<string>()

function compactKey(model: string | null | undefined): string {
    return `${model ?? ''}|${injectedWindows.get(model ?? '') ?? '?'}`
}

function localInputOf(
    local: ResolvedLocal | null,
): OpencodeConfigInput['local'] {
    return local
        ? {
              lm: local.lm,
              model: local.model,
              models: local.models,
              windows: local.windows,
          }
        : null
}

function configEnv(
    input: OpencodeConfigInput,
): { env: Record<string, string> } | null {
    const content = opencodeConfigContent(input)
    return content ? { env: { OPENCODE_CONFIG_CONTENT: content } } : null
}

type ServerSetup = {
    server: OpencodeServerHandle | null
    input: OpencodeConfigInput
}

/** Loopback providers opencode lists that Bismuth did not declare (the user's own config, its
 *  discovery): probe each server for the loaded window of every model opencode lists from it, as a
 *  limit to inject. */
async function detectLimits(
    server: ServerV2,
    cwd: string,
    declared: ReadonlySet<string>,
    sources: Map<string, ProviderSource>,
    windows: Map<string, number>,
): Promise<{ limits: OpencodeModelLimit[]; infos: OpencodeProviderInfo[] }> {
    const [rawModels, rawProviders] = await Promise.all([
        server.client.models(cwd),
        server.client.providers(cwd),
    ])
    const infos = providerInfosFromV2(rawProviders)
    const limits: OpencodeModelLimit[] = []
    await Promise.all(
        infos
            .filter(i => i.loopback && i.baseURL && !declared.has(i.id))
            .map(async info => {
                const url = normalizeUrl(info.baseURL as string)
                const probe = await probeLocalServer(url)
                if (!probe) return
                sources.set(info.id, { url, apiKey: '', kind: probe.kind })
                for (const raw of rawModels) {
                    const m = raw as {
                        providerID?: unknown
                        id?: unknown
                        limit?: { output?: unknown }
                    }
                    if (m.providerID !== info.id || typeof m.id !== 'string')
                        continue
                    const w = probe.models.find(x => x.id === m.id)?.window
                    if (!w) continue
                    const known =
                        typeof m.limit?.output === 'number'
                            ? m.limit.output
                            : null
                    limits.push({
                        providerID: info.id,
                        modelID: m.id,
                        context: w,
                        output: windowLimit(w, known).output,
                        baseURL: url,
                    })
                    windows.set(`${info.id}/${m.id}`, w)
                }
            }),
    )
    limits.sort((a, b) =>
        `${a.providerID}/${a.modelID}`.localeCompare(
            `${b.providerID}/${b.modelID}`,
        ),
    )
    return { limits, infos }
}

/** Open the shared default server for a vault: the local model, its saved servers and the detected
 *  windows ride its injected config. A window that differs from the live server's injected limit
 *  replaces it once; an unchanged reopen keeps it. */
let openChain: Promise<unknown> = Promise.resolve()
function openDefaultServer(
    bin: string,
    cwd: string,
    local: ResolvedLocal | null,
): Promise<ServerSetup> {
    const run = openChain.then(() => openDefaultServerOnce(bin, cwd, local))
    openChain = run.catch(() => {})
    return run
}

async function openDefaultServerOnce(
    bin: string,
    cwd: string,
    local: ResolvedLocal | null,
): Promise<ServerSetup> {
    const sources = new Map<string, ProviderSource>()
    const windows = new Map<string, number>()
    const names: Record<string, string> = {}
    if (local) {
        names[LOCAL_PROVIDER_ID] = 'local model'
        sources.set(LOCAL_PROVIDER_ID, {
            url: local.lm.url,
            apiKey: local.lm.apiKey,
            kind: local.kind,
        })
        for (const [m, w] of Object.entries(local.windows))
            windows.set(`${LOCAL_PROVIDER_ID}/${m}`, w)
    }
    const servers: OpencodeInjectedServer[] = []
    const saved = await readOpencodeServers(cwd)
    const probed = await Promise.all(
        saved.map(async sv => ({
            sv,
            probe: await probeLocalServer(sv.url, sv.apiKey),
        })),
    )
    for (const { sv, probe } of probed) {
        if (!probe) continue
        const models = probe.models
            .filter(m => !m.embedding)
            .map(m => ({ id: m.id, window: m.window }))
        servers.push({ ...sv, models })
        names[sv.id] = sv.name
        sources.set(sv.id, { url: sv.url, apiKey: sv.apiKey, kind: probe.kind })
        for (const m of models)
            if (m.window) windows.set(`${sv.id}/${m.id}`, m.window)
    }
    const base: OpencodeConfigInput = {
        local: localInputOf(local),
        servers,
        limits: rememberedLimits,
        profile: 'default',
    }
    let input = base
    let server = await ensureOpencodeServer(bin, configEnv(input)).catch(
        () => null,
    )
    let infos = providerInfos
    if (server?.version === 2) {
        const found = await detectLimits(
            server,
            cwd,
            new Set(Object.keys(names)),
            sources,
            windows,
        ).catch(() => null)
        if (!found) {
            // A concurrent open may have replaced the server: keep the limits learned so far.
            input = { ...base, limits: rememberedLimits }
        } else {
            infos = found.infos
            if (
                JSON.stringify(found.limits) !==
                JSON.stringify(rememberedLimits)
            ) {
                rememberedLimits = found.limits
                input = { ...base, limits: found.limits }
                server = await ensureOpencodeServer(
                    bin,
                    configEnv(input),
                ).catch(() => null)
            }
        }
    }
    providerSources = sources
    injectedWindows = windows
    injectedNames = names
    providerInfos = infos
    liveInput = input
    return { server, input }
}

/** `model`'s window re-read from its server just before a turn. When it changed since it was
 *  injected the default server is replaced (once the slot is idle) and returned; null otherwise. */
async function recheckWindow(
    s: OpencodeSession,
    model: string,
): Promise<ServerV2 | null> {
    const slash = model.indexOf('/')
    if (slash < 1) return null
    const src = providerSources.get(model.slice(0, slash))
    if (!src) return null
    const w = await detectWindow(src.url, model.slice(slash + 1), src.apiKey)
    if (w === null || w === injectedWindows.get(model)) return null
    const res = await resolveLocalSpawn('opencode', s.cwd)
    const local = res.kind === 'ready' ? res.local : null
    const setup = await openDefaultServer(s.bin, s.cwd, local)
    injectedWindows.set(model, w)
    s.spawnEnv = configEnv(setup.input)?.env ?? null
    s.configInput = setup.input
    return setup.server?.version === 2 ? setup.server : null
}

/** The turn error for a prompt the model's window could not hold, else `message` as is. */
function overflowText(
    model: string | null | undefined,
    message: string,
): string {
    if (!isContextOverflow(message)) return message
    const entry = (modelsCache ?? []).find(m => m.value === model)
    const provider = model?.split('/')[0] ?? ''
    return contextOverflowMessage({
        model: entry?.label || model || 'The model',
        window: injectedWindows.get(model ?? '') ?? null,
        kind: providerSources.get(provider)?.kind ?? null,
    })
}

export function hasSession(chatId: string): boolean {
    return sessions.has(chatId)
}

export function sessionCount(): number {
    return sessions.size
}

/**
 * `claudeSpawnEnv`'s env, with `PWD` forced to match `cwd`. LIVE-VERIFIED load-bearing fix: Bun's
 * `cwd` spawn option correctly `chdir()`s the child before exec, but does NOT update the inherited
 * `PWD` environment variable — and `opencode run` was found to trust `PWD` over the process's real
 * working directory. Reproduced directly: spawning `opencode run` with `cwd: "/tmp/ocwd-test"` but
 * an inherited `PWD` from a DIFFERENT directory made its own `bash` tool's `pwd`/`cat` operate in
 * the STALE PWD directory, not the one just `chdir()`'d to; forcing `PWD` to match `cwd` (or passing
 * `--dir <cwd>` — this is the cheaper fix, no extra argv) made every tool call resolve correctly.
 * `claudeSpawnEnv` itself just spreads the CALLING process's env (Bismuth's own core server's own
 * launch directory, irrelevant to any vault it serves), so every opencode spawn in this file must
 * override PWD explicitly or a stale one silently redirects the whole turn to the wrong directory.
 * This is exactly why the visibility gate matters here beyond "denies the right paths": the deny
 * list (buildDenyPaths/materializeSandboxProfile, both keyed on `cwd`) and the agent's actual
 * operating directory must be THE SAME directory, or a deny list is enforcement theater — it would
 * faithfully deny paths under a vault the agent was never even operating in.
 */
function opencodeSpawnEnv(
    cwd: string,
    extra?: Record<string, string> | null,
): Record<string, string> {
    return withInjectedConfig(
        {
            ...(claudeSpawnEnv(process.env, 'chat') as Record<string, string>),
            PWD: cwd,
        },
        extra,
    )
}

/** A new session's model under the local setting: the user's pick when there is one, else
 *  `local/<model>`. Pure. */
export function localSessionModel(
    picked: string | undefined,
    local: { model: string } | null,
): string | undefined {
    return picked ?? (local ? `${LOCAL_PROVIDER_ID}/${local.model}` : undefined)
}

/** Resolve the local-model setting for a session open. `ok:false` means the setting is on but the
 *  server is down / lists nothing — an error frame has already gone to `sink`, and the session must
 *  not open (never a silent fall back to opencode's own account). */
export async function resolveOpencodeLocal(
    cwd: string,
    sink: ChatSink,
): Promise<{ ok: true; local: ResolvedLocal | null } | { ok: false }> {
    const res = await resolveLocalSpawn('opencode', cwd)
    if (res.kind === 'unreachable') {
        sink({
            type: 'error',
            code: 'spawn',
            message: localUnreachableMessage(res.url),
        })
        return { ok: false }
    }
    return { ok: true, local: res.kind === 'ready' ? res.local : null }
}

/** One opencode CLI invocation → stdout text (stderr ignored). Every RUN-mode open-time discovery
 *  (`models`, `debug config`) and the auth pill (`auth list`, BOTH modes) goes through here. The
 *  argv is rewritten for the installed major (opencodeCli.ts); a call with no v2 equivalent yields
 *  '' without spawning. */
async function runCliText(
    bin: string,
    cwd: string,
    args: string[],
): Promise<string> {
    const argv = opencodeCliArgs(await opencodeMajor(bin), args)
    if (!argv) return ''
    const proc = Bun.spawn([bin, ...argv], {
        cwd,
        stdout: 'pipe',
        stderr: 'ignore',
        env: opencodeSpawnEnv(cwd),
    })
    const out = await new Response(proc.stdout as ReadableStream).text()
    await proc.exited
    return out
}

// Models + commands are static per opencode config — fetch once per process and reuse for every
// session's open frames. SERVER mode reads them straight off the typed API (`config.providers()` +
// `command.list()` — richer than text-scraping and no extra subprocess per fetch); RUN mode falls
// back to the original CLI-text parse (each call takes ~1.4s; still worth caching per process). The
// two RUN-mode fetches stay SEQUENTIAL in one shared promise: opencode's local sqlite rejects
// concurrent openers at cold start ("database is locked" — observed live), so open-time CLI spawns
// must never race each other (or the first turn — runTurnLegacy awaits this same promise). That
// concern doesn't apply to server mode (the server is already up and warm by the time this runs).
let modelsCache: OpencodeModelEntry[] | null = null
let commandsCache: OpencodeCommandEntry[] | null = null
let openInfoInFlight: Promise<void> | null = null
/** True while `openInfoInFlight` runs: a model pick waits for the list it is checked against. */
let openInfoPending = false
/** The selectable primary agents (opencode's build, plan, …); null in run mode, which has none. */
let agentsCache: ChatAgentOption[] | null = null
/** Settles once the current fetch has written `agentsCache` (opencode 2 only, ahead of the models and
 *  commands), so the `agents` frame goes out as soon as the list is known. */
let agentsInFlight: Promise<void> | null = null
/** Bumped by every new fetch and by `dropOpenInfo`. A fetch writes the caches only while its own
 *  generation is current: a fetch for a replaced server (killed mid-read, so its calls throw) would
 *  otherwise write empty lists over the live server's. */
let openInfoGen = 0

function dropOpenInfo(): void {
    openInfoGen++
    modelsCache = null
    agentsCache = null
    openInfoInFlight = null
    agentsInFlight = null
    openInfoPending = false
}

/** opencode 2 can answer a directory's agent read before it has loaded the agents: a fresh server's
 *  first read is an empty list. Measured live, the read after it, 230-280 ms later, held the list; an
 *  empty answer is read again every `AGENT_REREAD_MS` while the fetch is current, up to `AGENT_READS`
 *  reads, so a server that truly lists none still lets the open finish. */
const AGENT_REREAD_MS = 250
const AGENT_READS = 8
async function readV2Agents(
    client: OpencodeV2Client,
    cwd: string,
    current: () => boolean,
): Promise<unknown[]> {
    let raw = await client.agents(cwd)
    for (let i = 1; i < AGENT_READS && !raw.length && current(); i++) {
        await new Promise(r => setTimeout(r, AGENT_REREAD_MS))
        raw = await client.agents(cwd)
    }
    return raw
}
/** The inline-config key the cached model list was fetched under. A local-model change adds,
 *  removes or renames the `local/*` models, so the cache is dropped when it moves. */
let openInfoKey: string | null = null
/** The server the caches were read from: a restarted server (or a different opencode) may list
 *  other models and commands, so a new one refetches. */
let openInfoServer: OpencodeServerHandle | null = null
function ensureOpenInfo(
    bin: string,
    cwd: string,
    server: OpencodeServerHandle | null,
): Promise<void> {
    if (server !== openInfoServer) {
        openInfoServer = server
        openInfoInFlight = null
        agentsInFlight = null
    }
    if (!openInfoInFlight) {
        openInfoPending = true
        const gen = ++openInfoGen
        const current = () => gen === openInfoGen
        agentsCache = null
        agentsInFlight = null
        const fetching = (async () => {
            if (server?.version === 2) {
                // The three reads run side by side; the agents land first in `agentsCache` so the
                // `agents` frame does not wait on the models.
                const client = server.client
                const agents = readV2Agents(client, cwd, current).then(
                    raw => {
                        if (current()) agentsCache = agentEntriesFromV2(raw)
                    },
                    () => {
                        if (current()) agentsCache = []
                    },
                )
                agentsInFlight = agents
                const [models, commands] = await Promise.all([
                    client
                        .models(cwd)
                        .then(modelEntriesFromV2Models, () => []),
                    client
                        .commands(cwd)
                        .then(commandEntriesFromV2, () => [])
                        .then(withOpencodeBuiltinCommands),
                    agents,
                ])
                if (!current()) return
                modelsCache = models
                commandsCache = commands
                return
            }
            if (server) {
                try {
                    const res = await server.client.config.providers({
                        query: { directory: cwd },
                    })
                    modelsCache = res.data
                        ? modelEntriesFromProviders(res.data.providers)
                        : []
                } catch {
                    modelsCache = []
                }
                try {
                    const res = await server.client.command.list({
                        query: { directory: cwd },
                    })
                    commandsCache = withOpencodeBuiltinCommands(
                        res.data ? commandEntriesFromApi(res.data) : [],
                    )
                } catch {
                    commandsCache = withOpencodeBuiltinCommands([]) // built-ins need no config — always offer them
                }
                try {
                    const res = await server.client.app.agents({
                        query: { directory: cwd },
                    })
                    agentsCache = res.data ? agentEntriesFromV1(res.data) : []
                } catch {
                    agentsCache = []
                }
                return
            }
            try {
                modelsCache = parseOpencodeModelsVerbose(
                    await runCliText(bin, cwd, ['models', '--verbose']),
                )
                if (!modelsCache.length)
                    modelsCache = parseOpencodeModels(
                        await runCliText(bin, cwd, ['models']),
                    )
            } catch {
                modelsCache = []
            }
            // opencode 2's `run` has no command invocation (a `/name` reaches the model as text),
            // so it offers no commands at all rather than ones that cannot run.
            if (usesBackgroundService(await opencodeMajor(bin))) {
                commandsCache = []
                return
            }
            try {
                commandsCache = withOpencodeBuiltinCommands(
                    parseOpencodeDebugConfigCommands(
                        await runCliText(bin, cwd, ['debug', 'config']),
                    ),
                )
            } catch {
                commandsCache = withOpencodeBuiltinCommands([])
            }
        })()
        openInfoInFlight = fetching
        void fetching.finally(() => {
            if (openInfoInFlight === fetching) openInfoPending = false
        })
    }
    return openInfoInFlight
}

/** The manifest frame for an opencode session: the command registry rides `slashCommands` (so the
 *  composer's "/" popover autocompletes opencode commands exactly like Claude's) with per-command
 *  blurbs in `commandDetails`; tools/MCP stay empty (nothing to report — the frontend hides those
 *  pills) and permissionMode is nominal — server-mode sessions CAN answer a live permission ask (see
 *  `permission` frames below), but there is still no drivable mode-switch, so the header's
 *  mode-picker string stays "default" either way (the picker itself is gated on the separate
 *  `permissionModes` capability, which stays false). */
function manifestFrame(s: OpencodeSession): ChatFrame {
    const commands = commandsCache ?? []
    return {
        type: 'manifest',
        manifest: {
            model: s.model ?? '',
            permissionMode: 'default',
            slashCommands: commands.map(c => c.name),
            tools: [],
            mcpServers: [],
            commandDetails: Object.fromEntries(
                commands
                    .filter(c => c.description)
                    .map(c => [c.name, c.description]),
            ),
        },
    }
}

/** Emit the open-time header frames for a fresh/resumed session: the manifest (re-emitted once the
 *  command registry lands, when the first one went out before the fetch finished), the `models`
 *  frame (with the virtual "Zen Free (rotating)" entry prepended when Zen's free roster is
 *  non-empty), and the `auth` frame (`opencode auth list`, re-fetched per open so logging in via a
 *  terminal shows up on the next chat/new-chat without restarting the app). */
function emitOpenFrames(
    s: OpencodeSession,
    server: OpencodeServerHandle | null,
): void {
    const hadCommands = commandsCache !== null
    emit(s, manifestFrame(s))
    // origin "user", always: the daemon runs on the Claude Code SDK and records ITS session ids in
    // <vault>/.daemon/session-ids. An opencode session id comes from a different store in a different
    // id namespace, so it can never be the daemon's — no membership test to make.
    if (s.sessionId)
        emit(s, { type: 'session', sessionId: s.sessionId, origin: 'user' })
    void emitModelsAndAuth(s, server, hadCommands)
}

/** The `models` + `auth` header frames for one session (the manifest again when the command registry
 *  only just landed). Shared by session open and by a provider connect, which re-emits both to every
 *  live session so a freshly connected provider's models appear without reopening the chat. */
async function emitModelsAndAuth(
    s: OpencodeSession,
    server: OpencodeServerHandle | null,
    hadCommands = true,
): Promise<void> {
    const info = ensureOpenInfo(s.bin, s.cwd, server)
    // The `agents` frame goes out as soon as the agent list is known, ahead of the models: Shift+Tab
    // cycles agents only once the frame has arrived.
    let agentsSent = false
    const sendAgents = () => {
        if (agentsSent || sessions.get(s.id) !== s) return
        if (!server || !agentsCache?.length) return
        agentsSent = true
        const agents = agentsCache
        const current =
            s.agent && agents.some(a => a.value === s.agent)
                ? s.agent
                : agents[0].value
        if (!s.appliedAgent && !s.agent) s.appliedAgent = current
        emit(s, { type: 'agents', agents, current })
    }
    void agentsInFlight?.then(sendAgents)
    await info
    if (sessions.get(s.id) !== s) return
    sendAgents()
    if (!hadCommands && commandsCache?.length) emit(s, manifestFrame(s))
    let models = withZenFreeRotate(modelsCache ?? []).map(m =>
        m.group
            ? m
            : {
                  ...m,
                  group: modelGroupFor(
                      m.value.split('/')[0],
                      providerInfos,
                      injectedNames,
                  ),
              },
    )
    // The local model pins the chat to its own server, so only its models are offered.
    if (s.localEnv)
        models = models.filter(m => m.value.startsWith(`${LOCAL_PROVIDER_ID}/`))
    if (models.length) emit(s, { type: 'models', models })
    // opencode 2's server lists its connections itself; `auth list` would boot a second, private
    // server for every chat open.
    const providers =
        server?.version === 2
            ? await server.client
                  .integrations(s.cwd)
                  .then(list =>
                      providerListFromV2(list).connected.map(c => ({
                          name: c.name,
                          kind: c.kind,
                      })),
                  )
                  .catch(() => [])
            : parseOpencodeAuthList(
                  await runCliText(s.bin, s.cwd, ['auth', 'list']).catch(
                      () => '',
                  ),
              )
    if (sessions.get(s.id) === s) emit(s, { type: 'auth', providers })
}

/** The shared server's client for the provider-connect routes (opencode 1's SDK client or the
 *  opencode 2 client), or null when opencode is not installed or its server will not start. */
export async function opencodeClient(): Promise<
    OpencodeClient | OpencodeV2Client | null
> {
    const bin = whichBinary('opencode')
    if (!bin) return null
    const server = await ensureOpencodeServer(bin).catch(() => null)
    return server?.client ?? null
}

/** Why `opencodeClient` has no client, worded for the provider manager, which shows it in place
 *  of its lists. */
export async function opencodeUnavailableMessage(): Promise<string> {
    return 'opencode is not installed, or its server did not start. Install opencode (opencode.ai) to manage providers.'
}

/** After a provider connect: refetch the model list once and re-emit `models` + `auth` to every live
 *  opencode session. */
export function refreshOpencodeFrames(vault?: string): Promise<void> {
    const run = refreshOpencodeFramesOnce(vault)
    const pending = run.catch(() => {})
    refreshInFlight = pending
    void pending.finally(() => {
        if (refreshInFlight === pending) refreshInFlight = null
    })
    return run
}

/** Set while `refreshOpencodeFrames` rebuilds the default server and refetches the lists. The model
 *  list is empty for that whole span, so a model pick waits for it rather than accepting any id. */
let refreshInFlight: Promise<void> | null = null

async function refreshOpencodeFramesOnce(vault?: string): Promise<void> {
    dropOpenInfo()
    if (vault) {
        // A server saved in `.settings` since the last open: rebuild the injected config from the
        // vault's settings and fresh window detection, and put it on the default server.
        const bin = whichBinary('opencode')
        if (bin) {
            const res = await resolveLocalSpawn('opencode', vault).catch(
                () => null,
            )
            const setup = await openDefaultServer(
                bin,
                vault,
                res?.kind === 'ready' ? res.local : null,
            ).catch(() => null)
            if (setup) openInfoKey = opencodeConfigContent(setup.input)
        }
    }
    await Promise.all(
        [...sessions.values()].map(async s => {
            const server =
                s.mode === 'server'
                    ? await ensureOpencodeServer(s.bin).catch(() => null)
                    : null
            await emitModelsAndAuth(s, server)
        }),
    )
}

/** Human-facing refusal text for a restricted vault opencode can't (or can no longer) protect —
 *  shared by session open (getOrCreateSession) and every per-turn re-check (runTurnLegacy, runTurn's
 *  server-mode guard). `why` names the SPECIFIC unmet precondition — never a vague "can't protect
 *  this" — so the message never claims a mechanism that wasn't actually checked.
 *
 *  DISTINCT from core/src/visibility.ts's `visibilityRefusalMessage`, and deliberately not merged with it:
 *  that one answers "this backend has no verified mechanism at all" (decided up-front by the router's
 *  chokepoint, agentBackends/visibilityGate.ts), whereas this one answers "opencode normally CAN
 *  enforce, but a specific precondition failed right here" — wrong platform, no sandbox-exec, or a
 *  session already bound to shared server mode. The `why` is the whole value; collapsing the two
 *  would throw it away. Renamed off the shared name so the distinction is visible at every call. */
function opencodePreconditionRefusal(
    denyEntries: DenyEntry[],
    why: string,
): string {
    const n = denyEntries.length
    return (
        `This vault marks ${n} note${n === 1 ? '' : 's'} off-limits to AI sessions, but ${why}. ` +
        "Switch to Claude Code, or clear the vault's hidden/chat-only notes to use opencode here."
    )
}

/** What the user sees when the vault's restricted set could not be enumerated at all. Distinct from
 *  opencodePreconditionRefusal, which is about a KNOWN restricted set this backend can't enforce. */
function undeterminedRefusal(reason: string): string {
    return (
        "Bismuth couldn't read this vault's visibility settings, so this chat wasn't started rather " +
        `than risk running without them (${reason}). Check the vault's \`.settings\` file, then try again.`
    )
}

/** The restricted set for this vault's chat channel, or the REASON the walk could not determine it.
 *  `buildDenyPaths` throws rather than reporting an empty set for a vault it failed to read (see
 *  core/src/visibility.ts's DenyPlan); every caller here refuses on `undetermined`.
 *
 *  Carries the diagnostic rather than discarding it, matching chat.ts and visibilityGate: the
 *  message a user gets says WHICH file is unparseable, which is the difference between a fixable
 *  error and a mysterious one. */
type DenyLookup =
    { ok: true; entries: DenyEntry[] } | { ok: false; reason: string }

async function denyEntriesOrReason(cwd: string): Promise<DenyLookup> {
    try {
        return { ok: true, entries: await buildDenyPaths(cwd, 'chat') }
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
}

/** Create (or resume) a session, preferring server mode when the shared `opencode serve` process is
 *  up (or comes up within its startup timeout) — see ./opencodeServer.ts. Async because both modes
 *  now involve awaiting something before the session is ready to use (the shared server's startup
 *  promise; a fresh session's `session.create()` call in server mode).
 *
 *  A RESTRICTED vault (see this file's top-of-file VISIBILITY GATE note) never even attempts server
 *  mode — `ensureOpencodeServer` is skipped entirely, so `server` stays null and `mode` resolves to
 *  "run" below, unconditionally. When the OS wrapper itself is unavailable for a restricted vault,
 *  the session is refused outright rather than created unprotected. */
async function getOrCreateSession(
    chatId: string,
    cwd: string,
    sink: ChatSink,
    resume: string | undefined,
    memoryDir: string | undefined,
): Promise<OpencodeSession | null> {
    const bin = whichBinary('opencode')
    if (!bin) {
        sink({
            type: 'error',
            code: 'no-opencode',
            message:
                'The `opencode` CLI was not found. Install opencode (opencode.ai) to use this provider.',
        })
        return null
    }

    // Visibility gate (docs/vault/visibility.md): resolved fresh at every session open, mirroring
    // chat.ts's createSession — see this file's top-of-file note for the full rationale.
    const lookup = await denyEntriesOrReason(cwd)
    if (!lookup.ok) {
        sink({
            type: 'error',
            code: 'visibility-refused',
            binary: 'opencode',
            message: undeterminedRefusal(lookup.reason),
        })
        return null
    }
    const denyEntries = lookup.entries
    const restricted = denyEntries.length > 0
    if (restricted) {
        const availability = checkSandboxWrapperAvailability({
            selfSandboxes: can('opencode', 'selfSandboxes'),
        })
        if (!availability.available) {
            sink({
                type: 'error',
                code: 'visibility-refused',
                binary: 'opencode',
                message: opencodePreconditionRefusal(
                    denyEntries,
                    describeSandboxWrapperUnavailable(availability.reason),
                ),
            })
            return null
        }
    }

    // Local model (the `localModel` setting): resolved fresh at every open. Server down / nothing
    // loaded -> an error frame and no session, never a silent run on opencode's own account.
    const resolved = await resolveOpencodeLocal(cwd, sink)
    if (!resolved.ok) return null
    const local = resolved.local

    // The local model, the vault's saved servers and the detected windows ride the shared server's
    // spawn env; a different config than the live server's replaces it (after any running turn
    // settles — ensureOpencodeServer waits).
    const setup = restricted ? null : await openDefaultServer(bin, cwd, local)
    const input: OpencodeConfigInput = setup?.input ?? {
        local: localInputOf(local),
        servers: [],
        limits: [],
        profile: 'default',
    }
    const content = opencodeConfigContent(input)
    if (content !== openInfoKey) {
        openInfoKey = content
        dropOpenInfo()
    }
    const server = setup?.server ?? null
    const session: OpencodeSession = {
        id: chatId,
        cwd,
        sink,
        sessionId: resume ?? null,
        model: localSessionModel(undefined, local),
        localEnv: local?.env ?? null,
        spawnEnv: content ? { OPENCODE_CONFIG_CONTENT: content } : null,
        configInput: input,
        slot: 'default',
        slotServer: server ?? undefined,
        bin,
        mode: server ? 'server' : 'run',
        memoryDir,
        proc: null,
        turnActive: false,
        aborting: false,
        queue: [],
        turnCount: 0,
        detached: false,
        buffer: [],
        lastActivityAt: Date.now(),
        pendingPermissions: new Set(),
    }
    if (server?.version === 2 && resume) {
        const agent = await server.client.session(resume).then(
            r => r.agent,
            () => undefined,
        )
        if (agent) {
            session.agent = agent
            session.appliedAgent = agent
        }
    }
    if (server?.version === 2 && !resume) {
        // No pick and no local model: opencode's own default model is the session's, so the header
        // names it and its effort variants apply.
        if (!session.model) {
            const fallback = defaultModelFromV2(
                await server.client.defaultModel(cwd).catch(() => null),
            )
            if (fallback) session.model = fallback
        }
        const ref = session.model ? opencodeV2ModelRef(session.model) : null
        try {
            session.sessionId = await server.client.createSession(cwd, ref)
            session.untitled = true
            if (ref) session.serverModel = `${session.model}#`
        } catch {
            sink({
                type: 'error',
                code: 'spawn',
                message: 'The opencode server could not start a session.',
            })
            return null
        }
    } else if (server?.version === 1 && !resume) {
        let created: { data?: { id?: string }; error?: unknown } | null = null
        try {
            created = await server.client.session.create({
                body: {},
                query: { directory: cwd },
            })
        } catch (e) {
            created = { error: e }
        }
        if (!created || created.error || !created.data?.id) {
            sink({
                type: 'error',
                code: 'spawn',
                message: 'The opencode server could not start a session.',
            })
            return null
        }
        session.sessionId = created.data.id
    }
    sessions.set(chatId, session)
    emitOpenFrames(session, server)
    return session
}

/** The system text a server-mode turn carries: how the chat renders the reply
 *  (CHAT_RENDERING_NOTE), how to cite a note's lines when the editor shows line numbers
 *  (chatLineRefNote.ts), then the memory — the session-start brain block (fetched once per
 *  session) and the recall for THIS prompt — when the vault has a memory dir. opencode 1 sends it
 *  as the prompt's `system`; opencode 2 stores it in a session instructions entry before the
 *  prompt. */
async function turnSystemText(
    s: OpencodeSession,
    text: string,
    opts?: { compact?: boolean },
): Promise<string> {
    // How to cite a note's lines, read from .settings every turn so a toggle applies on the next
    // message (chatLineRefNote.ts; '' with line numbers off).
    const lineRefNote = await chatLineRefNoteFor(s.cwd)
    const head = [CHAT_RENDERING_NOTE, lineRefNote].filter(Boolean)
    if (!s.memoryDir) return head.join('\n\n')
    // `system` is per-call (fresh every turn), so the session ledger would wrongly suppress notes
    // on later turns: reset it before each recall.
    const svc = recallServiceFor(s.cwd, s.memoryDir)
    svc.reset(s.sessionId as string)
    const recalled = await recallWithin(
        svc,
        {
            mode: 'prompt',
            sessionId: s.sessionId as string,
            prompt: text,
        },
        1500,
    ).catch(() => null)
    // `system` is per-call, so EVERY turn carries the session-start brain block (profile, vault
    // map, memory index) ahead of that turn's recall. Fetched once per session and reused; opencode
    // exposes no compact/clear hook to refetch on. Via the recall service so the settings gate
    // applies.
    // The compact profile is for windows too small for the brain block, so it carries the recall only.
    let brainText = opts?.compact ? '' : brainBySession.get(s)
    if (brainText === undefined) {
        const b = await recallWithin(
            svc,
            {
                mode: 'session-start',
                sessionId: s.sessionId as string,
                source: 'startup',
                channel: 'chat',
            },
            3000,
        ).catch(() => null)
        brainText = b?.context ?? ''
        // Cache only a real brain block; a timeout, no-match or a map not ready yet retries next
        // turn.
        if (b?.context && b.context.includes('# Vault map'))
            brainBySession.set(s, b.context)
    }
    const parts = [brainText, recalled?.context].filter((p): p is string => !!p)
    return [...head, ...parts].join('\n\n')
}

/** opencode 1's `session.prompt` body: the model split into provider and model ids, the agent only
 *  when one was picked (opencode otherwise runs its default), the per-turn system text and the
 *  prompt parts. Pure. */
export function v1TurnBody<P>(
    s: { agent?: string },
    model: string | null | undefined,
    system: string,
    parts: P,
): {
    model?: NonNullable<ReturnType<typeof splitOpencodeModelId>>
    agent?: string
    system: string
    parts: P
} {
    const modelObj = model ? splitOpencodeModelId(model) : null
    return {
        ...(modelObj ? { model: modelObj } : {}),
        ...(s.agent ? { agent: s.agent } : {}),
        system,
        parts,
    }
}

/** Send one turn against the shared opencode SERVER: registers a listener on the server's global
 *  event stream for real-time deltas/tool progress (unregistered once the call settles — see
 *  opencodeServer.ts), then awaits `session.prompt()` (or `session.command()` for a leading
 *  `/known-command`) — that HTTP call blocks until the model's reply is fully generated (verified
 *  live) and its response carries the turn's authoritative cost + any error, so THAT settling, not
 *  any event, is what ends the turn here. A permission ask mid-turn parks as a `permission` frame
 *  answered by respondPermission (POST .../permissions/{id}), which resolves the SAME blocked
 *  session.prompt() call once answered (verified live for both "once" and "reject"). */
async function runTurnServer(
    s: OpencodeSession,
    text: string,
    images: ChatImage[] | undefined,
    server: ServerV1,
): Promise<void> {
    s.turnActive = true
    s.lastActivityAt = Date.now()
    const state = newOpencodeServerTurnState()
    const commandNames = (commandsCache ?? []).map(c => c.name)
    const slash = parseOpencodeRunCommand(text, commandNames)
    // The virtual "Zen Free (rotating)" model resolves to a REAL free Zen model per turn — round-robin
    // over the currently-free roster; an empty roster omits `model` (opencode's default).
    const model =
        s.model === ZEN_FREE_ROTATE_ID
            ? pickZenFreeModel(zenFreeModelIds(modelsCache ?? []), s.turnCount)
            : s.model
    s.turnCount += 1

    const unregister = registerOpencodeServerListener(
        s.sessionId as string,
        ev => {
            for (const frame of translateOpencodeServerEvent(ev, state))
                emit(s, frame)
            const asked = parseOpencodePermissionAsk(ev)
            if (asked && !s.pendingPermissions.has(asked.id)) {
                s.pendingPermissions.add(asked.id)
                emit(s, {
                    type: 'permission',
                    id: asked.id,
                    toolName: asked.toolName,
                    input: asked.input,
                })
            }
        },
    )

    let isError = false
    let costUsd: number | null = null
    // The authoritative final message parts off the HTTP response. Held here (rather than emitted at
    // the call site) so reconciliation runs AFTER the listener is torn down — no late SSE event can
    // then interleave with it — but BEFORE `result`/`done`, so the text still lands in the right order.
    let finalParts: unknown = null
    try {
        // Per-turn memory injection (RE-FIX: opencode had none before server mode): recall off the
        // CURRENT prompt and ride it as `system` — a genuine per-call override, verified live
        // (SessionPromptData.system), so this is real auto-recall, not a once-per-session digest.
        const system = await turnSystemText(s, text)
        if (slash) {
            const res = await server.client.session.command({
                path: { id: s.sessionId as string },
                query: { directory: s.cwd },
                body: {
                    command: slash.command,
                    arguments: slash.args,
                    ...(model ? { model } : {}),
                    ...(s.agent ? { agent: s.agent } : {}),
                },
            })
            if (res.error) {
                isError = true
                emit(s, {
                    type: 'error',
                    code: 'error',
                    message: overflowText(
                        model,
                        opencodeErrorMessage({ error: res.error }),
                    ),
                })
            } else if (res.data?.info?.error) {
                isError = !s.aborting
                if (!s.aborting)
                    emit(s, {
                        type: 'error',
                        code: 'error',
                        message: overflowText(
                            model,
                            opencodeErrorMessage({
                                error: res.data.info.error,
                            }),
                        ),
                    })
            }
            costUsd = opencodeTurnCost(res.data?.info?.cost)
            finalParts = res.data?.parts ?? null
        } else {
            const parts = buildOpencodePromptParts(text, images)
            const res = await server.client.session.prompt({
                path: { id: s.sessionId as string },
                query: { directory: s.cwd },
                body: v1TurnBody(s, model, system, parts),
            })
            if (res.error) {
                isError = true
                emit(s, {
                    type: 'error',
                    code: 'error',
                    message: overflowText(
                        model,
                        opencodeErrorMessage({ error: res.error }),
                    ),
                })
            } else if (res.data?.info?.error) {
                // A deliberate Stop resolves session.prompt() with info.error.name === "MessageAbortedError"
                // (verified live via session.abort()) — that's a clean cancel, not a turn failure.
                isError = !s.aborting
                if (!s.aborting)
                    emit(s, {
                        type: 'error',
                        code: 'error',
                        message: overflowText(
                            model,
                            opencodeErrorMessage({
                                error: res.data.info.error,
                            }),
                        ),
                    })
            }
            costUsd = opencodeTurnCost(res.data?.info?.cost)
            finalParts = res.data?.parts ?? null
        }
    } catch (e) {
        isError = !s.aborting
        if (!s.aborting)
            emit(s, {
                type: 'error',
                code: 'error',
                message: overflowText(
                    model,
                    e instanceof Error ? e.message : String(e),
                ),
            })
    } finally {
        unregister()
    }

    // Captured BEFORE the reset below: a deliberate Stop must not have the cancelled turn's partial
    // text replayed at it, and `s.aborting` is cleared on the very next line.
    const wasAborted = s.aborting
    s.aborting = false
    // The session may have been closed (closeChat) while this turn ran — nothing left to report to.
    if (sessions.get(s.id) !== s) return

    // Emit anything the event stream never delivered (see reconcileOpencodeFinalParts): the HTTP
    // response is the source of truth for what the model actually said, the stream only makes it
    // appear sooner. A fully-streamed turn reconciles to zero frames.
    if (!wasAborted)
        for (const frame of reconcileOpencodeFinalParts(finalParts, state))
            emit(s, frame)

    endServerTurn(s, text, isError, costUsd)
}

/** The tail every server-mode turn shares: `result` + `done`, the tab title off the first prompt,
 *  then the next queued turn. */
function endServerTurn(
    s: OpencodeSession,
    text: string,
    isError: boolean,
    costUsd: number | null,
): void {
    emit(s, { type: 'result', isError, numTurns: 1, costUsd })
    emit(s, { type: 'done' })
    if (!s.titleSent) {
        const title = titleFromPrompt(text)
        if (title) {
            s.titleSent = true
            emit(s, { type: 'title', title })
        }
    }
    s.turnActive = false
    s.lastActivityAt = Date.now()
    const next = s.queue.shift()
    if (next) void runTurn(s, next.text, next.images)
}

/** A chat image as an opencode 2 prompt file: a `data:` URI the server inlines. Pure. */
export function opencodeV2Files(
    images: ChatImage[] | undefined,
): OpencodeV2File[] {
    return (images ?? []).map((im, i) => ({
        uri: `data:${im.media_type};base64,${im.data}`,
        name: `image-${i + 1}.${im.media_type.split('/')[1] || 'png'}`,
    }))
}

/** One try of a turn on one opencode 2 server slot. */
type V2Attempt = {
    state: OpencodeV2TurnState
    gaveUp: string | null
    streamLost: boolean
    /** The message of a call that threw (not a Stop). */
    thrown: string | null
    /** Whether any frame reached the chat: a retry is invisible only while none has. */
    emitted: boolean
    /** Whether the prompt reached the session, which then holds this attempt's user message. */
    prompted: boolean
}

/** Make sure the opencode session exists on this server slot. A real opencode keeps sessions in one
 *  store every server reads; a server that does not know the id gets a fresh session, announced so
 *  the chat follows it. */
async function adoptSessionOnSlot(
    s: OpencodeSession,
    server: ServerV2,
    profile: OpencodeProfile,
    model: string | null | undefined,
    text: string,
): Promise<boolean> {
    if (s.slot === profile && s.slotServer === server) return false
    const client = server.client
    const known = await client.session(s.sessionId as string).then(
        () => true,
        e => !(e instanceof OpencodeV2Error && e.status === 404),
    )
    let announced = false
    if (!known) {
        const ref = model ? opencodeV2ModelRef(model) : null
        s.sessionId = await client.createSession(
            s.cwd,
            ref,
            s.agent ?? null,
            titleFromPrompt(text) || null,
        )
        s.untitled = false
        emit(s, { type: 'session', sessionId: s.sessionId, origin: 'user' })
        announced = true
    }
    s.slot = profile
    s.slotServer = server
    s.serverModel = undefined
    s.appliedAgent = undefined
    return announced
}

async function v2Attempt(
    s: OpencodeSession,
    text: string,
    images: ChatImage[] | undefined,
    server: ServerV2,
    profile: OpencodeProfile,
    model: string | null | undefined,
    slash: { command: string; args: string } | null,
): Promise<V2Attempt> {
    const client = server.client
    s.turnProfile = profile
    const att: V2Attempt = {
        state: newOpencodeV2TurnState(),
        gaveUp: null,
        streamLost: false,
        thrown: null,
        emitted: false,
        prompted: false,
    }
    const out = (frame: ChatFrame) => {
        att.emitted = true
        emit(s, frame)
    }
    try {
        att.emitted = await adoptSessionOnSlot(s, server, profile, model, text)
    } catch (e) {
        att.thrown = e instanceof Error ? e.message : String(e)
        return att
    }
    const sessionId = s.sessionId as string
    const state = att.state

    let ended!: () => void
    const whenEnded = new Promise<void>(resolve => (ended = resolve))
    const unregister = registerOpencodeServerListener(
        sessionId,
        ev => {
            if ((ev as { type?: unknown }).type === OPENCODE_STREAM_CLOSED) {
                att.streamLost = true
                ended()
                return
            }
            for (const frame of translateOpencodeV2Event(ev, state)) out(frame)
            const asked = parseOpencodeV2PermissionAsk(ev)
            if (asked && !s.pendingPermissions.has(asked.id)) {
                s.pendingPermissions.add(asked.id)
                out({
                    type: 'permission',
                    id: asked.id,
                    toolName: asked.toolName,
                    input: asked.input,
                })
            }
            const stop = opencodeV2RetryGiveUp(ev)
            if (stop && !att.gaveUp) {
                att.gaveUp = stop
                void client.interrupt(sessionId).catch(() => {})
            }
            if (state.outcome) ended()
        },
        profile,
    )

    try {
        const system = await turnSystemText(s, text, {
            compact: profile === 'compact',
        })
        // Best-effort: the entries route is experimental, and a turn without its system text still runs.
        await client
            .putInstruction(sessionId, SYSTEM_ENTRY_KEY, system)
            .catch(() => {})
        const levels =
            (modelsCache ?? []).find(m => m.value === model)?.effortLevels ?? []
        const ref = model ? opencodeV2TurnModel(model, s.effort, levels) : null
        const key = ref ? `${model}#${ref.variant ?? ''}` : undefined
        if (ref && key !== s.serverModel) {
            await client.switchModel(sessionId, ref)
            s.serverModel = key
        }
        if (s.agent && s.agent !== s.appliedAgent) {
            await client.switchAgent(sessionId, s.agent)
            s.appliedAgent = s.agent
        }
        // Stopped while memory or the model was being applied: nothing was sent, so nothing runs.
        if (!s.aborting) {
            const title = s.untitled ? titleFromPrompt(text) : ''
            if (title) {
                // Best-effort: an untitled session still runs, after opencode names it itself.
                await client.setTitle(sessionId, title).catch(() => {})
                s.untitled = false
            }
            if (slash)
                await client.command(sessionId, slash.command, slash.args)
            else
                await client.prompt(sessionId, {
                    text,
                    files: opencodeV2Files(images),
                })
            att.prompted = true
            await whenEnded
        }
    } catch (e) {
        if (!s.aborting) att.thrown = e instanceof Error ? e.message : String(e)
    } finally {
        unregister()
    }
    return att
}

/** Drop a failed attempt from its session: its user message and everything after it (the errored
 *  reply). Every opencode server reads one session store, so the retry on the compact server
 *  continues this same session, and without this it would hold the turn's user message twice.
 *  Earlier turns stay. Best-effort: a turn that answers matters more than a clean history. */
async function dropFailedAttempt(
    server: ServerV2,
    sessionId: string | null,
): Promise<void> {
    if (!sessionId) return
    try {
        const msgs = await server.client.messages(sessionId)
        for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i] as { type?: unknown; id?: unknown } | null
            if (m?.type !== 'user' || typeof m.id !== 'string') continue
            await server.client.revertFrom(sessionId, m.id)
            return
        }
    } catch {
        /* the retry still runs; the history keeps the failed attempt */
    }
}

/** The overflow text of a failed attempt, or null when it did not fail on the window. */
function v2OverflowOf(att: V2Attempt): string | null {
    const outcome = att.state.outcome
    const candidates = [
        att.thrown,
        att.gaveUp,
        outcome?.kind === 'failed' ? outcome.message : null,
    ]
    return candidates.find(c => c && isContextOverflow(c)) ?? null
}

/** Send one turn to an opencode 2 server. Its prompt call returns at once (the message joins the
 *  session's inbox), so the turn is the span between posting it and the session's
 *  `session.execution.succeeded|failed|interrupted` event; everything in between streams off the
 *  shared event stream (opencodeV2Translate.ts). Model and memory are per session on opencode 2,
 *  so they are applied to the session just before the prompt. A provider that keeps failing is
 *  stopped after OPENCODE_V2_MAX_ATTEMPTS rather than retried forever.
 *
 *  A prompt that overflows the model's loaded window is retried once, invisibly, on the compact
 *  profile (a second server with a small prompt), in the same session with the failed attempt
 *  dropped from it; the model is then remembered, and its later turns start there. A compact turn
 *  that still overflows ends with the overflow error. */
async function runTurnServerV2(
    s: OpencodeSession,
    text: string,
    images: ChatImage[] | undefined,
    server0: ServerV2,
): Promise<void> {
    s.turnActive = true
    s.lastActivityAt = Date.now()
    const slash = parseOpencodeRunCommand(
        text,
        (commandsCache ?? []).map(c => c.name),
    )
    const model =
        s.model === ZEN_FREE_ROTATE_ID
            ? pickZenFreeModel(zenFreeModelIds(modelsCache ?? []), s.turnCount)
            : s.model
    s.turnCount += 1

    let server = server0
    if (model) {
        const fresh = await recheckWindow(s, model).catch(() => null)
        // A window recheck in another chat may have replaced the default server since this turn
        // was queued: the live one carries the turn, never a killed handle.
        const live = fresh
            ? null
            : await ensureOpencodeServer(s.bin, undefined, 'default').catch(
                  () => null,
              )
        server = fresh ?? (live?.version === 2 ? live : null) ?? server0
    }
    const compactServer = async (): Promise<ServerV2 | null> => {
        const input = {
            ...(liveInput ?? s.configInput),
            profile: 'compact',
        } as const
        const h = await ensureOpencodeServer(
            s.bin,
            configEnv(input),
            'compact',
        ).catch(() => null)
        return h?.version === 2 ? h : null
    }

    let profile: OpencodeProfile = 'default'
    let target = server
    const key = compactKey(model)
    if (compactModels.has(key)) {
        const c = await compactServer()
        if (c) {
            target = c
            profile = 'compact'
        }
    }
    let att = await v2Attempt(s, text, images, target, profile, model, slash)
    if (
        profile === 'default' &&
        !att.emitted &&
        !s.aborting &&
        v2OverflowOf(att)
    ) {
        const c = await compactServer()
        if (c) {
            compactModels.add(key)
            profile = 'compact'
            // Through the compact server: every server shares the store, and the default one may
            // have been replaced (and killed) while the compact one spawned.
            if (att.prompted) await dropFailedAttempt(c, s.sessionId)
            att = await v2Attempt(s, text, images, c, profile, model, slash)
        }
    } else if (v2OverflowOf(att)) {
        compactModels.add(key)
    }

    const wasAborted = s.aborting
    s.aborting = false
    if (sessions.get(s.id) !== s) return
    let message = att.thrown
    if (message === null && !wasAborted) {
        const outcome = att.state.outcome
        message = att.gaveUp
            ? att.gaveUp
            : att.streamLost
              ? 'Lost connection to the opencode server.'
              : outcome?.kind === 'failed'
                ? outcome.message
                : outcome?.kind === 'interrupted' && !att.state.declined
                  ? `opencode stopped the turn (${outcome.reason || 'interrupted'}).`
                  : null
    }
    let isError = false
    if (message) {
        isError = true
        emit(s, {
            type: 'error',
            code: 'error',
            message: overflowText(model, message),
        })
    }
    endServerTurn(s, text, isError, att.state.costUsd)
}

/** Emit a terminal error+result+done for a turn that never ran (a visibility refusal, a lost
 *  server connection, …) and dispatch whatever's queued next — the four-frame tail every
 *  early-refusal path needs. */
function refuseTurn(
    s: OpencodeSession,
    message: string,
    code: 'error' | 'visibility-refused' = 'error',
): void {
    s.turnActive = true
    emit(s, {
        type: 'error',
        code,
        ...(code === 'visibility-refused' ? { binary: 'opencode' } : {}),
        message,
    })
    emit(s, { type: 'result', isError: true, numTurns: 1, costUsd: null })
    emit(s, { type: 'done' })
    s.turnActive = false
    s.lastActivityAt = Date.now()
    const next = s.queue.shift()
    if (next) void runTurn(s, next.text, next.images)
}

/** Spawn one `opencode run --format json` for this turn and stream its events as ChatFrames (RUN
 *  mode — the fallback path for an opencode too old to `serve`, OR the forced path for a vault the
 *  visibility gate restricts — see this file's top-of-file VISIBILITY GATE note). */
async function runTurnLegacy(
    s: OpencodeSession,
    text: string,
    retried = false,
): Promise<void> {
    s.turnActive = true
    s.lastActivityAt = Date.now()

    // Visibility gate, recomputed FRESH every turn — never cached. Run mode's one-subprocess-per-turn
    // shape means a vault edit (a note just marked hidden, or un-marked) takes effect on the very next
    // turn with nothing to invalidate, unlike Claude's spawn-fixed managedSettings (which needs an
    // explicit respawn — see docs/vault/visibility.md's "Mid-session change" table). This also covers
    // a session whose MODE was locked to "run" for an unrelated reason (an old opencode with no
    // `serve` support) at a point when the vault had nothing restricted yet.
    const legacyLookup = await denyEntriesOrReason(s.cwd)
    if (!legacyLookup.ok)
        return refuseTurn(
            s,
            undeterminedRefusal(legacyLookup.reason),
            'visibility-refused',
        )
    const denyEntries = legacyLookup.entries
    let profilePath: string | null = null
    if (denyEntries.length > 0) {
        const availability = checkSandboxWrapperAvailability({
            selfSandboxes: can('opencode', 'selfSandboxes'),
        })
        if (!availability.available) {
            return refuseTurn(
                s,
                opencodePreconditionRefusal(
                    denyEntries,
                    describeSandboxWrapperUnavailable(availability.reason),
                ),
                'visibility-refused',
            )
        }
        profilePath = await materializeSandboxProfile(
            s.cwd,
            buildSandboxDenyPaths(denyEntries, s.cwd),
        )
    }

    // opencode's local sqlite rejects concurrent openers at cold start ("database is locked" —
    // observed live when a session-open discovery fetch and the first turn's run spawned together).
    // Await the shared open-info chain before spawning so the first turn never races it; afterwards
    // the caches make this a no-op. (Also required here: the command registry below and the Zen
    // free-rotation roster both come off these caches.)
    if (openInfoInFlight) await openInfoInFlight.catch(() => null)
    const state = newOpencodeTurnState()
    // A leading `/name` matching a KNOWN opencode command runs as `--command name <args>` —
    // opencode's non-interactive command invocation (the composer autocompletes these off the
    // manifest; RE-FIX #90). Anything else is an ordinary prompt.
    const slash = parseOpencodeRunCommand(
        text,
        (commandsCache ?? []).map(c => c.name),
    )
    // The virtual "Zen Free (rotating)" model resolves to a REAL free Zen model per turn —
    // round-robin over the currently-free roster; an empty roster omits `-m` (opencode's default).
    const model =
        s.model === ZEN_FREE_ROTATE_ID
            ? pickZenFreeModel(zenFreeModelIds(modelsCache ?? []), s.turnCount)
            : s.model
    if (!retried) s.turnCount += 1
    const sessionBefore = s.sessionId
    const compact = compactModels.has(compactKey(model))
    const major = await opencodeMajor(s.bin)
    // opencode 2 shell-quotes a message argument that contains whitespace before sending it, so the
    // model would read `"fix the bug"` with literal quotes; stdin reaches it verbatim.
    const viaStdin = usesBackgroundService(major) && !slash
    const cliArgs = opencodeCliArgs(major, [
        'run',
        '--format',
        'json',
        // Non-interactive runs can't answer permission prompts — auto-approve anything not explicitly
        // denied by the user's own opencode config (the same posture as the app's Claude default,
        // bypassPermissions). Their config's explicit denies still win.
        '--auto',
        ...(s.sessionId ? ['-s', s.sessionId] : []),
        ...(model ? ['-m', model] : []),
        ...(s.agent ? ['--agent', s.agent] : []),
        ...(slash
            ? ['--command', slash.command, ...(slash.args ? [slash.args] : [])]
            : viaStdin
              ? []
              : [text]),
    ])
    if (!cliArgs)
        return refuseTurn(
            s,
            'This opencode version cannot run a command from a chat turn.',
            'error',
        )
    const args = [s.bin, ...cliArgs]
    // Wrapped only when `profilePath` is non-null (something restricted AND the OS wrapper is
    // available — see above); an unrestricted vault's argv is byte-identical to before this gate
    // existed, never paying sandbox-exec's overhead.
    const wrappedArgs = wrapArgv(args, profilePath)
    let proc: ReturnType<typeof Bun.spawn>
    try {
        proc = Bun.spawn(wrappedArgs, {
            cwd: s.cwd,
            stdin: viaStdin ? new Blob([text]) : 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            env: opencodeSpawnEnv(
                s.cwd,
                compact
                    ? configEnv({ ...s.configInput, profile: 'compact' })?.env
                    : s.spawnEnv,
            ),
        })
    } catch (e) {
        s.turnActive = false
        emit(s, { type: 'error', code: 'spawn', message: (e as Error).message })
        return
    }
    s.proc = proc

    // Collect stderr in parallel (small: progress/banner lines) for the non-zero-exit error message.
    const stderrPromise = new Response(proc.stderr as ReadableStream)
        .text()
        .catch(() => '')

    // NDJSON pump: buffer stdout chunks, translate each complete line's event into frames.
    let sawErrorFrame = false
    // An overflow of the loaded window on the default profile is held back: it is retried once on
    // the compact profile after the process exits, and nothing of the failed attempt shows.
    let heldOverflow = false
    let anyFrame = false
    try {
        const decoder = new TextDecoder()
        let pending = ''
        for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
            pending += decoder.decode(chunk, { stream: true })
            let nl: number
            while ((nl = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, nl).trim()
                pending = pending.slice(nl + 1)
                if (!line) continue
                let ev: unknown
                try {
                    ev = JSON.parse(line)
                } catch {
                    continue // non-JSON noise on stdout — skip the line, never the turn
                }
                const before = state.sessionId
                for (const frame of translateOpencodeEvent(ev, state)) {
                    if (frame.type === 'error') {
                        if (isContextOverflow(frame.message)) {
                            if (!compact && !anyFrame) {
                                heldOverflow = true
                                continue
                            }
                            sawErrorFrame = true
                            emit(s, {
                                ...frame,
                                message: overflowText(model, frame.message),
                            })
                            continue
                        }
                        sawErrorFrame = true
                    } else anyFrame = true
                    emit(s, frame)
                }
                // The durable opencode session id, the moment it's first learned — the client persists it
                // (chatSessionStore) so a reopened tab resumes THIS conversation.
                if (
                    state.sessionId &&
                    state.sessionId !== before &&
                    state.sessionId !== s.sessionId
                ) {
                    s.sessionId = state.sessionId
                    emit(s, {
                        type: 'session',
                        sessionId: state.sessionId,
                        origin: 'user',
                    }) // never the daemon's — see emitOpenFrames
                }
            }
        }
    } catch {
        /* stream torn down mid-read (kill/abort) — the exit handler below reports the outcome */
    }

    const exitCode = await proc.exited.catch(() => 1)
    const stderr = await stderrPromise
    const wasAborting = s.aborting
    s.aborting = false
    s.proc = null

    // The session may have been closed (closeChat) while this turn ran — nothing left to report to.
    if (sessions.get(s.id) !== s) return

    if (heldOverflow && !wasAborting) {
        compactModels.add(compactKey(model))
        // `run` has no revert, so a retry with `-s` would leave the failed attempt's prompt in the
        // session beside the retry's (two user messages), and its history would push the compact
        // run over its own window. When the failed attempt started the session, the retry starts a
        // new one instead (announced by its `session` frame) and the failed one is deleted.
        if (!sessionBefore && s.sessionId) {
            const failed = s.sessionId
            s.sessionId = null
            await runCliText(s.bin, s.cwd, ['session', 'delete', failed]).catch(
                () => '',
            )
            if (sessions.get(s.id) !== s) return
        }
        return runTurnLegacy(s, text, true)
    }

    // `sandbox_apply` failing (exit 71) means the OS gate never actually engaged for this turn —
    // ALWAYS a refusal to surface plainly, never an ordinary CLI failure to fold into the generic
    // stderr-tail message below (agentBackends/sandboxWrapper.ts's isSandboxApplyFailure/P4). Only
    // meaningful when this turn WAS wrapped (profilePath !== null) — an unwrapped turn exiting 71 for
    // some unrelated reason (opencode's own use of that code, however unlikely) gets the normal path.
    const sandboxApplyFailed =
        profilePath !== null && isSandboxApplyFailure(exitCode)
    const failed = (exitCode !== 0 && !wasAborting) || sandboxApplyFailed
    if (failed && !sawErrorFrame) {
        const message = sandboxApplyFailed
            ? 'The OS sandbox could not be applied to this turn (exit 71) — refusing rather than running it unprotected.'
            : stderr.trim().split('\n').slice(-3).join('\n').trim() ||
              `opencode exited with code ${exitCode}`
        emit(s, { type: 'error', code: 'error', message })
    }
    // A run that streamed an error event still EXITS 0 (verified live: an API 401 → error event,
    // exit code 0) — the result must report the failure either way or the footer shows a clean turn.
    emit(s, {
        type: 'result',
        isError: failed || sawErrorFrame,
        numTurns: 1,
        costUsd: state.costUsd,
    })
    emit(s, { type: 'done' })
    // Name the tab off the first prompt (opencode's own session titling is async + truncated-prompt
    // based anyway) — latched once, like chat.ts maybeEmitTitle.
    if (!s.titleSent) {
        const title = titleFromPrompt(text)
        if (title) {
            s.titleSent = true
            emit(s, { type: 'title', title })
        }
    }
    s.turnActive = false
    s.lastActivityAt = Date.now()

    // Dispatch the next staged turn, if any (the exit handler is the serialization point).
    const next = s.queue.shift()
    if (next) void runTurn(s, next.text, next.images)
}

/** Dispatch one turn on whichever mode this session settled on at creation. A SERVER-mode session
 *  whose shared server has since crashed (rare — see opencodeServer.ts's watchExit) reports a clean
 *  error rather than silently spawning a run-mode subprocess mid-session (the two modes have
 *  different opencode session-id semantics; switching underneath a live chat would be surprising).
 *
 *  A SERVER-mode session can never be retrofitted with the OS wrapper (this file's top-of-file
 *  VISIBILITY GATE note, P3: the shared `serve` process multiplexes every vault this core hosts, so
 *  a profile scoped to ONE vault can't be applied to it). If this vault has since restricted a note
 *  (it had nothing restricted when the session was created — see getOrCreateSession), the turn is
 *  refused outright rather than answered unprotected; closing the chat and reopening it re-runs the
 *  gate at session-creation time and correctly lands on the wrapped run path. */
async function runTurn(
    s: OpencodeSession,
    text: string,
    images?: ChatImage[],
): Promise<void> {
    if (s.modelPick) await s.modelPick
    if (s.mode === 'run') return runTurnLegacy(s, text)

    const lookup = await denyEntriesOrReason(s.cwd)
    if (!lookup.ok)
        return refuseTurn(
            s,
            undeterminedRefusal(lookup.reason),
            'visibility-refused',
        )
    const denyEntries = lookup.entries
    if (denyEntries.length > 0) {
        return refuseTurn(
            s,
            opencodePreconditionRefusal(
                denyEntries,
                "this chat already started on opencode's shared server mode, which can't enforce that — close this chat and start a new one",
            ),
            'visibility-refused',
        )
    }

    const server = await ensureOpencodeServer(
        s.bin,
        undefined,
        'default',
    ).catch(() => null)
    if (!server) return refuseTurn(s, 'Lost connection to the opencode server.')
    return server.version === 2
        ? runTurnServerV2(s, text, images, server)
        : runTurnServer(s, text, images, server)
}

/** Queue-or-run gate shared by sendMessage's two call sites (existing session / freshly created). */
function dispatchTurn(
    s: OpencodeSession,
    text: string,
    images?: ChatImage[],
): void {
    if (images?.length && s.mode !== 'server') {
        emit(s, {
            type: 'error',
            code: 'error',
            message:
                "Image attachments need the opencode server mode, which isn't available for this session — remove the image or switch the provider to Claude Code.",
        })
        return
    }
    if (s.turnActive) {
        s.queue.push({ text, images })
        return
    }
    void runTurn(s, text, images)
}

/** Send a user turn — creates the session on first use (mirrors chat.ts sendMessage). Images ride
 *  `FilePartInput` parts in server mode; run mode still has no attachment flag (see dispatchTurn). */
export function sendMessage(
    chatId: string,
    text: string,
    cwd: string,
    sink: ChatSink,
    images?: ChatImage[],
    memoryDir?: string,
): void {
    const existing = sessions.get(chatId)
    if (!existing) {
        // PRE-EXISTING GAP, out of scope here: getOrCreateSession is async, so the session isn't
        // registered in `sessions` until this await resolves. A WS close landing in that window finds
        // no session yet (detachSink no-ops) and, once creation DOES complete, the now-dead sink is
        // never detached and no grace-close timer is ever armed for it — an attached session with
        // nowhere to send frames and no teardown scheduled. Not reachable via the identity-guard work in
        // this file (that guards an EXISTING session's re-detach, not a session that doesn't exist yet);
        // would need its own fix (e.g. a placeholder session registered before the await).
        void (async () => {
            const created = await getOrCreateSession(
                chatId,
                cwd,
                sink,
                undefined,
                memoryDir,
            )
            if (!created) return // no-opencode/spawn error already pushed
            dispatchTurn(created, text, images)
        })()
        return
    }
    reattachSessionSink(existing, sink)
    existing.cwd = cwd
    dispatchTurn(existing, text, images)
}

/** Eagerly open a session (chat WS `open`) so the header's manifest + models land before the
 *  first message — the opencode twin of chat.ts openSession. */
export function openSession(
    chatId: string,
    cwd: string,
    sink: ChatSink,
    memoryDir?: string,
): void {
    if (sessions.has(chatId)) return
    void getOrCreateSession(chatId, cwd, sink, undefined, memoryDir)
}

/** Bind this chat to an EXISTING opencode session (ses_…): the next turn continues it with full
 *  context. History replay is served separately over HTTP (sessionHistoryFrames below), mirroring
 *  the Claude resume flow. */
export function resumeSession(
    chatId: string,
    sessionId: string,
    cwd: string,
    sink: ChatSink,
    memoryDir?: string,
): void {
    if (sessions.has(chatId)) closeChat(chatId)
    void getOrCreateSession(chatId, cwd, sink, sessionId, memoryDir)
}

/** Replay a past opencode session as ChatFrames. Prefers the shared server's typed
 *  `GET /session/{id}/message` (verified live to carry the same per-message `{info:{role},parts}`
 *  shape `opencode export`'s JSON does); falls back to `opencode export` (stdout JSON) when no
 *  server is available — both read the SAME on-disk session store, so a session created under one
 *  mode replays fine under the other. Tolerant: any failure yields []. */
export async function sessionHistoryFrames(
    sessionId: string,
    cwd: string,
): Promise<ChatFrame[]> {
    const bin = whichBinary('opencode')
    if (!bin || !/^[\w-]+$/.test(sessionId)) return []
    const server = await ensureOpencodeServer(bin).catch(() => null)
    if (server?.version === 2) {
        try {
            return translateOpencodeSessionMessages(
                await server.client.messages(sessionId),
            )
        } catch {
            /* fall through to the CLI export fallback below */
        }
    } else if (server) {
        try {
            const res = await server.client.session.messages({
                path: { id: sessionId },
                query: { directory: cwd },
            })
            if (res.data) return translateOpencodeSessionMessages(res.data)
        } catch {
            /* fall through to the CLI export fallback below */
        }
    }
    try {
        const argv = opencodeCliArgs(await opencodeMajor(bin), [
            'export',
            sessionId,
        ])
        if (!argv) return []
        const proc = Bun.spawn([bin, ...argv], {
            cwd,
            stdout: 'pipe',
            stderr: 'ignore',
            env: opencodeSpawnEnv(cwd),
        })
        const out = await new Response(proc.stdout as ReadableStream).text()
        await proc.exited
        const json = JSON.parse(out) as unknown
        return translateOpencodeExport(json).frames
    } catch {
        return []
    }
}

/** Interrupt the in-flight turn. Run mode kills the child; server mode calls the server's own
 *  `session.abort()` (verified live: the blocked `session.prompt()` call then resolves with
 *  `info.error.name === "MessageAbortedError"` rather than hanging or rejecting). */
export function abortTurn(chatId: string): void {
    const s = sessions.get(chatId)
    if (!s) return
    if (s.mode === 'run') {
        if (!s.proc) return
        s.aborting = true
        s.queue = []
        try {
            s.proc.kill()
        } catch {
            /* already exited */
        }
        return
    }
    if (!s.turnActive || !s.sessionId) return
    s.aborting = true
    s.queue = []
    void ensureOpencodeServer(s.bin, undefined, s.turnProfile ?? 'default')
        .then(async server => {
            if (server?.version === 2)
                await server.client.interrupt(s.sessionId as string)
            else
                await server?.client.session.abort({
                    path: { id: s.sessionId as string },
                    query: { directory: s.cwd },
                })
        })
        .catch(() => {
            /* best-effort — a turn that never settles is still reported by the awaited call's own catch */
        })
}

/** Answer a `permission` frame (server mode only — run mode never raises one). Maps allow/deny/always
 *  onto the server's own once/reject/always response, verified live for both allow ("once") and
 *  deny ("reject"). */
export function respondPermission(
    chatId: string,
    id: string,
    behavior: 'allow' | 'deny',
    always?: boolean,
): void {
    const s = sessions.get(chatId)
    if (
        !s ||
        s.mode !== 'server' ||
        !s.sessionId ||
        !s.pendingPermissions.has(id)
    )
        return
    s.pendingPermissions.delete(id)
    const response = opencodePermissionResponse(behavior, always)
    void ensureOpencodeServer(s.bin, undefined, s.turnProfile ?? 'default')
        .then(async server => {
            if (server?.version === 2)
                await server.client.replyPermission(
                    s.sessionId as string,
                    id,
                    response,
                )
            else
                await server?.client.postSessionIdPermissionsPermissionId({
                    path: { id: s.sessionId as string, permissionID: id },
                    query: { directory: s.cwd },
                    body: { response },
                })
        })
        .catch(() => {
            /* best-effort — the pending ask just stays parked client-side if this fails */
        })
}

/** Switch the model for FUTURE turns (each run passes it along). opencode model ids are
 *  `provider/model`; anything else (e.g. a Claude model id from a stale localStorage key) is
 *  ignored rather than poisoning the next run. The virtual `ZEN_FREE_ROTATE_ID`
 *  (`bismuth/zen-free-rotate`) shares the shape, passes here, and is resolved to a real free Zen
 *  model per turn in runTurnServer/runTurnLegacy — it never reaches the CLI/server as-is. */
/** The reasoning-effort level for FUTURE turns. Only opencode 2 models list levels (as variants),
 *  and a level the turn's model does not list is left out (opencodeV2TurnModel), so a stale or
 *  foreign value never reaches opencode. */
export function setEffort(chatId: string, effort: string): void {
    const s = sessions.get(chatId)
    if (!s) return
    s.effort = /^[\w-]{1,32}$/.test(effort) ? effort : undefined
}

/** Select the chat's model. A pick the chat cannot run (an id the model list lacks, or a cloud id
 *  while the local model pins the chat) is refused with a `model-refused` frame naming the model the
 *  session keeps. A pick that arrives while the model list is still loading waits for it. */
export function setModel(chatId: string, model: string): void {
    const s = sessions.get(chatId)
    if (!s) return
    const apply = () => {
        const listed = modelsCache ?? []
        const known =
            model === ZEN_FREE_ROTATE_ID ||
            listed.length === 0 ||
            listed.some(m => m.value === model)
        if (known && acceptsModelPick(s.localEnv, model)) s.model = model
        else emit(s, { type: 'model-refused', model, current: s.model ?? '' })
    }
    const loading = refreshInFlight ?? (openInfoPending ? openInfoInFlight : null)
    if (!loading) return apply()
    const pick = loading
        .catch(() => {})
        .then(() => (openInfoPending ? openInfoInFlight : null))
        .catch(() => {})
        .then(() => {
            if (sessions.get(chatId) === s) apply()
        })
    s.modelPick = pick
    void pick.finally(() => {
        if (s.modelPick === pick) s.modelPick = undefined
    })
}

/** Select the chat's primary agent (opencode's build, plan, or the user's own). A name the server
 *  does not list as a primary is ignored; the session switches before its next turn, and only when
 *  the agent changed. */
export function setAgent(chatId: string, agent: string): void {
    const s = sessions.get(chatId)
    if (!s || !/^[\w.:-]{1,64}$/.test(agent)) return
    if (s.mode === 'server' && !agentsCache?.some(a => a.value === agent))
        return
    s.agent = agent
}

/** Whether `setModel` takes `model`. The id is `provider/model`, and the model part may itself hold
 *  `/` (LM Studio's `local/qwen/qwen3-coder-30b`) — the first `/` is the provider split. While the
 *  vault's local model is on (`localEnv` set) the chat is PINNED to the local server: the app re-applies
 *  the last pick on a fresh chat, and a remembered cloud id would otherwise run it on the cloud account. */
export function acceptsModelPick(
    localEnv: Record<string, string> | null,
    model: string,
): boolean {
    if (!/^[\w.-]+\/[\w.:/@-]+$/.test(model)) return false
    if (localEnv && !model.startsWith(`${LOCAL_PROVIDER_ID}/`)) return false
    return true
}

export function closeChat(chatId: string): void {
    const s = sessions.get(chatId)
    if (!s) return
    sessions.delete(chatId)
    if (s.closeTimer) clearTimeout(s.closeTimer)
    s.queue = []
    s.pendingPermissions.clear()
    const proc = s.proc
    if (proc) {
        try {
            proc.kill()
        } catch {
            /* already exited */
        }
    }
    // Server-mode sessions have no local process to kill — the shared server outlives every chat.
    // A closed chat keeps its opencode session so it stays resumable (opencode export /
    // GET /session/{id}/message both still work after this call) — except a private
    // conversation, which is erased from opencode's store (setPrivate).
    if (s.private) void erasePrivateSession(s, proc)
}

/** The chat's private toggle: when on at close, the session is erased from opencode's store. */
export function setPrivate(chatId: string, on: boolean): void {
    const s = sessions.get(chatId)
    if (s) s.private = on
}

/** Delete a private chat's session from opencode's store: through the shared server in server mode,
 *  else `opencode session delete`. A run-mode child is awaited first so it cannot write after the
 *  delete. Best-effort and silent, like every teardown step. */
export async function erasePrivateSession(
    s: Pick<OpencodeSession, 'sessionId' | 'mode' | 'bin' | 'cwd'>,
    proc: { exited: Promise<unknown> } | null,
    deps: {
        server?: () => Promise<
            | {
                  version?: 1
                  client: {
                      session: { delete: (o: unknown) => Promise<unknown> }
                  }
              }
            | {
                  version: 2
                  client: { deleteSession: (id: string) => Promise<void> }
              }
            | null
        >
        cli?: (bin: string, cwd: string, args: string[]) => Promise<unknown>
    } = {},
): Promise<void> {
    await proc?.exited.catch(() => {})
    const id = s.sessionId
    if (!id) return
    if (s.mode === 'server') {
        const server = await (
            deps.server ?? (() => ensureOpencodeServer(s.bin))
        )().catch(() => null)
        if (server) {
            try {
                if (server.version === 2) await server.client.deleteSession(id)
                else
                    await server.client.session.delete({
                        path: { id },
                        query: { directory: s.cwd },
                    })
                return
            } catch {
                /* fall through to the CLI */
            }
        }
    }
    await (deps.cli ?? runCliText)(s.bin, s.cwd, [
        'session',
        'delete',
        id,
    ]).catch(() => {})
}

export function scheduleClose(chatId: string, ms: number): void {
    const s = sessions.get(chatId)
    if (!s) return
    scheduleSessionClose(s, ms, () => closeChat(chatId))
}

/** Re-point a live session's sink at a reconnected socket, flushing frames buffered while
 *  detached; a between-turns rebind pushes a synthetic `done` so a terminating frame lost to the
 *  dead socket can't wedge the streaming state. Mirrors chat.ts. */
export function rebindSink(chatId: string, sink: ChatSink): boolean {
    const s = sessions.get(chatId)
    if (!s) return false
    rebindSessionSink(s, sink)
    return true
}

export function detachSink(chatId: string, sink: ChatSink): boolean {
    const s = sessions.get(chatId)
    if (!s) return false
    return detachSessionSink(s, sink)
}

// Kill any in-flight RUN-mode opencode children on backend shutdown (mirrors chat.ts/terminal.ts).
// The shared SERVER process's own teardown lives in ./opencodeServer.ts (its own process.on("exit")
// hook) — kept separate since the server outlives any single chat/session this file manages.
let shuttingDown = false
function shutdownAll(): void {
    if (shuttingDown) return
    shuttingDown = true
    for (const id of Array.from(sessions.keys())) closeChat(id)
}
process.on('exit', shutdownAll)
