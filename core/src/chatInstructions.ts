// core/src/chatInstructions.ts
// The standing instructions every chat backend gives its agent, in one place so no backend can
// drift: how the chat renders a reply (KaTeX math), how to cite a note's lines when the editor
// shows line numbers, and, in a vault, who the agent is (the daemon, by name) and that the
// `bismuth` CLI is the way into Bismuth. Each backend sends it through its own channel (Claude's
// system-prompt append, opencode's instructions entry, Codex's `developer_instructions`, an ACP
// agent's first prompt); core/test/chatProviders/backendContract.test.ts holds every backend to it.
import { AGENT_CLI_NOTE } from './agentCliNote'
import { CHAT_RENDERING_NOTE } from './chatRenderingNote'
import { chatPersonaNote } from './chatPersonaNote'
import { findVaultRoot } from './findVaultRoot'

/** The instructions' parts, in order, empty ones dropped. `lineRefNote` is CHAT_LINE_REF_NOTE when
 *  the editor shows line numbers, else '' (chatLineRefNote.ts). */
export function chatInstructionParts(cwd: string, lineRefNote = ''): string[] {
    const vault = findVaultRoot(cwd)
    return [
        CHAT_RENDERING_NOTE,
        lineRefNote,
        vault ? chatPersonaNote(vault) : '',
        vault ? AGENT_CLI_NOTE : '',
    ].filter(Boolean)
}

/** The instructions as one text. */
export function chatInstructions(cwd: string, lineRefNote = ''): string {
    return chatInstructionParts(cwd, lineRefNote).join('\n\n')
}
