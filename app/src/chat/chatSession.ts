// app/src/chat/chatSession.ts
// One chat's live session, independent of any view. Owns the /chat WebSocket (connect + exponential
// reconnect), the transcript store fed by the frame reducer (chatTranscript.ts), the manifest /
// provider / model / effort / permission-mode state and their first-manifest enforcement, the
// staged-turn queue, image attachments, the draft, and the history panel's data. Extracted from
// ChatView.tsx so the WS, transcript, draft and a streaming turn survive the view unmounting — a view
// renders a session, it no longer IS one. Everything DOM (scroll, refs, drag affordance, selection
// reply, context menu, composer focus) stays in the views; the session only REQUESTS those two
// effects through `onAppend` (scroll) and `onFocusRequest` (composer focus) — it never touches the DOM.
//
// Create sessions through the registry (chatSessions.ts), which gives each its own `createRoot` so
// the effects below have an owner and are torn down on release. The wire contract is
// core/src/chat.ts; the behaviour here is ChatView's, copied rather than redesigned.
import type { Accessor } from 'solid-js'
import type { ChatManifest } from '../../../core/src/chat'
import type { ChatSessionInfo, ChatSearchHit, ChatScope } from '../api'
import type { TurnItem } from '../chatTranscript'
import { isSpeaking } from './chatSpeaking'
import type { ChatProviderChoice } from '../chatProvider'
import type { FileCandidate } from '../editor/atMention'
import {
    createEffect,
    createMemo,
    createSignal,
    getOwner,
    onCleanup,
} from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { ChatFrame } from '../../../core/src/chat'
import { apiBase, api } from '../api'
import {
    applyChatFrame,
    type PermissionPart,
    type QuestionPart,
    type UserItem,
} from '../chatTranscript'
import { getFocusedSelection } from '../editorRegistry'
import {
    getEditorTabs,
    addChatReference,
    getChatReferences,
    clearChatReferences,
} from '../chatContext'
import { buildEditorContextText } from '../chatEditorContext'
import { chatPersonaName } from '../daemonIdentity'
import { publishChatTitle } from '../chatTitles'
import {
    rememberChatSession,
    recallChatSession,
    forgetChatSession,
} from '../chatSessionStore'
import { publishChatOrigin } from '../chatOrigin'
import {
    publishChatBusy,
    publishChatComposing,
    publishChatSpeaking,
    clearChatActivity,
} from '../chatActivity'
import { setChatColor, resolveChatColorArg } from '../chatColors'
import {
    parseChatSlashCommand,
    CLIENT_SLASH_COMMANDS,
    withClientSlashCommands,
} from '../chatSlashCommands'
import {
    resolveInitialModel,
    reconcileManifestModel,
    modelOptionFor,
} from '../chatModelResolution'
import { providerCan, sanitizeChatProvider } from '../chatProvider'
import { restoreQueuedComposerState } from '../chatQueueRestore'
import { lastChange } from '../serverVersion'
import { reconcilePermissionMode } from '../chatPermissionMode'
import { DEFAULT_EFFORT_DISPLAY, effortOptionsForModel } from '../chatEffort'
import {
    basename,
    classifyIntake,
    imageMimeFromName,
    jpegNameFor,
} from '../fileIntake'
import { wikilinkFor, noteNameFromPath } from '../dnd/noteRef'
import { buildHistoryEntries } from '../chatHistory'
import { settings } from '../settings'
import {
    CHAT_IMAGE_MIME,
    MAX_IMAGE_BYTES,
    attachmentsTooLarge,
    imageIntakeDecision,
    readImageFile,
    unsupportedImage,
} from './chatImageIntake'
import {
    browserStorage,
    readLastEffort,
    readLastMode,
    readLastModel,
    readProviderChoice,
    rememberEffort as persistEffort,
    rememberMode as persistMode,
    rememberModel as persistModel,
    rememberProvider as persistProvider,
} from './chatSessionPrefs'

export type ChatAttachment = { name: string; mediaType: string; data: string }

export type ChatModelOption = {
    value: string
    label: string
    description: string
    effortLevels: string[]
    free?: boolean
}

export type ChatContextUsage = {
    percentage: number
    totalTokens: number
    maxTokens: number
}

export type ChatGateRefusal = { binary: string; message: string }

export type ChatSelectOption = {
    value: string
    label: string
    description?: string
}

export type ChatHistoryState = {
    open: Accessor<boolean>
    loading: Accessor<boolean>
    sessions: Accessor<ChatSessionInfo[]>
    scope: Accessor<ChatScope>
    query: Accessor<string>
    searchHits: Accessor<ChatSearchHit[]>
    searchLoading: Accessor<boolean>
    toggle: () => void
    close: () => void
    setScope: (scope: ChatScope) => void
    setQuery: (q: string) => void
    resume: (sessionId: string) => Promise<void>
}

