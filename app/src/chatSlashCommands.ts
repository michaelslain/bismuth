// app/src/chatSlashCommands.ts
// Pure parser for the chat composer's CLIENT-SIDE slash commands (Row 75): `/rename <name>`,
// `/color <swatch|hex|clear>`, and `/chrome [on|off]`. These are intercepted in ChatView BEFORE the
// turn is sent to Claude — they act on the chat TAB (rename / pane tint) or the chat's --chrome
// capability (persists the choice AND retargets the LIVE conversation, which respawns on the next
// message — BUG #87), never reach the model as a prompt. Kept pure + DOM-free so it's unit-testable
// headlessly.

export type ChatSlashCommand =
  | { kind: "rename"; name: string }
  // `arg` is the RAW color token as typed; the caller resolves it via resolveChatColorArg (so an
  // unknown token can be reported rather than silently ignored).
  | { kind: "color"; arg: string }
  // `/chrome [on|off]` sets this chat's --chrome (browser/computer-use) capability. `arg` is the RAW
  // token as typed ("" for a bare `/chrome`); the caller resolves it via computeChromeCommand so an
  // unknown token is reported rather than silently doing the opposite of what was asked.
  | { kind: "chrome"; arg: string };

/** Parse a composer draft as a client-side chat command, or null when it isn't one — then the draft
 *  flows on normally (a real Claude slash command, or plain prose). Only a LEADING
 *  `/rename`/`/color`/`/chrome` (case-insensitive) is intercepted; the rest of the line is the
 *  argument (trimmed). An empty `/rename` arg is kept (the caller reverts the tab to its auto
 *  label, like clearing an inline rename); an empty `/color` arg means "clear the tint"; an empty
 *  `/chrome` arg means "turn it ON" (see computeChromeCommand). */
export function parseChatSlashCommand(input: string): ChatSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const sp = trimmed.search(/\s/);
  const cmd = (sp === -1 ? trimmed.slice(1) : trimmed.slice(1, sp)).toLowerCase();
  const arg = sp === -1 ? "" : trimmed.slice(sp + 1).trim();
  if (cmd === "rename") return { kind: "rename", name: arg };
  if (cmd === "color" || cmd === "colour") return { kind: "color", arg };
  if (cmd === "chrome") return { kind: "chrome", arg };
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
  { name: "chrome", detail: "Give Claude browser access (--chrome) for this chat (\"/chrome off\" to remove it)" },
];

/** The transcript confirmation for a --chrome CHANGE — the visible-feedback half of BUG #87.
 *  --chrome is a spawn-fixed CLI flag, so a change can't flip a running turn; it takes effect when
 *  the session (re)spawns, which happens on the user's very next message (the client carries the new
 *  choice, the server respawns query() with/without --chrome, RESUMING THE SAME CONVERSATION — so it
 *  is the live chat that gains/loses the browser, not a fresh one). The wording is load-bearing (it
 *  must state the new state AND that it lands on the next message, never falsely claiming the
 *  current in-flight turn changed), so it's pure + unit-tested. */
export function chromeToggleNote(enabled: boolean): string {
  return `Browser (--chrome) ${enabled ? "enabled" : "disabled"} for this chat — takes effect from your next message.`;
}

/** The transcript confirmation when a `/chrome [on|off]` asked for the state the chat is ALREADY in.
 *  Nothing changes and nothing respawns, so it must NOT claim "takes effect from your next message"
 *  (there is no effect to take) — it just confirms the standing state. BUG #87 (bounce 3): `/chrome`
 *  is an ENABLE verb, so running it on an already-enabled chat has to keep reading "enabled". */
export function chromeAlreadyNote(enabled: boolean): string {
  return `Browser (--chrome) is already ${enabled ? "enabled" : "disabled"} for this chat.`;
}

/** Pure toggle mapping for the header Globe PILL: given the chat's CURRENT --chrome state, return
 *  the NEW state to persist plus the transcript note that describes it. Keeping the flip + the
 *  message in ONE pure function guarantees they can never drift apart (the note always reflects the
 *  NEW state). A pill is a stateful on/off control that RENDERS what it's about to flip, so toggle
 *  semantics are correct HERE — unlike the `/chrome` command (see computeChromeCommand). */
export function computeChromeToggle(current: boolean): { next: boolean; note: string } {
  const next = !current;
  return { next, note: chromeToggleNote(next) };
}

/** BUG #87, bounce 3 — the actual root cause. `/chrome` USED to be a blind toggle (`next = !current`)
 *  while everything about it — its name, the `--chrome` CLI flag it mirrors, its own card ("/chrome
 *  turns on browser/computer-use") — presents it as an ENABLE verb. A blind toggle's output depends
 *  on hidden prior state, so whenever the chat was ALREADY on (a vault with `chat.computerUse: true`,
 *  or simply having enabled it once before — the state a user who WANTS the browser is normally in)
 *  typing `/chrome` silently turned the browser OFF and answered "Browser (--chrome) disabled for
 *  this chat". Two earlier fixes only argued about which state the toggle should START from; that
 *  cannot work, because for ANY starting default there is a reachable state in which this ENABLE
 *  verb disables. So the command no longer toggles:
 *    - `/chrome` / `/chrome on`  → ON  (idempotent — already-on stays on and still reads "enabled")
 *    - `/chrome off`             → OFF (the ONLY way the command can report "disabled" — you asked)
 *  Returns undefined for an unrecognized argument so the caller can report it (like `/color`) rather
 *  than guess a direction. Pure + unit-tested in BOTH directions. */
export function computeChromeCommand(
  current: boolean,
  arg: string,
): { next: boolean; note: string } | undefined {
  const a = arg.trim().toLowerCase();
  const next = a === "" || a === "on" || a === "enable" ? true : a === "off" || a === "disable" ? false : undefined;
  if (next === undefined) return undefined;
  // Asking for the state you're already in changes nothing — confirm it without promising an effect.
  return { next, note: next === current ? chromeAlreadyNote(next) : chromeToggleNote(next) };
}

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
