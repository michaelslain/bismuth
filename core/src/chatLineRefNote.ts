// core/src/chatLineRefNote.ts
// The system text an in-app chat session carries while the editor shows line numbers
// (`editor.lineNumbers` in .settings): cite a note's lines as `[[Note#L12]]` links, which the chat
// transcript renders as `Note:12` and opens at that line (app/src/editor/lineAnchor.ts). With line
// numbers off the session gets nothing, so replies never cite numbers the user cannot see. Rides the
// chat backends' own system channels beside CHAT_RENDERING_NOTE (chat.ts, opencode.ts, codex
// driver.ts), never a terminal tab or the daemon's sessions.
import { readSettings } from './settings'
import { findVaultRoot } from './findVaultRoot'

/** The line-citation note, stated in the anchor form lineAnchor.ts parses. */
export const CHAT_LINE_REF_NOTE = [
    'The user has line numbers turned on in the Bismuth editor. When you point at specific lines of',
    'a vault note, link them by line number so the user can see and click them: `[[Note#L12]]` for',
    'one line, `[[Note#L12-L18]]` for a range. Line numbers count from 1 over the whole file as it is',
    'stored, frontmatter included: the same numbers `cat -n` and your file reads show.',
].join('\n')

/** The note for a session, given the editor's line-number setting: the note when on, '' when off. */
export function chatLineRefNote(lineNumbers: boolean): string {
    return lineNumbers ? CHAT_LINE_REF_NOTE : ''
}

/** Whether the vault holding `cwd` has `editor.lineNumbers` on. Absent key, no vault, no
 *  .settings or unreadable settings all read as the schema default, off. */
export async function readLineNumbersSetting(cwd: string): Promise<boolean> {
    const vault = findVaultRoot(cwd)
    if (!vault) return false
    try {
        const s = await readSettings(vault)
        const editor = (s?.data as { editor?: { lineNumbers?: unknown } })
            ?.editor
        return editor?.lineNumbers === true
    } catch {
        return false
    }
}

/** The note for a chat whose working directory is `cwd`, read fresh from its vault's settings. */
export async function chatLineRefNoteFor(cwd: string): Promise<string> {
    return chatLineRefNote(await readLineNumbersSetting(cwd))
}
