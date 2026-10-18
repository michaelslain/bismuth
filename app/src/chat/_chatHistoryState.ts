// app/src/chat/_chatHistoryState.ts
// A stateful stand-in for the visibility + delete half of `ChatHistoryState`, for stories that hand
// the panel a plain state slice (no ChatSession, no fake transport). The state is REAL: setting a
// level changes the resolved `visibility` the next read returns, deleting removes rows — the same
// way GET /chat/sessions behaves — so a story can drive the menus and see the badges move.
// Deterministic: everything is synchronous signals, nothing waits on a timer.
import { createSignal, type Accessor } from 'solid-js'
import type { ChatScope, ChatSessionInfo, ChatVisibility } from '../api'
import type { ChatHistoryState } from './chatSession'
import { resolveVisibility } from './chatVisibility'

export const inScope = (s: ChatSessionInfo, scope: ChatScope) =>
    scope === 'all'
        ? true
        : scope === 'daemon'
          ? s.origin === 'daemon'
          : s.origin !== 'daemon'

export type FakeHistoryData = Pick<
    ChatHistoryState,
    | 'defaultVisibility'
    | 'setVisibility'
    | 'setDefaultVisibility'
    | 'deleteChats'
    | 'restoreChats'
> & {
    /** Every chat with its resolved `visibility` — callers filter it by scope themselves. */
    rows: Accessor<ChatSessionInfo[]>
}

export function createFakeHistoryData(init: {
    sessions: ChatSessionInfo[]
    defaultVisibility?: ChatVisibility
    /** Called with each write, for stories that assert on it. */
    onWrite?: (what: string, arg: unknown) => void
}): FakeHistoryData {
    const [raw, setRaw] = createSignal(
        init.sessions.map(s => ({ ...s })),
    )
    const trash = new Map<string, ChatSessionInfo>()
    const [def, setDef] = createSignal<ChatVisibility>(
        init.defaultVisibility ?? 'all',
    )
    return {
        defaultVisibility: def,
        rows: () =>
            raw().map(s => ({
                ...s,
                visibility: resolveVisibility(s.ownVisibility, def()),
            })),
        setVisibility: async (sessionId, level) => {
            init.onWrite?.('setVisibility', { sessionId, level })
            setRaw(rows =>
                rows.map(s =>
                    s.sessionId === sessionId
                        ? { ...s, ownVisibility: level ?? undefined }
                        : s,
                ),
            )
        },
        setDefaultVisibility: async level => {
            init.onWrite?.('setDefaultVisibility', level)
            setDef(level)
        },
        deleteChats: async target => {
            init.onWrite?.('deleteChats', target)
            const gone = raw().filter(s =>
                'sessionIds' in target
                    ? target.sessionIds.includes(s.sessionId)
                    : inScope(s, target.scope),
            )
            for (const s of gone) trash.set(s.sessionId, s)
            setRaw(rows => rows.filter(s => !gone.includes(s)))
            return gone.map(s => s.sessionId)
        },
        // The undo: the deleted rows come back in their place (the list is newest first).
        restoreChats: async ids => {
            init.onWrite?.('restoreChats', ids)
            const back = ids.flatMap(id => {
                const s = trash.get(id)
                trash.delete(id)
                return s ? [s] : []
            })
            setRaw(rows =>
                [...rows, ...back].sort((a, b) => b.lastModified - a.lastModified),
            )
        },
    }
}
