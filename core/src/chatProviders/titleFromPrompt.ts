// core/src/chatProviders/titleFromPrompt.ts
// Shared "synthesize a chat tab title from the user's first prompt" helper, used by the opencode and
// ACP drivers: Claude gets a real conversation-summary title off the SDK, but those backends carry no
// session-title field on the wire, so the title is derived from the first message instead.
import { stripEditorContext } from '../chat'

/** Session tab title from the user's first prompt: `<editor-context>` preamble stripped, whitespace
 *  collapsed, truncated with an ellipsis. */
export function titleFromPrompt(text: string, max = 48): string {
    const clean = stripEditorContext(text).replace(/\s+/g, ' ').trim()
    if (!clean) return ''
    return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}