export type ChatSession = {
    readonly chatId: string
    readonly transcript: readonly TurnItem[]
    draft: Accessor<string>
    setDraft: (value: string) => void
    attachments: Accessor<ChatAttachment[]>
    removeAttachment: (index: number) => void
    addImageFiles: (files: File[]) => Promise<void>
    addDroppedFiles: (files: File[]) => Promise<void>
    addDroppedPaths: (paths: string[]) => Promise<void>
    streaming: Accessor<boolean>
    awaitingReply: Accessor<boolean>
    manifest: Accessor<ChatManifest | null>
    setupError: Accessor<ChatProviderChoice | null>
    gateRefusal: Accessor<ChatGateRefusal | null>
    turnError: Accessor<string | null>
    models: Accessor<ChatModelOption[]>
    authProviders: Accessor<{ name: string; kind: string }[] | null>
    provider: Accessor<ChatProviderChoice>
    permMode: Accessor<string>
    displayModel: Accessor<string>
    displayModelValue: Accessor<string>
    effortOptions: Accessor<ChatSelectOption[]>
    effortValue: Accessor<string>
    context: Accessor<ChatContextUsage | null>
    mcpConnected: Accessor<number>
    fileCandidates: Accessor<FileCandidate[]>
    slashCommands: Accessor<string[]>
    slashCommandDetail: (name: string) => string | undefined
    historyEntries: Accessor<string[]>
    persona: Accessor<string>
    send: () => void
    stop: () => void
    answerPermission: (
        id: string,
        behavior: 'allow' | 'deny',
        always: boolean,
    ) => void
    answerQuestion: (id: string, answers: Record<string, string> | null) => void
    cancelQueued: (queueId: string) => void
    setPermissionMode: (mode: string) => void
    switchModel: (model: string) => void
    switchEffort: (level: string) => void
    switchProvider: (provider: string) => void
    startNewChat: () => void
    quoteReply: (text: string) => void
    history: ChatHistoryState
    onAppend: (listener: (force: boolean) => void) => () => void
    onFocusRequest: (listener: () => void) => () => void
    dispose: () => void
}

// Derive the WebSocket base from the SAME runtime-resolved backend api.ts uses (?api= >
// window.__BISMUTH_API__ > VITE_API_BASE > :4321) — never hardcode a host.
const wsBase = () => apiBase().replace(/^http/, 'ws') // http→ws, https→wss

// Descriptions for slash commands with no description on the wire: "/mcp" is answered by chat.ts
// locally (BUG #39), and the CLIENT_SLASH_COMMANDS are intercepted here before a turn is sent.
const SLASH_COMMAND_DETAILS: Record<string, string> = {
    mcp: 'Show MCP server status',
    ...Object.fromEntries(CLIENT_SLASH_COMMANDS.map(c => [c.name, c.detail])),
}

// A quoted head this long is plenty to identify what's being replied to without the composer
// drowning in it — long messages truncate with an ellipsis.
const QUOTE_HEAD_MAX = 300

/** Compact `<editor-context>` preamble (active file, open tabs, selection) for the WIRE message only.
 *  `hiddenPaths` drops any file whose resolved AI visibility is "hidden" — see chatEditorContext.ts. */
function buildEditorContext(
    hiddenPaths: ReadonlySet<string>,
    referencedFiles: string[],
): string {
    const sel = getFocusedSelection()
    const { openFiles, activeFile } = getEditorTabs()
    return buildEditorContextText({
        activeFile,
        openFiles,
        selection: sel?.selection ?? '',
        selectionPath: sel?.path,
        hiddenPaths,
        referencedFiles,
    })
}

type QueuedTurn = {
    id: string
    wire: string
    text: string
    images: ChatAttachment[]
}

/**
 * Create one chat's session. Call inside a reactive owner (the registry's `createRoot`); the session
 * connects immediately — resuming the conversation this chat id last remembered, else opening a fresh
 * one — so anything that fakes the socket (stories) must be installed BEFORE this runs.
 */
