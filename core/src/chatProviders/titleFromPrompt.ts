// core/src/chatProviders/titleFromPrompt.ts
// Shared "synthesize a chat tab title from the user's first prompt" helper. Every non-Claude
// backend needs this (Claude gets a real conversation-summary title off the SDK; ACP/opencode
// carry no session-title field on the wire at all — the ACP driver calls this helper on every new
// session's first message instead, same as opencode), so this used to live only in
// opencodeTranslate.ts as opencodeTitleFromPrompt. Extracted here so the ACP driver reuses it
// instead of duplicating the preamble-strip + truncate logic a third time; opencodeTranslate.ts
// re-exports its original name unchanged (existing imports/tests keep working).
import { stripEditorContext } from "../chat";

/** Session tab title from the user's first prompt: `<editor-context>` preamble stripped, whitespace
 *  collapsed, truncated with an ellipsis. */
export function titleFromPrompt(text: string, max = 48): string {
  const clean = stripEditorContext(text).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
