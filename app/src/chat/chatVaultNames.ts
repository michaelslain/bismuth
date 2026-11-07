// app/src/chat/chatVaultNames.ts
// The vault's note and memory names, for the links inside chat messages: a `[[wikilink]]` or a
// `~slug` in a message resolves against these, exactly as it does in a note. ChatTranscript
// provides them once; every message (ChatTextBubble → ui/NoteProse) reads them here instead of
// taking them through each turn component.
import { createContext, useContext } from 'solid-js'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'

export type ChatVaultNames = {
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
}

const none = () => []

export const ChatVaultNamesContext = createContext<ChatVaultNames>({
    noteNames: none,
    memoryNames: none,
})

export function useChatVaultNames(): ChatVaultNames {
    return useContext(ChatVaultNamesContext)
}
