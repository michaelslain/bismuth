// app/src/chatSlashCommands.ts
// Pure parser for the chat composer's CLIENT-SIDE slash commands (Row 75): `/rename <name>` and
// `/color <swatch|hex|clear>`. These are intercepted in ChatView BEFORE the turn is sent to Claude —
// they act on the chat TAB (rename / pane tint), never reach the model as a prompt. Kept pure +
// DOM-free (no chatColors/App imports) so it's unit-testable headlessly; the caller resolves the
// color token (resolveChatColorArg) and applies the effect (rename event / setChatColor).

export type ChatSlashCommand =
  | { kind: "rename"; name: string }
  // `arg` is the RAW color token as typed; the caller resolves it via resolveChatColorArg (so an
  // unknown token can be reported rather than silently ignored).
  | { kind: "color"; arg: string };

/** Parse a composer draft as a client-side chat command, or null when it isn't one — then the draft
 *  flows on normally (a real Claude slash command, or plain prose). Only a LEADING `/rename`/`/color`
 *  (case-insensitive) is intercepted; the rest of the line is the argument (trimmed). An empty
 *  `/rename` arg is kept (the caller reverts the tab to its auto label, like clearing an inline
 *  rename); an empty `/color` arg means "clear the tint". */
export function parseChatSlashCommand(input: string): ChatSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const sp = trimmed.search(/\s/);
  const cmd = (sp === -1 ? trimmed.slice(1) : trimmed.slice(1, sp)).toLowerCase();
  const arg = sp === -1 ? "" : trimmed.slice(sp + 1).trim();
  if (cmd === "rename") return { kind: "rename", name: arg };
  if (cmd === "color" || cmd === "colour") return { kind: "color", arg };
  return null;
}
