// app/src/chat/_stubChatSession.ts
// Story fixture: a plain object satisfying ChatSession, built from createSignal state with no-op
// actions that RECORD their calls (so a play() can assert on them) instead of touching a socket.
// Call makeStubChatSession() inside a story's render (or its play()'s setup), never at module scope
// — the signals need a live reactive root, and Bun resolves solid-js to its server build outside one.
import { createSignal } from 'solid-js'
import type { TurnItem } from '../chatTranscript'
import type { ChatManifest } from '../../../core/src/chat'
import type {
    ChatAttachment,
    ChatContextUsage,
    ChatGateRefusal,
    ChatHistoryState,
    ChatModelOption,
    ChatSelectOption,
    ChatSession,
} from './chatSession'
import type { ChatProviderChoice } from '../chatProvider'
import type { ChatSearchHit, ChatSessionInfo, ChatScope } from '../api'
import type { FileCandidate } from '../editor/atMention'

export type StubChatSessionInit = Partial<{
    chatId: string
    transcript: TurnItem[]
    draft: string
    attachments: ChatAttachment[]
    streaming: boolean
    awaitingReply: boolean
    manifest: ChatManifest | null
    setupError: ChatProviderChoice | null
    gateRefusal: ChatGateRefusal | null
    turnError: string | null
    models: ChatModelOption[]
    authProviders: { name: string; kind: string }[] | null
    provider: ChatProviderChoice
    permMode: string
    displayModel: string
    displayModelValue: string
    effortOptions: ChatSelectOption[]
    effortValue: string
    context: ChatContextUsage | null
    mcpConnected: number
    computerUse: boolean
    fileCandidates: FileCandidate[]
    slashCommands: string[]
    historyEntries: string[]
    persona: string
    historySessions: ChatSessionInfo[]
    historyOpen: boolean
    historyLoading: boolean
    historyScope: ChatScope
    historyQuery: string
    searchHits: ChatSearchHit[]
    searchLoading: boolean
}>

export type StubChatSession = ChatSession & {
    /** Every action call, keyed by method name, for play() assertions. */
    calls: Record<string, unknown[][]>
}

/** Build a story/test double satisfying ChatSession. Every accessor is a real Solid signal (so a
 *  play() can drive it — typing, removing an attachment) and every action records its arguments
 *  under `calls[<name>]` rather than doing anything real. */
export function makeStubChatSession(
    init: StubChatSessionInit = {},
): StubChatSession {
    const calls: Record<string, unknown[][]> = {}
    const log =
        (name: string) =>
        (...args: unknown[]) => {
            ;(calls[name] ??= []).push(args)
        }

    const [draft, setDraftSig] = createSignal(init.draft ?? '')
    const [attachments, setAttachments] = createSignal<ChatAttachment[]>(
        init.attachments ?? [],
    )
    const [streaming] = createSignal(init.streaming ?? false)
    const [awaitingReply] = createSignal(init.awaitingReply ?? false)
    const [manifest] = createSignal<ChatManifest | null>(init.manifest ?? null)
    const [setupError] = createSignal<ChatProviderChoice | null>(
        init.setupError ?? null,
    )
    const [gateRefusal] = createSignal<ChatGateRefusal | null>(
        init.gateRefusal ?? null,
    )
    const [turnError] = createSignal<string | null>(init.turnError ?? null)
    const [models] = createSignal<ChatModelOption[]>(init.models ?? [])
    const [authProviders] = createSignal<
        { name: string; kind: string }[] | null
    >(init.authProviders ?? null)
    const [provider] = createSignal<ChatProviderChoice>(
        init.provider ?? 'claude',
    )
    const [permMode] = createSignal(init.permMode ?? 'bypassPermissions')
    const [displayModel] = createSignal(init.displayModel ?? '')
    const [displayModelValue] = createSignal(init.displayModelValue ?? '')
    const [effortOptions] = createSignal<ChatSelectOption[]>(
        init.effortOptions ?? [],
    )
    const [effortValue] = createSignal(init.effortValue ?? '')
    const [context] = createSignal<ChatContextUsage | null>(
        init.context ?? null,
    )
    const [mcpConnected] = createSignal(init.mcpConnected ?? 0)
    const [computerUse] = createSignal(init.computerUse ?? false)
    const [fileCandidates] = createSignal<FileCandidate[]>(
        init.fileCandidates ?? [],
    )
    const [slashCommands] = createSignal<string[]>(init.slashCommands ?? [])
    const [historyEntries] = createSignal<string[]>(init.historyEntries ?? [])
    const [persona] = createSignal(init.persona ?? 'Claude')

    const [historyOpen, setHistoryOpen] = createSignal(
        init.historyOpen ?? false,
    )
    const [historyLoading] = createSignal(init.historyLoading ?? false)
    const [historySessions] = createSignal<ChatSessionInfo[]>(
        init.historySessions ?? [],
    )
    const [historyScope, setHistoryScope] = createSignal<ChatScope>(
        init.historyScope ?? 'user',
    )
    const [historyQuery, setHistoryQuery] = createSignal(
        init.historyQuery ?? '',
    )
    const [searchHits] = createSignal<ChatSearchHit[]>(init.searchHits ?? [])
    const [searchLoading] = createSignal(init.searchLoading ?? false)

    const history: ChatHistoryState = {
        open: historyOpen,
        loading: historyLoading,
        sessions: historySessions,
        scope: historyScope,
        query: historyQuery,
        searchHits,
        searchLoading,
        toggle: () => {
            setHistoryOpen(v => !v)
            log('history.toggle')()
        },
        close: () => {
            setHistoryOpen(false)
            log('history.close')()
        },
        setScope: scope => {
            setHistoryScope(scope)
            log('history.setScope')(scope)
        },
        setQuery: q => {
            setHistoryQuery(q)
            log('history.setQuery')(q)
        },
        resume: async sessionId => {
            log('history.resume')(sessionId)
        },
    }

    const session: StubChatSession = {
        chatId: init.chatId ?? 'stub-chat',
        transcript: init.transcript ?? [],
        draft,
        setDraft: value => {
            setDraftSig(value)
            log('setDraft')(value)
        },
        attachments,
        removeAttachment: index => {
            setAttachments(a => a.filter((_, i) => i !== index))
            log('removeAttachment')(index)
        },
        addImageFiles: async files => {
            log('addImageFiles')(files)
        },
        addDroppedFiles: async files => {
            log('addDroppedFiles')(files)
        },
        addDroppedPaths: async paths => {
            log('addDroppedPaths')(paths)
        },
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
        computerUse,
        fileCandidates,
        slashCommands,
        slashCommandDetail: () => undefined,
        historyEntries,
        persona,
        send: () => log('send')(),
        stop: () => log('stop')(),
        answerPermission: (id, behavior, always) =>
            log('answerPermission')(id, behavior, always),
        answerQuestion: (id, answers) => log('answerQuestion')(id, answers),
        cancelQueued: queueId => log('cancelQueued')(queueId),
        setPermissionMode: mode => log('setPermissionMode')(mode),
        switchModel: model => log('switchModel')(model),
        switchEffort: level => log('switchEffort')(level),
        switchProvider: p => log('switchProvider')(p),
        toggleComputerUse: () => log('toggleComputerUse')(),
        startNewChat: () => log('startNewChat')(),
        quoteReply: text => log('quoteReply')(text),
        history,
        onAppend: () => () => {},
        dispose: () => log('dispose')(),
        calls,
    }
    return session
}