export function createChatSession(chatId: string): ChatSession {
    const storage = browserStorage()
    const [transcript, setTranscript] = createStore<TurnItem[]>([])
    const [draft, setDraftSignal] = createSignal('')
    const [attachments, setAttachments] = createSignal<ChatAttachment[]>([])
    const [streaming, setStreaming] = createSignal(false)
    const [manifest, setManifest] = createSignal<ChatManifest | null>(null)
    // Seeded to the LAST-CHOSEN mode (Bypass on a first run) so the header reflects the user's real
    // preference before any session exists (BUG #14 + FEATURE #35); pushed down on the first manifest.
    const [permMode, setPermMode] = createSignal<string>(readLastMode(storage))
    const [setupError, setSetupError] = createSignal<ChatProviderChoice | null>(
        null,
    )
    const [gateRefusal, setGateRefusal] = createSignal<ChatGateRefusal | null>(
        null,
    )
    const [turnError, setTurnError] = createSignal<string | null>(null)
    const [models, setModels] = createSignal<ChatModelOption[]>([])
    const [authProviders, setAuthProviders] = createSignal<
        { name: string; kind: string }[] | null
    >(null)
    // "" = never chosen → leave the model default alone (FEATURE #63).
    const [effort, setEffort] = createSignal<string>(readLastEffort(storage))
    const rememberEffort = (level: string) => {
        if (!level) return
        setEffort(level)
        persistEffort(storage, level)
    }
    // This TAB's explicit provider choice, else the vault's `chat.provider` setting (card #90). The
    // first spawned session latches the choice so backend and header can never drift apart.
    const [providerChoice, setProviderChoice] =
        createSignal<ChatProviderChoice | null>(
            readProviderChoice(storage, chatId),
        )
    const provider = createMemo<ChatProviderChoice>(
        () => providerChoice() ?? sanitizeChatProvider(settings.chat.provider),
    )
    const rememberProvider = (p: ChatProviderChoice) => {
        setProviderChoice(p)
        persistProvider(storage, chatId, p)
    }
    // The last model used in THIS chat (per-chat, provider-scoped) — the header's warm-up value and
    // the default a FRESH session is enforced to. A resumed conversation's model is adopted instead.
    const [lastModel, setLastModel] = createSignal(
        readLastModel(storage, provider(), chatId),
    )
    const rememberModel = (model: string, opts?: { global?: boolean }) => {
        if (!model) return
        setLastModel(model)
        persistModel(storage, provider(), chatId, model, opts)
    }
    const [context, setContext] = createSignal<ChatContextUsage | null>(null)
    // Turns staged while a turn is streaming (TUI parity), dispatched one at a time from `done`.
    // `text` is the raw typed text so Stop can restore it; `wire` is what the model gets.
    const [queuedTurns, setQueuedTurns] = createSignal<QueuedTurn[]>([])
    // The backend chat id the WS is bound to. Seeded from the tab's id but swapped by New / provider
    // switch, so a reconnect resumes the right backend session without touching the tab.
    const [activeChatId, setActiveChatId] = createSignal(chatId)

    // Busy/composing signals for any surface animating on this chat's liveness (the daemon face).
    createEffect(() => publishChatBusy(chatId, streaming()))
    createEffect(() => publishChatComposing(chatId, draft().trim().length > 0))
    // Speaking = busy AND the trailing part of the last assistant turn is actual streamed text —
    // distinguishes `thinking` (a reply is pending, nothing written yet) from `talking` (text is
    // flowing) for the daemon face's mood. `isSpeaking` (chatSpeaking.ts) walks back past a
    // queued follow-up bubble first, so staging another message mid-reply doesn't make the face
    // stop talking.
    createEffect(() => {
        publishChatSpeaking(chatId, isSpeaking(transcript, streaming()))
    })

    // ── onAppend: the one scroll seam ─────────────────────────────────────────────────────────
    const appendListeners = new Set<(force: boolean) => void>()
    const emitAppend = (force = false) => {
        for (const listener of [...appendListeners]) listener(force)
    }
    const onAppend = (listener: (force: boolean) => void) => {
        appendListeners.add(listener)
        return () => void appendListeners.delete(listener)
    }

    // ── onFocusRequest: fires whenever an action should return focus to the composer ─────────────
    // (New chat, provider switch, a history resume, Stop restoring queued text, a quote reply, and a
    // drop/mention insertion) — chat/createComposerFocus.ts owns the ref and does the actual
    // focus() + scrollIntoView(), subscribed by whichever view (ChatView/DaemonChat) is mounted.
    const focusListeners = new Set<() => void>()
    const emitFocusRequest = () => {
        for (const listener of [...focusListeners]) listener()
    }
    const onFocusRequest = (listener: () => void) => {
        focusListeners.add(listener)
        return () => void focusListeners.delete(listener)
    }

    // ── Hidden paths + @file candidates, refreshed on every vault change ───────────────────────
    const [hiddenPaths, setHiddenPaths] = createSignal<ReadonlySet<string>>(
        new Set(),
    )
    const [fileCandidates, setFileCandidates] = createSignal<FileCandidate[]>(
        [],
    )
    const refreshHiddenPaths = async () => {
        try {
            const entries = await api.tree()
            if (disposed) return
            setHiddenPaths(
                new Set(
                    entries
                        .filter(e => e.visibility === 'hidden')
                        .map(e => e.path),
                ),
            )
            setFileCandidates(
                entries
                    .filter(e => e.kind === 'file' && e.visibility !== 'hidden')
                    .map(e => ({
                        label: noteNameFromPath(e.path),
                        path: e.path,
                        folder: e.path.includes('/')
                            ? e.path.split('/')[0]
                            : undefined,
                    })),
            )
        } catch {
            // Leave the last-known set — better a stale filter than none.
        }
    }
    createEffect(() => {
        lastChange()
        void refreshHiddenPaths()
    })

    // ── History panel data ────────────────────────────────────────────────────────────────────
    const [historyOpen, setHistoryOpen] = createSignal(false)
    const [historyLoading, setHistoryLoading] = createSignal(false)
    const [sessions, setSessions] = createSignal<ChatSessionInfo[]>([])
    const [historyScope, setHistoryScope] = createSignal<ChatScope>('user')
    const [historyQuery, setHistoryQuery] = createSignal('')
    const [searchHits, setSearchHits] = createSignal<ChatSearchHit[]>([])
    const [searchLoading, setSearchLoading] = createSignal(false)
    // Debounced content search while the panel is open; clears when the query empties or it closes.
    let searchTimer: ReturnType<typeof setTimeout> | undefined
    createEffect(() => {
        const open = historyOpen()
        const q = historyQuery().trim()
        const scope = historyScope() // tracked: flipping the filter re-searches within the new scope
        clearTimeout(searchTimer)
        if (!open || !q) {
            setSearchHits([])
            setSearchLoading(false)
            return
        }
        setSearchLoading(true)
        searchTimer = setTimeout(() => {
            void (async () => {
                try {
                    setSearchHits(await api.chatSearch(q, scope))
                } catch {
                    setSearchHits([])
                } finally {
                    setSearchLoading(false)
                }
            })()
        }, 200)
    })

    // ── Socket state ──────────────────────────────────────────────────────────────────────────
    let ws: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let reconnectAttempt = 0
    let disposed = false
    // Latched false at each new/resumed session: the desired mode/effort/model are pushed on the
    // session's FIRST manifest; later manifests are reconciled instead (BUG #14).
    let modeEnforced = false
    // A resume requested before the socket was OPEN — flushed on the next onopen.
    let pendingResume: string | null = null
    // True while the current binding RESUMES a conversation: its first manifest's model is adopted,
    // never overridden by the tab/global fallback (Bug #89).
    let resumedSession = false
    // Answers clicked while the socket was down — flushed on the next onopen; the backend's parked
    // prompts survive the grace window, so they still resolve.
    let pendingPermissions: {
        id: string
        behavior: 'allow' | 'deny'
        always: boolean
    }[] = []
    let pendingQuestionResponses: {
        id: string
        answers: Record<string, string> | null
    }[] = []

    const sendJson = (msg: unknown): boolean => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false
        ws.send(JSON.stringify(msg))
        return true
    }

    const applyFrameToTranscript = (frame: ChatFrame) => {
        let touched = false
        setTranscript(produce(m => void (touched = applyChatFrame(m, frame))))
        if (touched) emitAppend()
    }

    const onFrame = (frame: ChatFrame) => {
        switch (frame.type) {
            case 'manifest': {
                setManifest(frame.manifest)
                if (!modeEnforced) {
                    // First manifest: push the header's desired mode + effort down (Claude-only
                    // capabilities), then resolve the model — enforce a fresh session's persisted
                    // choice, adopt a resumed session's own (Bug #89).
                    modeEnforced = true
                    if (
                        providerCan(provider(), 'permissionModes') &&
                        frame.manifest.permissionMode !== permMode()
                    ) {
                        sendJson({
                            type: 'set_permission_mode',
                            mode: permMode(),
                        })
                    }
                    if (providerCan(provider(), 'effort') && effort())
                        sendJson({ type: 'set_effort', effort: effort() })
                    const wasResume = resumedSession
                    resumedSession = false // consumed — later manifests reconcile instead
                    const modelDecision = resolveInitialModel(
                        lastModel(),
                        frame.manifest.model,
                        wasResume,
                    )
                    if (modelDecision && 'enforce' in modelDecision) {
                        sendJson({
                            type: 'set_model',
                            model: modelDecision.enforce,
                        })
                        // setModel triggers no manifest — reflect the override optimistically.
                        setManifest({
                            ...frame.manifest,
                            model: modelDecision.enforce,
                        })
                    } else if (modelDecision && 'adopt' in modelDecision) {
                        const adopted =
                            modelOptionFor(modelDecision.adopt, models()) ??
                            modelDecision.adopt
                        rememberModel(adopted, { global: !wasResume })
                    }
                } else {
                    // Later manifests: adopt a genuine plan-mode exit, re-enforce any other drift
                    // (FEATURE #35); adopt only a genuinely different model, per-tab (Bug #89).
                    const decision = reconcilePermissionMode(
                        permMode(),
                        frame.manifest.permissionMode,
                    )
                    if (decision && 'adopt' in decision)
                        setPermMode(decision.adopt)
                    else if (decision && 'enforce' in decision)
                        sendJson({
                            type: 'set_permission_mode',
                            mode: decision.enforce,
                        })
                    const modelDrift = reconcileManifestModel(
                        lastModel(),
                        frame.manifest.model,
                        models(),
                    )
                    if (modelDrift)
                        rememberModel(modelDrift.adopt, { global: false })
                }
                break
            }
            case 'user-message':
            case 'assistant-text':
            case 'thinking':
            case 'tool-use':
            case 'tool-result':
            case 'permission':
            case 'question':
                applyFrameToTranscript(frame)
                break
            case 'result':
                // Don't clobber the specific message an earlier `error` frame already set.
                if (frame.isError && !turnError())
                    setTurnError('The turn ended with an error.')
                applyFrameToTranscript(frame)
                break
            case 'done':
                setStreaming(false)
                dispatchQueued()
                break
            case 'models':
                setModels(frame.models)
                break
            case 'auth':
                setAuthProviders(frame.providers)
                break
            case 'title':
                // Names this TAB (chatId), independent of the internal id New swaps to.
                publishChatTitle(chatId, frame.title)
                break
            case 'session':
                // Keyed by the durable tab id so reopening the tab resumes THIS conversation.
                rememberChatSession(chatId, frame.sessionId)
                publishChatOrigin(chatId, frame.origin)
                break
            case 'context':
                setContext({
                    percentage: frame.percentage,
                    totalTokens: frame.totalTokens,
                    maxTokens: frame.maxTokens,
                })
                break
            case 'error':
                setStreaming(false)
                if (frame.code === 'no-claude') setSetupError('claude')
                else if (frame.code === 'no-opencode') setSetupError('opencode')
                else if (frame.code === 'visibility-refused')
                    setGateRefusal({
                        binary: frame.binary ?? '',
                        message: frame.message,
                    })
                else {
                    setTurnError(frame.message || 'Something went wrong.')
                    // The session ended — a queued follow-up still gets dispatched on a fresh one.
                    dispatchQueued()
                }
                break
        }
    }

    /** Send the front queued turn, if any: un-dim its bubble and flip back to streaming. If the socket
     *  is down the turn stays queued for the next turn-end (or the user's cancel). */
    const dispatchQueued = () => {
        const q = queuedTurns()
        if (!q.length) return
        const next = q[0]
        if (
            !sendJson({
                type: 'user',
                text: next.wire,
                provider: provider(),
                ...(next.images.length
                    ? {
                          images: next.images.map(a => ({
                              media_type: a.mediaType,
                              data: a.data,
                          })),
                      }
                    : {}),
            })
        )
            return
        setQueuedTurns(q.slice(1))
        setTranscript(
            produce(m => {
                for (const item of m) {
                    if (item.role === 'user' && item.queueId === next.id) {
                        item.queued = false
                        item.queueId = undefined
                        return
                    }
                }
            }),
        )
        setStreaming(true)
    }

    const cancelQueued = (queueId: string) => {
        setQueuedTurns(q => q.filter(t => t.id !== queueId))
        setTranscript(
            produce(m => {
                const i = m.findIndex(
                    item => item.role === 'user' && item.queueId === queueId,
                )
                if (i >= 0) m.splice(i, 1)
            }),
        )
    }

    const connect = () => {
        // Pin the active chat id so a reconnect resumes the same backend session; `rebind=1` marks a
        // RECONNECT so the server says explicitly when the expected session was already torn down.
        const isReconnect = reconnectAttempt > 0
        const rebind = isReconnect ? '&rebind=1' : ''
        ws = new WebSocket(
            `${wsBase()}/chat?chatId=${encodeURIComponent(activeChatId())}${rebind}`,
        )
        ws.onopen = () => {
            reconnectAttempt = 0
            setTurnError(null)
            if (pendingResume) {
                const sid = pendingResume
                pendingResume = null
                rememberProvider(provider())
                sendJson({
                    type: 'resume',
                    sessionId: sid,
                    provider: provider(),
                })
            } else if (!isReconnect) {
                // First open: eagerly spawn so manifest/models/mode land before the first message.
                rememberProvider(provider())
                sendJson({ type: 'open', provider: provider() })
            }
            if (pendingPermissions.length) {
                const queued = pendingPermissions
                pendingPermissions = []
                for (const p of queued)
                    sendJson({ type: 'permission_response', ...p })
            }
            if (pendingQuestionResponses.length) {
                const queued = pendingQuestionResponses
                pendingQuestionResponses = []
                for (const q of queued)
                    sendJson({
                        type: 'question_response',
                        id: q.id,
                        ...(q.answers
                            ? { answers: q.answers }
                            : { cancelled: true }),
                    })
            }
        }
        ws.onmessage = ev => {
            try {
                onFrame(JSON.parse(ev.data as string) as ChatFrame)
            } catch {
                /* ignore unparseable frames */
            }
        }
        ws.onclose = () => {
            if (disposed) return
            if (streaming()) setTurnError('Connection lost — reconnecting…')
            const delay = Math.min(500 * 2 ** reconnectAttempt, 8000)
            reconnectAttempt++
            reconnectTimer = setTimeout(() => {
                if (!disposed) connect()
            }, delay)
        }
        ws.onerror = () => {
            /* surfaced via onclose → reconnect */
        }
    }

    // ── Draft + attachments ───────────────────────────────────────────────────────────────────
    const setDraft = (value: string) => setDraftSignal(value)

    /** Stage each accepted image File as a base64 attachment, in order; refusals set an inline notice. */
    const addImageFiles = async (files: File[]) => {
        for (const f of files) {
            const decision = imageIntakeDecision(f)
            if (!decision.ok) {
                setTurnError(decision.message)
                continue
            }
            const att = await readImageFile(f)
            if (att) setAttachments(a => [...a, att])
            else setTurnError(unsupportedImage(f.type).message)
        }
    }

    /** Append absolute paths to the draft, one per line (whitespace-safe). */
    const appendPathsToDraft = (paths: string[]) => {
        if (!paths.length) return
        const block = paths.join('\n')
        setDraftSignal(cur =>
            cur.length && !/\s$/.test(cur)
                ? `${cur}\n${block}\n`
                : `${cur}${block}\n`,
        )
    }

    /** HEIC/HEIF → a JPEG File via the backend (POST /convert/heic); null when undecodable. */
    const heicToJpegFile = async (
        bytes: ArrayBuffer,
        name: string,
    ): Promise<File | null> => {
        try {
            const jpeg = await api.convertHeic(bytes)
            return new File([jpeg], basename(jpegNameFor(name)), {
                type: 'image/jpeg',
            })
        } catch (e) {
            console.error('heic conversion failed', e)
            return null
        }
    }

    /** Intake for REAL filesystem paths (native drop, Finder paste): images attach, everything else is
     *  referenced in place. Nothing is silently discarded. */
    const addDroppedPaths = async (paths: string[]) => {
        if (!paths.length) return
        const refs: string[] = []
        let readFile: ((p: string) => Promise<Uint8Array>) | null = null
        if (paths.some(p => classifyIntake(p) !== 'other')) {
            try {
                ;({ readFile } = await import('@tauri-apps/plugin-fs'))
            } catch (e) {
                console.error('fs plugin import failed', e)
            }
        }
        for (const p of paths) {
            const kind = classifyIntake(p)
            if (kind === 'other' || !readFile) {
                refs.push(p)
                continue
            }
            let bytes: Uint8Array
            try {
                bytes = await readFile(p)
            } catch (e) {
                console.error('native drop read failed', e)
                refs.push(p) // unreadable HERE, but the agent may still be able to open it
                continue
            }
            // Too big to inline → referenced instead of refused.
            if (bytes.byteLength > MAX_IMAGE_BYTES) {
                refs.push(p)
                continue
            }
            const mime = imageMimeFromName(p)
            if (kind === 'image' && mime) {
                await addImageFiles([
                    new File([bytes as BlobPart], basename(p), { type: mime }),
                ])
                continue
            }
            const jpeg = await heicToJpegFile(
                bytes.buffer.slice(
                    bytes.byteOffset,
                    bytes.byteOffset + bytes.byteLength,
                ) as ArrayBuffer,
                p,
            )
            if (jpeg) await addImageFiles([jpeg])
            else refs.push(p) // couldn't transcode — hand the agent the original path
        }
        appendPathsToDraft(refs)
        emitFocusRequest()
    }

    /** Intake for BYTES with no path (paste, browser drop): images attach, everything else is staged to
     *  the scratch dir (POST /tmp-file) so it HAS a path to reference. */
    const addDroppedFiles = async (files: File[]) => {
        if (!files.length) return
        const refs: string[] = []
        for (const f of files) {
            // A real MIME rescues an extension-less clipboard blob (a pasted screenshot).
            const byName = classifyIntake(f.name)
            const kind =
                byName === 'other' && CHAT_IMAGE_MIME.has(f.type)
                    ? 'image'
                    : byName
            if (kind === 'image' && f.size <= MAX_IMAGE_BYTES) {
                // Re-stamp the MIME from the extension: OS drags often hand over an empty/wrong type.
                const mime = imageMimeFromName(f.name) ?? f.type
                await addImageFiles([
                    f.type === mime ? f : new File([f], f.name, { type: mime }),
                ])
                continue
            }
            if (kind === 'heic' && f.size <= MAX_IMAGE_BYTES) {
                const jpeg = await heicToJpegFile(await f.arrayBuffer(), f.name)
                if (jpeg) {
                    await addImageFiles([jpeg])
                    continue
                }
                // fall through — stage the original so the drop still produces something usable
            }
            try {
                refs.push(
                    await api.stageTmpFile(
                        f.name || 'pasted-file',
                        await f.arrayBuffer(),
                    ),
                )
            } catch (e) {
                setTurnError(
                    `Couldn't stage "${f.name || 'pasted file'}" — see console.`,
                )
                console.error('tmp staging failed', e)
            }
        }
        appendPathsToDraft(refs)
        emitFocusRequest()
    }

    const removeAttachment = (index: number) =>
        setAttachments(a => a.filter((_, idx) => idx !== index))

    /** Apply a CLIENT-SIDE slash command (`/rename`, `/color`). True = consumed (clear the
     *  draft); false = refused with an inline error, draft kept for correction. */
    const applyLocalCommand = (
        cmd: ReturnType<typeof parseChatSlashCommand>,
    ): boolean => {
        if (!cmd) return false
        if (cmd.kind === 'rename') {
            window.dispatchEvent(
                new CustomEvent('bismuth-chat-rename', {
                    detail: { chatId, name: cmd.name },
                }),
            )
            setTurnError(null)
            return true
        }
        const resolved = resolveChatColorArg(cmd.arg)
        if (resolved === undefined) {
            setTurnError(
                `Unknown color "${cmd.arg}" — use a swatch name (e.g. blue) or a hex like #ffcc00.`,
            )
            return false
        }
        setChatColor(chatId, resolved)
        setTurnError(null)
        return true
    }

    // ── Sending ───────────────────────────────────────────────────────────────────────────────
    const send = () => {
        const text = draft().trim()
        const atts = attachments()
        if ((!text && atts.length === 0) || setupError() || gateRefusal())
            return
        if (text.startsWith('/')) {
            const cmd = parseChatSlashCommand(text)
            if (cmd) {
                if (applyLocalCommand(cmd)) setDraftSignal('')
                return
            }
        }
        // A slash command can't carry images: attachments force the array-of-blocks shape, and the CLI
        // only expands a leading "/command" in a plain string turn.
        if (text.startsWith('/') && atts.length > 0) {
            setTurnError(
                "Slash commands can't include image attachments — remove the image or the command.",
            )
            return
        }
        if (attachmentsTooLarge(atts)) {
            setTurnError(
                'Those images are too large to send together — remove one or attach a smaller image.',
            )
            return
        }
        // Editor context rides the WIRE only; skipped for slash commands (a preamble breaks them).
        const preamble = text.startsWith('/')
            ? ''
            : buildEditorContext(hiddenPaths(), getChatReferences(chatId))
        const wire = preamble ? `${preamble}\n\n${text}` : text
        const bubbleImages = atts.map(
            a => `data:${a.mediaType};base64,${a.data}`,
        )
        // Mid-turn: STAGE the message with its context captured now; `done` dispatches it.
        if (streaming()) {
            const id = crypto.randomUUID()
            setQueuedTurns(q => [...q, { id, wire, text, images: atts }])
            setTranscript(
                produce(
                    m =>
                        void m.push({
                            role: 'user',
                            text,
                            images: bubbleImages.length
                                ? bubbleImages
                                : undefined,
                            queued: true,
                            queueId: id,
                        }),
                ),
            )
            setDraftSignal('')
            setAttachments([])
            clearChatReferences(chatId)
            emitAppend(true)
            return
        }
        const images = atts.map(a => ({
            media_type: a.mediaType,
            data: a.data,
        }))
        if (
            !sendJson({
                type: 'user',
                text: wire,
                provider: provider(),
                ...(images.length ? { images } : {}),
            })
        ) {
            // Draft preserved so the user can retry.
            setTurnError(
                'Not connected to the backend — message not sent. Reconnecting…',
            )
            return
        }
        setTurnError(null)
        setTranscript(
            produce(
                m =>
                    void m.push({
                        role: 'user',
                        text,
                        images: bubbleImages.length ? bubbleImages : undefined,
                    }),
            ),
        )
        setDraftSignal('')
        setAttachments([])
        clearChatReferences(chatId)
        setStreaming(true)
        emitAppend(true) // sending always re-pins to the bottom
    }

    const stop = () => {
        // Socket down: the stop can't reach the backend — don't flip to idle while the turn runs on.
        if (!sendJson({ type: 'stop' })) {
            setTurnError(
                "Not connected to the backend — couldn't stop. Reconnecting…",
            )
            return
        }
        setStreaming(false)
        // Stop cancels the queue too, restoring the queued text + images into the composer (Row 83).
        const queued = queuedTurns()
        if (queued.length) {
            const restored = restoreQueuedComposerState(queued, {
                text: draft(),
                images: attachments(),
            })
            setDraftSignal(restored.text)
            setAttachments(restored.images)
            emitFocusRequest()
        }
        setQueuedTurns([])
        setTranscript(
            produce(m => {
                for (let i = m.length - 1; i >= 0; i--) {
                    const item = m[i]
                    if (item.role === 'user' && item.queued) m.splice(i, 1)
                }
                // The aborted turn's unanswered prompts are moot — mark them cancelled.
                for (const item of m) {
                    if (item.role !== 'assistant') continue
                    for (const part of item.parts) {
                        if (
                            part.kind === 'permission' &&
                            !part.answered &&
                            !part.cancelled
                        )
                            part.cancelled = true
                        if (
                            part.kind === 'question' &&
                            !part.answered &&
                            !part.cancelled
                        )
                            part.cancelled = true
                    }
                }
            }),
        )
    }

    const answerPermission = (
        id: string,
        behavior: 'allow' | 'deny',
        always: boolean,
    ) => {
        if (!sendJson({ type: 'permission_response', id, behavior, always })) {
            pendingPermissions.push({ id, behavior, always })
        }
        setTranscript(
            produce(m => {
                for (const item of m) {
                    if (item.role !== 'assistant') continue
                    const part = item.parts.find(
                        p => p.kind === 'permission' && p.id === id,
                    ) as PermissionPart | undefined
                    if (part) {
                        part.answered = { behavior, always }
                        return
                    }
                }
            }),
        )
    }

    const answerQuestion = (
        id: string,
        answers: Record<string, string> | null,
    ) => {
        if (
            !sendJson({
                type: 'question_response',
                id,
                ...(answers ? { answers } : { cancelled: true }),
            })
        ) {
            pendingQuestionResponses.push({ id, answers })
        }
        setTranscript(
            produce(m => {
                for (const item of m) {
                    if (item.role !== 'assistant') continue
                    const part = item.parts.find(
                        p => p.kind === 'question' && p.id === id,
                    ) as QuestionPart | undefined
                    if (part) {
                        if (answers) part.answered = answers
                        else part.cancelled = true
                        return
                    }
                }
            }),
        )
    }

    const setPermissionMode = (mode: string) => {
        setPermMode(mode)
        persistMode(storage, mode)
        sendJson({ type: 'set_permission_mode', mode })
    }

    const switchModel = (model: string) => {
        sendJson({ type: 'set_model', model })
        rememberModel(model)
        const m = manifest()
        if (m) setManifest({ ...m, model })
    }

    const switchEffort = (level: string) => {
        rememberEffort(level)
        sendJson({ type: 'set_effort', effort: level })
    }

    // ── New chat / resume / provider switch ───────────────────────────────────────────────────
    /** Wipe the transcript + transient turn state back to empty (shared by New, resume, provider). */
    const resetTranscript = () => {
        setTranscript([])
        setStreaming(false)
        setTurnError(null)
        setManifest(null)
        setPermMode(readLastMode(storage))
        setEffort(readLastEffort(storage))
        setQueuedTurns([])
        setContext(null)
        clearChatReferences(chatId)
        publishChatTitle(chatId, '')
        publishChatOrigin(chatId, null)
    }

    /** Tear the current WS down cleanly and reconnect on `id`. */
    const reconnectOn = (id: string) => {
        clearTimeout(reconnectTimer)
        reconnectAttempt = 0
        modeEnforced = false
        pendingResume = null
        pendingPermissions = []
        pendingQuestionResponses = []
        // Detach the OLD socket's handlers before closing, or its async close would schedule a stray
        // reconnect that opens a second socket on the new id.
        const old = ws
        if (old) {
            old.onclose = null
            old.onmessage = null
            old.onerror = null
            try {
                old.close(1000, 'switch')
            } catch {
                /* ignore */
            }
        }
        setActiveChatId(id)
        connect()
    }

    const switchProvider = (p: string) => {
        const next = sanitizeChatProvider(p, provider())
        if (next === provider()) return
        rememberProvider(next)
        setModels([])
        setAuthProviders(null)
        setLastModel(readLastModel(storage, next, chatId))
        // The old provider's conversation can't be resumed by the new one.
        forgetChatSession(chatId)
        setHistoryOpen(false)
        setSetupError(null)
        setGateRefusal(null)
        resetTranscript()
        reconnectOn(crypto.randomUUID())
        emitFocusRequest()
    }

    const startNewChat = () => {
        setHistoryOpen(false)
        resetTranscript()
        resumedSession = false
        reconnectOn(crypto.randomUUID())
        emitFocusRequest()
    }

    const loadSessions = async () => {
        setHistoryLoading(true)
        try {
            setSessions(await api.chatSessions(historyScope()))
        } catch {
            setSessions([])
        } finally {
            setHistoryLoading(false)
        }
    }

    const selectHistoryScope = (scope: ChatScope) => {
        if (scope === historyScope()) return
        setHistoryScope(scope)
        setSessions([]) // drop the old scope's rows so they can't flash under the new filter
        void loadSessions()
    }

    const openHistory = async () => {
        const next = !historyOpen()
        setHistoryOpen(next)
        if (!next) return
        setHistoryQuery('')
        setHistoryScope('user')
        await loadSessions()
    }

    /** Resume a past session: clean reconnect FIRST (so no stray frame from the abandoned turn lands),
     *  then replay its history frames through onFrame; the new socket's onopen flushes the resume. */
    const resumeSession = async (sessionId: string) => {
        setHistoryOpen(false)
        resetTranscript()
        emitFocusRequest()
        reconnectOn(activeChatId())
        pendingResume = sessionId // set AFTER reconnectOn — the new socket's onopen flushes it
        resumedSession = true
        let frames: ChatFrame[] = []
        try {
            frames = await api.chatSessionMessages(sessionId, provider())
        } catch {
            frames = []
        }
        if (disposed) return
        for (const frame of frames) onFrame(frame)
        emitAppend(true) // jump to the latest turn of the resumed conversation
    }

    /** Quote `text` as a markdown blockquote prefixed onto the draft (ChatView replyToMessage). */
    const quoteReply = (text: string) => {
        const trimmed = text.trim()
        if (!trimmed) return
        const head =
            trimmed.length > QUOTE_HEAD_MAX
                ? `${trimmed.slice(0, QUOTE_HEAD_MAX).trimEnd()}…`
                : trimmed
        const quote = head
            .split('\n')
            .map(line => `> ${line}`)
            .join('\n')
        setDraftSignal(d => `${quote}\n\n${d}`)
        emitFocusRequest()
    }

    // Drop-to-mention (Row 74a): App resolves a note dragged onto this chat and dispatches
    // `bismuth-chat-mention`; append a [[wikilink]] and register the file as a chat reference.
    const onMention = (e: Event) => {
        const d = (
            e as CustomEvent<{
                chatId?: string
                path?: string
                noteIds?: string[]
            }>
        ).detail
        if (!d || d.chatId !== chatId || !d.path) return
        const ref = wikilinkFor(d.path, d.noteIds ?? [])
        setDraftSignal(cur =>
            cur && !cur.endsWith(' ') && cur.length
                ? `${cur} ${ref} `
                : `${cur}${ref} `,
        )
        addChatReference(chatId, d.path)
        emitFocusRequest()
    }
    window.addEventListener('bismuth-chat-mention', onMention)

    // ── Derived readouts ──────────────────────────────────────────────────────────────────────
    const historyEntries = createMemo(() =>
        buildHistoryEntries(
            transcript
                .filter(
                    (it): it is UserItem => it.role === 'user' && !it.queued,
                )
                .map(it => it.text),
        ),
    )
    const mcpConnected = () =>
        (manifest()?.mcpServers ?? []).filter(s =>
            /connect|ready|ok/i.test(s.status),
        ).length
    const displayModel = () => manifest()?.model || lastModel()
    // Picker-space form of displayModel (Bug #89): the manifest's resolved id → the picker alias.
    const displayModelValue = createMemo(() => {
        const raw = displayModel()
        return modelOptionFor(raw, models()) ?? raw
    })
    // Effort levels of the displayed model; before a manifest names one, the login's first model.
    const effortOptions = createMemo<ChatSelectOption[]>(() => {
        const ms = models()
        const cur = displayModelValue()
        const target = ms.some(m => m.value === cur)
            ? cur
            : (ms[0]?.value ?? '')
        return effortOptionsForModel(target, ms)
    })
    const effortValue = () => {
        const opts = effortOptions()
        const cur = effort()
        if (cur && opts.some(o => o.value === cur)) return cur
        if (opts.some(o => o.value === DEFAULT_EFFORT_DISPLAY))
            return DEFAULT_EFFORT_DISPLAY
        return opts[0]?.value ?? ''
    }
    // Streaming with no assistant output for the CURRENT turn yet; queued bubbles are future turns.
    const awaitingReply = () => {
        if (!streaming()) return false
        for (let i = transcript.length - 1; i >= 0; i--) {
            const it = transcript[i]
            if (it.role === 'user' && it.queued) continue
            return it.role === 'user'
        }
        return true
    }
    const persona = () =>
        chatPersonaName() ?? (provider() === 'opencode' ? 'opencode' : 'Claude')
    // The manifest's commands + the client-side ones (deduped).
    const slashCommands = createMemo(() =>
        withClientSlashCommands(manifest()?.slashCommands ?? []),
    )
    const slashCommandDetail = (name: string) =>
        manifest()?.commandDetails?.[name] ?? SLASH_COMMAND_DETAILS[name]

    const dispose = () => {
        if (disposed) return
        disposed = true
        clearTimeout(reconnectTimer)
        clearTimeout(searchTimer)
        window.removeEventListener('bismuth-chat-mention', onMention)
        appendListeners.clear()
        focusListeners.clear()
        const sock = ws
        if (sock) {
            sock.onclose = null
            sock.onmessage = null
            sock.onerror = null
            try {
                sock.close(1000, 'dispose')
            } catch {
                /* ignore */
            }
        }
        clearChatActivity(chatId)
    }
    if (getOwner()) onCleanup(dispose)

    // Resume the conversation this chat id last remembered (a reopened tab comes back on the SAME
    // conversation); a brand-new chat takes the plain eager open.
    const resumeId = recallChatSession(chatId)
    if (resumeId) void resumeSession(resumeId)
    else connect()

    return {
        chatId,
        transcript,
        draft,
        setDraft,
        attachments,
        removeAttachment,
        addImageFiles,
        addDroppedFiles,
        addDroppedPaths,
        streaming,
        awaitingReply,
        manifest,
        setupError,
        gateRefusal,
        turnError,
        models,
        authProviders,
        provider,
        permMode,
        displayModel,
        displayModelValue,
        effortOptions,
        effortValue,
        context,
        mcpConnected,
        fileCandidates,
        slashCommands,
        slashCommandDetail,
        historyEntries,
        persona,
        send,
        stop,
        answerPermission,
        answerQuestion,
        cancelQueued,
        setPermissionMode,
        switchModel,
        switchEffort,
        switchProvider,
        startNewChat,
        quoteReply,
        history: {
            open: historyOpen,
            loading: historyLoading,
            sessions,
            scope: historyScope,
            query: historyQuery,
            searchHits,
            searchLoading,
            toggle: () => void openHistory(),
            close: () => setHistoryOpen(false),
            setScope: selectHistoryScope,
            setQuery: setHistoryQuery,
            resume: resumeSession,
        },
        onAppend,
        onFocusRequest,
        dispose,
    }
}
