// core/src/chatProviders/backends.ts
// The chat-backend REGISTRY: one uniform `ChatBackend` per driver, so ./index.ts routes by lookup
// instead of per-backend branching.
//
// Each driver keeps its own module-level signature — chat.ts takes (chatId, text, cwd, sink,
// images, memoryDir), opencode takes the subset it understands. The adapters below are the only
// place that difference is expressed: each receives the SAME context object and picks what it
// needs. claude and opencode share one positional shape, built by `moduleBackend`; codex and the
// ACP backends supply their own ChatBackend from their drivers.
import * as claude from '../chat'
import * as opencode from './opencode/opencode'
import { codexBackend } from './codex/driver'
import {
    ACP_BACKEND_LIST,
    claudeCodeAcpBackend,
    clineBackend,
    codexAcpBackend,
    geminiBackend,
    gooseBackend,
    openclawBackend,
    hermesBackend,
} from './acp/driver'
import type { ChatFrame, ChatImage, ChatSink } from '../chat'
import type { BackendId } from '../agentBackends/catalog'

/** Everything a backend might need to open/continue a chat. A driver ignores what it can't use —
 *  e.g. opencode has no memory injection. */
export interface ChatTurnContext {
    chatId: string
    cwd: string
    sink: ChatSink
    /** This vault's `.daemon/memory` when the daemon is enabled; gates memory injection. */
    memoryDir?: string
    /** The user's text for a turn (sendMessage only). */
    text?: string
    /** Image attachments for a turn (sendMessage only). */
    images?: ChatImage[]
    /** The backend's own durable session id (resumeSession only). */
    sessionId?: string
}

/**
 * One chat backend. Every verb the /chat WebSocket can dispatch, in the shape ./index.ts routes.
 *
 * Required members are the ones every backend must implement to host a conversation at all.
 * Optional members are INTERACTIVE surfaces a non-interactive CLI genuinely cannot have — a
 * backend that omits them advertises the matching `false` capability in the catalog, so the
 * frontend hides the control rather than sending a verb into a void.
 */
export interface ChatBackend {
    id: BackendId
    /** Does this backend currently own a live session for this chat id? */
    hasSession(chatId: string): boolean
    /** Spawn eagerly, before the first turn, so header frames (manifest/models) land early. */
    openSession(ctx: ChatTurnContext): void
    /** Run one turn. Creates the session on first use. */
    sendMessage(ctx: ChatTurnContext & { text: string }): void
    /** Bind this chat to an existing session id so the next turn continues it. */
    resumeSession(ctx: ChatTurnContext & { sessionId: string }): void
    /** Replay a past session's transcript as frames. Tolerant: any failure yields []. */
    sessionHistoryFrames(sessionId: string, cwd: string): Promise<ChatFrame[]>
    /** Interrupt the in-flight turn. */
    abortTurn(chatId: string): void
    /** Switch the model for future turns. */
    setModel(chatId: string, model: string): void
    closeChat(chatId: string): void
    scheduleClose(chatId: string, ms: number): void
    rebindSink(chatId: string, sink: ChatSink): boolean
    /** Identity-guarded (see sessionSink.ts's detachSessionSink): a stale close event from an OLD
     *  socket that already lost a reconnect race must not re-detach a session that's live under a
     *  DIFFERENT (newer) sink. Returns whether the detach actually happened — the caller MUST use this
     *  to gate any teardown timer it was about to arm; see detachSessionSink's own doc comment. */
    detachSink(chatId: string, sink: ChatSink): boolean

    // --- optional: interactive surfaces a non-interactive CLI cannot offer -------------------
    /** Answer a `permission` frame. Present iff capabilities.permissionPrompts (NOT permissionModes —
     *  see catalog.ts's note on why the two are separate flags; opencode's server mode is the
     *  concrete case that has one without the other). */
    respondPermission?(
        chatId: string,
        id: string,
        behavior: 'allow' | 'deny',
        always?: boolean,
    ): void
    /** Answer a `question` frame (AskUserQuestion). Present iff capabilities.permissionModes. */
    respondQuestion?(
        chatId: string,
        id: string,
        answers: Record<string, string> | null,
    ): void
    /** Switch permission mode live. Present iff capabilities.permissionModes. */
    setPermissionMode?(chatId: string, mode: string): void
    /** Switch reasoning effort live. Present iff capabilities.effort. */
    setEffort?(chatId: string, effort: string): void
}

