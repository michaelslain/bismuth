// app/src/chat/chatSession.ts
// SEAM — types only, pre-registered so the chat parts can build against the session's shape in
// parallel with the controller itself. Task 1 of the daemon-chat plan replaces the stub below with
// the real controller extracted from ChatView.tsx; the exported types are fixed by the plan.
import type { Accessor } from 'solid-js'
import type { ChatManifest } from '../../../core/src/chat'
import type { ChatSessionInfo, ChatSearchHit, ChatScope } from '../api'
import type { TurnItem } from '../chatTranscript'
import type { ChatProviderChoice } from '../chatProvider'
import type { FileCandidate } from '../editor/atMention'

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
    computerUse: Accessor<boolean>
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
    toggleComputerUse: () => void
    startNewChat: () => void
    quoteReply: (text: string) => void
    history: ChatHistoryState
    onAppend: (listener: (force: boolean) => void) => () => void
    dispose: () => void
}

export function createChatSession(chatId: string): ChatSession {
    throw new Error(`createChatSession(${chatId}): not implemented yet`)
}
