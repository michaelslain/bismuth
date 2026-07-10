// app/src/chatSlashCommands.ts
// Pure parser for the chat composer's CLIENT-SIDE slash commands (Row 75): `/rename <name>`,
// `/color <swatch|hex|clear>`, and `/chrome`. These are intercepted in ChatView BEFORE the turn is
// sent to Claude — they act on the chat TAB (rename / pane tint) or app settings (chrome), never
// reach the model as a prompt. Kept pure + DOM-free so it's unit-testable headlessly.

export type ChatSlashCommand =
  | { kind: "rename"; name: string }
  // `arg` is the RAW color token as typed; the caller resolves it via resolveChatColorArg (so an
  // unknown token can be reported rather than silently ignored).
  | { kind: "color"; arg: string }
  // `/chrome` toggles `settings.chat.computerUse` (--chrome browser/computer-use capability).
  | { kind: "chrome" };

/** Parse a composer draft as a client-side chat command, or null when it isn't one — then the draft
 *  flows on normally (a real Claude slash command, or plain prose). Only a LEADING
 *  `/rename`/`/color`/`/chrome` (case-insensitive) is intercepted; the rest of the line is the
 *  argument (trimmed). An empty `/rename` arg is kept (the caller reverts the tab to its auto
 *  label, like clearing an inline rename); an empty `/color` arg means "clear the tint". */
export function parseChatSlashCommand(input: string): ChatSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const sp = trimmed.search(/\s/);
  const cmd = (sp === -1 ? trimmed.slice(1) : trimmed.slice(1, sp)).toLowerCase();
  const arg = sp === -1 ? "" : trimmed.slice(sp + 1).trim();
  if (cmd === "rename") return { kind: "rename", name: arg };
  if (cmd === "color" || cmd === "colour") return { kind: "color", arg };
  if (cmd === "chrome") return { kind: "chrome" };
  return null;
}

/** BUG #87 ("/chrome command missing"): the composer's "/" autocomplete (ChatView's `slashMatches`)
 *  used to be built ONLY from the backend session's own `manifest.slashCommands` — which never
 *  includes these client-side commands, so `/chrome` (and, less noticeably, `/rename`/`/color`)
 *  never showed up in the picker even though typing it out by hand worked. These are pure CLIENT
 *  concepts (tab rename / pane tint / a settings toggle) intercepted before a turn ever reaches the
 *  backend, so they're spliced in HERE rather than polluting core/chat.ts's LOCAL_SLASH_COMMANDS
 *  (which is for commands the backend itself answers, like `/mcp`). `detail` powers the popover
 *  row's description text (mirrors ChatView's SLASH_COMMAND_DETAILS for synthesized commands). */
export const CLIENT_SLASH_COMMANDS: { name: string; detail: string }[] = [
  { name: "rename", detail: "Rename this chat tab" },
  { name: "color", detail: "Tint this chat's pane (swatch name, hex, or \"clear\")" },
  { name: "chrome", detail: "Toggle browser (--chrome) for new sessions" },
];

/** Merge the client-side commands into a manifest's own slash-command names for the "/" autocomplete
 *  (BUG #87). Client commands are APPENDED after the backend's own list, deduped by name (a same-
 *  named backend command — unlikely — isn't shadowed). Works even before any manifest exists (an
 *  empty `commands` in) so `/chrome` etc. are offered from the moment the chat opens, not just after
 *  the session's first manifest lands. Pure — unit-tested without ChatView / Solid. */
export function withClientSlashCommands(commands: string[]): string[] {
  const out = [...commands];
  for (const c of CLIENT_SLASH_COMMANDS) if (!out.includes(c.name)) out.push(c.name);
  return out;
}