/** The module-level surface claude (chat.ts) and opencode (opencode/opencode.ts) both export. */
type BackendModule = {
    hasSession: ChatBackend['hasSession']
    openSession(
        chatId: string,
        cwd: string,
        sink: ChatSink,
        memoryDir?: string,
    ): unknown
    sendMessage(
        chatId: string,
        text: string,
        cwd: string,
        sink: ChatSink,
        images?: ChatImage[],
        memoryDir?: string,
    ): unknown
    resumeSession(
        chatId: string,
        sessionId: string,
        cwd: string,
        sink: ChatSink,
        memoryDir?: string,
    ): unknown
    sessionHistoryFrames: ChatBackend['sessionHistoryFrames']
    abortTurn: ChatBackend['abortTurn']
    setModel: ChatBackend['setModel']
    closeChat: ChatBackend['closeChat']
    scheduleClose: ChatBackend['scheduleClose']
    rebindSink: ChatBackend['rebindSink']
    detachSink: ChatBackend['detachSink']
}

type BackendExtras = Pick<
    ChatBackend,
    'respondPermission' | 'respondQuestion' | 'setPermissionMode' | 'setEffort'
>

/** Build a ChatBackend from a module exposing the shared positional signatures: the open, send and
 *  resume adapters unpack the context object into those arguments, and `extras` carries whichever
 *  optional interactive verbs the backend supports. */
const moduleBackend = (
    id: BackendId,
    mod: BackendModule,
    extras: Partial<BackendExtras>,
): ChatBackend => ({
    id,
    hasSession: mod.hasSession,
    openSession: c =>
        void mod.openSession(c.chatId, c.cwd, c.sink, c.memoryDir),
    sendMessage: c =>
        void mod.sendMessage(
            c.chatId,
            c.text,
            c.cwd,
            c.sink,
            c.images,
            c.memoryDir,
        ),
    resumeSession: c =>
        void mod.resumeSession(
            c.chatId,
            c.sessionId,
            c.cwd,
            c.sink,
            c.memoryDir,
        ),
    sessionHistoryFrames: mod.sessionHistoryFrames,
    abortTurn: mod.abortTurn,
    setModel: mod.setModel,
    closeChat: mod.closeChat,
    scheduleClose: mod.scheduleClose,
    rebindSink: mod.rebindSink,
    detachSink: mod.detachSink,
    ...extras,
})

/** Claude Code — core/src/chat.ts (one long-lived Agent-SDK `query()` per chat). */
const claudeBackend = moduleBackend('claude', claude, {
    respondPermission: claude.respondPermission,
    respondQuestion: claude.respondQuestion,
    setPermissionMode: claude.setPermissionMode,
    setEffort: claude.setEffort,
})

/** opencode — core/src/chatProviders/opencode/opencode.ts. Server mode (preferred: one persistent
 *  `opencode serve` shared across every opencode chat) falls back to the original one
 *  `opencode run --format json` subprocess per turn when the installed opencode can't serve.
 *  respondPermission is a real, live-verified server-mode surface (permissionPrompts:true) — see
 *  catalog.ts. No setPermissionMode/respondQuestion/setEffort: opencode has no drivable permission
 *  MODE switch (permissionModes stays false), no AskUserQuestion equivalent, and no per-turn effort
 *  control (opencode models report no effort levels either way). */
const opencodeBackend = moduleBackend('opencode', opencode, {
    respondPermission: opencode.respondPermission,
})

/**
 * Every chat backend, keyed by id.
 *
 * ORDER MATTERS for ownership resolution (see ./index.ts `owningBackend()`): the old code asked opencode
 * first and Claude second, and that order is preserved so a chat id somehow live in both registries
 * resolves the same way it always did. "codex" and the six ACP backends (chatProviders/acp/driver.ts)
 * are new ids nothing pre-dates, so where they land in the resolution order can't disturb that
 * history — appended after opencode/claude.
 */
export const CHAT_BACKENDS: Record<BackendId, ChatBackend> = {
    opencode: opencodeBackend,
    claude: claudeBackend,
    codex: codexBackend,
    cline: clineBackend,
    gemini: geminiBackend,
    goose: gooseBackend,
    openclaw: openclawBackend,
    hermes: hermesBackend,
    'claude-code-acp': claudeCodeAcpBackend,
    'codex-acp': codexAcpBackend,
}

/** In ownership-resolution order (opencode first, then claude, then codex, then every ACP backend)
 *  — see CHAT_BACKENDS. */
export const CHAT_BACKEND_LIST: readonly ChatBackend[] = [
    opencodeBackend,
    claudeBackend,
    codexBackend,
    ...ACP_BACKEND_LIST,
]
