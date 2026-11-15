// bench/backendBench/types.ts
// The backend benchmark's shared shapes. The runner drives the production chat router
// (core/src/chatProviders/index.ts) for every target, runs each scenario in a fresh seeded vault,
// and scores every target against a reference target (claude on its own login by default).
//
// Scenarios live in bench/backendBench/scenarios/<suite>.ts. Each such file default-exports a
// `Scenario[]`; the runner loads every file in that directory, so a new suite is a new file and
// nothing else. `parity` is the chat-transport suite (stream, tools, permissions, stop, resume,
// history, compaction, windows, errors); other suites (e.g. `knowledge`, graded on what a turn did
// to the vault) plug in the same way.
import type { ChatFrame } from '../../core/src/chat'
import type {
    BackendCapabilities,
    BackendId,
} from '../../core/src/agentBackends/catalog'

/** Where a target's model comes from. */
export type ModelSource =
    /** The backend's own login, with its default model or the one named. */
    | { kind: 'cloud'; model?: string }
    /** The aimock server answering from scenario fixtures: zero real model calls. */
    | { kind: 'mock' }
    /** A local OpenAI-compatible server (LM Studio, ollama), reached through the recording proxy and
     *  set as the vault's `localModel`. `window` is the loaded
     *  context length when the server reports one. */
    | {
          kind: 'local'
          server: 'lmstudio' | 'ollama'
          url: string
          model: string
          window?: number
      }

/** One row of the matrix: a backend run with one model source. */
export type BenchTarget = {
    /** Stable row label: `<backend>@<source>`, e.g. `claude@cloud`, `opencode@mock`,
     *  `opencode@lmstudio:qwen/qwen3.5-9b`. */
    label: string
    backend: BackendId
    source: ModelSource
    /** The resolved binary, or null when the backend is not installed (every cell then `skip`s). */
    binary: string | null
    caps: BackendCapabilities
}

/** What one `send` produced. */
export type TurnResult = {
    /** Every frame from the send until the turn ended, in order. */
    frames: ChatFrame[]
    /** The concatenated `assistant-text` of the turn. */
    text: string
    /** `tool-use` frames joined with their `tool-result`. */
    toolUses: {
        id: string
        name: string
        input: unknown
        result?: string
        isError?: boolean
    }[]
    /** The first `error` frame's message, or null. */
    error: string | null
    /** ms from send to the first `assistant-text` frame, or null when none came. */
    firstTokenMs: number | null
    /** ms from send to the end of the turn. */
    wallMs: number
    /** `done`: a `done` frame arrived. `timeout`: none within the deadline. `error`: an `error`
     *  frame ended it. */
    ended: 'done' | 'timeout' | 'error'
    /** Tool names of the permission frames the driver allowed because the scenario left them
     *  unanswered. */
    autoAllowed?: string[]
}

/** One chat on one target, driven through the production router with the target's backend id. */
export interface ChatDriver {
    readonly chatId: string
    readonly vault: string
    /** Every frame since the chat opened. */
    readonly frames: ChatFrame[]
    /** openSession; resolves once the session's header frames have arrived or 30 s pass. */
    open(): Promise<void>
    /** sendMessage, resolving when the turn ends. `onFrame` sees each frame as it lands, so a
     *  scenario can answer a permission or abort mid-turn. A permission it leaves unanswered is
     *  allowed (listed in `autoAllowed`) and an unanswered question is skipped, so no turn hangs
     *  on a prompt nobody answers. */
    send(
        text: string,
        opts?: {
            timeoutMs?: number
            onFrame?: (frame: ChatFrame, driver: ChatDriver) => void
        },
    ): Promise<TurnResult>
    /** sendMessage while a turn runs (a mid-turn message); does not wait. */
    sendMidTurn(text: string): void
    abort(): void
    respondPermission(id: string, behavior: 'allow' | 'deny'): void
    respondQuestion(id: string, answers: Record<string, string> | null): void
    setModel(model: string): void
    setAgent(agent: string): void
    setEffort(effort: string): void
    setPrivate(on: boolean): void
    /** The backend's session id from the latest `session` frame, or null. */
    sessionId(): string | null
    /** closeChat; resolves once the backend no longer holds a session for this chat id. */
    close(): Promise<void>
}

export type ScenarioCtx = {
    target: BenchTarget
    /** A fresh vault for this scenario, seeded from `VAULT_SEED` (./vault.ts). */
    vault: string
    /** A new chat on this target in this vault. The runner closes every chat after the scenario. */
    newChat(): Promise<ChatDriver>
    /** resumeSession onto a new chat id bound to `sessionId`. */
    resumeChat(sessionId: string): Promise<ChatDriver>
    /** sessionHistoryFrames for this target's backend. */
    history(sessionId: string): Promise<ChatFrame[]>
    /** Run a `bismuth` CLI command against this vault, to check what a turn changed. */
    bismuth(
        args: string[],
    ): Promise<{ code: number; stdout: string; stderr: string }>
    /** Every request the backend sent to the model during this scenario, in order: what the mock
     *  or the recording proxy in front of a local server saw. Empty for a `cloud` target. */
    modelRequests(): ModelRequest[]
    /** Make the model server behave like a server with this context window (tokens, estimated as
     *  serialised body characters / 4): a request over it gets LM Studio's overflow error. null
     *  restores the target's own window. Mock and local targets only. */
    setWindow(tokens: number | null): void
    /** One line into this cell's log (kept in the JSON report). */
    log(line: string): void
}

export type ModelRequest = {
    path: string
    body: unknown
    /** Serialised body characters / 4. */
    estTokens: number
    at: number
}

/** `gap`: the reference backend has the ability and this one does not (scored as a miss).
 *  `skip`: not measurable here (not installed, no model, no mock fixture); not scored. */
export type Verdict = 'pass' | 'fail' | 'gap' | 'skip' | 'timeout'

export type ScenarioOutcome = {
    verdict: 'pass' | 'fail' | 'skip'
    /** One line: what was observed, enough to start a diagnosis from. */
    detail: string
    metrics?: Record<string, number>
}

export type Scenario = {
    /** kebab-case, unique across every suite. */
    id: string
    /** The file's suite name: `parity`, `knowledge`, … */
    suite: string
    title: string
    /** null when the scenario applies to this target; otherwise the verdict it gets unrun. */
    applies(
        target: BenchTarget,
    ): null | { verdict: 'gap' | 'skip'; reason: string }
    /** The runner's watchdog for the whole scenario; past it the cell is `timeout`. */
    timeoutMs: number
    /** aimock `fixtures` entries for mock mode, or a function of the target when the fixture names
     *  a backend's own tool (its shell tool, its MCP tool name). Absent: the scenario `skip`s
     *  under mock. */
    mockFixtures?: unknown[] | ((target: BenchTarget) => unknown[])
    run(ctx: ScenarioCtx): Promise<ScenarioOutcome>
}

export type Cell = {
    target: string
    scenario: string
    suite: string
    verdict: Verdict
    detail: string
    metrics: Record<string, number>
    wallMs: number
    log: string[]
}

/** Per target, per suite. `parity` is the share of the scenarios the reference target passes that
 *  this target also passes; null for the reference itself or when the reference was not run. */
export type Score = {
    target: string
    suite: string
    pass: number
    /** pass + fail + timeout + gap. */
    scored: number
    parity: number | null
}

export type BenchReport = {
    startedAt: string
    finishedAt: string
    reference: string
    targets: BenchTarget[]
    cells: Cell[]
    scores: Score[]
}
