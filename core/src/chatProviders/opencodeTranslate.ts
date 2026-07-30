// core/src/chatProviders/opencodeTranslate.ts
// PURE translation from opencode's programmatic surfaces into the app's ChatFrame wire protocol
// (core/src/chat.ts — the single source of truth the frontend renders). No spawning, no IO —
// everything here is unit-tested against captured fixtures (core/test/chatProviders/).
//
// Two opencode surfaces are translated (both verified live against opencode 1.17.15):
//  1. `opencode run --format json <msg>` — one NDJSON event per line on stdout. Observed kinds:
//       {type:"step_start",  sessionID, part:{type:"step-start"}}
//       {type:"text",        sessionID, part:{id, type:"text", text}}          ← COMPLETE part text
//       {type:"tool_use",    sessionID, part:{type:"tool", tool, callID,
//                                             state:{status,input,output,error?,title}}}
//       {type:"step_finish", sessionID, part:{type:"step-finish", reason, tokens, cost}}
//     `text` parts arrive COMPLETE (one event per part, not streamed deltas) — but the translator
//     tolerates a future streaming shape by tracking per-part emitted length and emitting only the
//     suffix, so a repeated part id with growing text still renders exactly once.
//  2. `opencode export <sessionID>` — the full session JSON (info + messages[].parts) used to
//     replay history when a chat tab reopens on an opencode conversation.
//  3. `opencode serve`'s event/response surfaces (server mode — see ./opencode.ts,
//     ./opencodeServer.ts) — real token-level `message.part.delta` events, full `message.part.
//     updated` snapshots (tool lifecycle + text/reasoning parts that never streamed), and
//     `permission.asked`/`permission.replied`. Verified LIVE against opencode 1.18.4 to differ from
//     @opencode-ai/sdk@1.18.9's generated types.gen.d.ts in real ways — see the "opencode SERVER
//     mode" section below and opencodeServer.ts's top-of-file note for exactly what was checked.
import type { ChatFrame, ChatImage } from "../chat";
import { stripEditorContext } from "../chat";
import { titleFromPrompt } from "./titleFromPrompt";

/** Mutable per-TURN accounting for translateOpencodeEvent: which part ids have emitted how much
 *  text (suffix-only re-emission), which tool callIDs already produced a tool-use frame, the
 *  session id once seen, and the turn's accumulated cost (step_finish). One per spawned run. */
export interface OpencodeTurnState {
  /** part id → length of the text already emitted for it (text + reasoning parts). */
  emitted: Map<string, number>;
  /** tool callIDs whose `tool-use` frame already went out (a repeated/updated tool event then
   *  contributes only its result). */
  toolsStarted: Set<string>;
  /** tool callIDs whose `tool-result` frame already went out (never double-resolve a chip). */
  toolsFinished: Set<string>;
  sessionId: string | null;
  /** Summed `cost` off step_finish events (USD). Null until any step reported one. */
  costUsd: number | null;
}

export function newOpencodeTurnState(): OpencodeTurnState {
  return { emitted: new Map(), toolsStarted: new Set(), toolsFinished: new Set(), sessionId: null, costUsd: null };
}

/** Coerce a tool part's output/error into a display string (mirrors chat.ts stringifyToolContent). */
function toolContent(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Dig the human-readable message out of an opencode error event. Verified live (1.17.15): a real
 * API failure arrives as {type:"error", error:{name:"APIError", data:{message:"Unauthorized: …"}}}
 * — the message is NESTED under error.data, not on the event itself. Checked shallowest-first so a
 * simpler future shape still wins; bottoms out at a generic string, never throws.
 */
export function opencodeErrorMessage(ev: Record<string, unknown>): string {
  if (typeof ev.message === "string" && ev.message) return ev.message;
  const err = (ev.error && typeof ev.error === "object" ? ev.error : {}) as Record<string, unknown>;
  if (typeof err.message === "string" && err.message) return err.message;
  const data = (err.data && typeof err.data === "object" ? err.data : {}) as Record<string, unknown>;
  if (typeof data.message === "string" && data.message) return data.message;
  if (typeof err.name === "string" && err.name) return `opencode reported an error (${err.name})`;
  return "opencode reported an error";
}

/** Suffix-only text emission: given a part id and its text-so-far, return the not-yet-emitted
 *  tail ("" when nothing new). Handles both the observed complete-part shape AND a hypothetical
 *  cumulative-streaming shape with one rule. */
function unseenSuffix(state: OpencodeTurnState | OpencodeServerTurnState, partId: string, text: string): string {
  const seen = state.emitted.get(partId) ?? 0;
  if (text.length <= seen) return "";
  state.emitted.set(partId, text.length);
  return text.slice(seen);
}

/**
 * Shared tool-part -> ChatFrame(s) translation: a tool part arrives with its state already resolved
 * (status:"pending"/"running"/"completed"/"error") in BOTH surfaces this file translates —
 * `opencode run --format json`'s `tool_use` events (run mode) and `opencode serve`'s
 * `message.part.updated` events where `part.type === "tool"` (server mode, verified live: the SAME
 * pending -> running -> completed/error lifecycle on the SAME field names). One `tool-use` chip per
 * callID, resolved by exactly one later `tool-result` — repeated/updated events for an
 * already-started or already-finished callID contribute nothing more.
 */
function toolPartFrames(part: Record<string, unknown>, toolsStarted: Set<string>, toolsFinished: Set<string>): ChatFrame[] {
  const frames: ChatFrame[] = [];
  const callId = typeof part.callID === "string" && part.callID ? part.callID : typeof part.id === "string" ? part.id : "tool";
  const name = typeof part.tool === "string" && part.tool ? part.tool : "tool";
  const st = (part.state && typeof part.state === "object" ? part.state : {}) as Record<string, unknown>;
  const status = typeof st.status === "string" ? st.status : "";
  if (!toolsStarted.has(callId)) {
    toolsStarted.add(callId);
    frames.push({ type: "tool-use", id: callId, name, input: st.input });
  }
  if ((status === "completed" || status === "error") && !toolsFinished.has(callId)) {
    toolsFinished.add(callId);
    frames.push({
      type: "tool-result",
      id: callId,
      content: toolContent(status === "error" ? st.error ?? st.output : st.output),
      isError: status === "error",
    });
  }
  return frames;
}

/**
 * Translate ONE parsed `opencode run --format json` event into the ChatFrame(s) it produces,
 * updating `state`. Unknown/irrelevant event kinds yield []. Tolerant of malformed events (a
 * subprocess JSON boundary) — never throws.
 */
export function translateOpencodeEvent(raw: unknown, state: OpencodeTurnState): ChatFrame[] {
  if (!raw || typeof raw !== "object") return [];
  const ev = raw as Record<string, unknown>;
  if (typeof ev.sessionID === "string" && ev.sessionID) state.sessionId = ev.sessionID;
  const part = (ev.part && typeof ev.part === "object" ? ev.part : {}) as Record<string, unknown>;
  const frames: ChatFrame[] = [];

  switch (ev.type) {
    case "text": {
      const id = typeof part.id === "string" ? part.id : "text";
      const text = typeof part.text === "string" ? part.text : "";
      const delta = unseenSuffix(state, id, text);
      if (delta) frames.push({ type: "assistant-text", text: delta });
      return frames;
    }
    case "reasoning": {
      // Reasoning/thinking parts (shown by opencode's --thinking; shape mirrors text parts).
      const id = typeof part.id === "string" ? part.id : "reasoning";
      const text = typeof part.text === "string" ? part.text : "";
      const delta = unseenSuffix(state, id, text);
      if (delta) frames.push({ type: "thinking", text: delta });
      return frames;
    }
    case "tool_use":
      // Tool events arrive with their state already resolved (status:"completed"/"error") in run
      // mode — emit the tool-use chip AND its result together. A pending status emits only the
      // chip; a later event for the same callID then resolves it.
      return toolPartFrames(part, state.toolsStarted, state.toolsFinished);
    case "step_finish": {
      const cost = typeof part.cost === "number" ? part.cost : 0;
      if (cost > 0) state.costUsd = (state.costUsd ?? 0) + cost;
      return frames;
    }
    case "error": {
      // A run-level error event — surface its message as a chat error frame.
      frames.push({ type: "error", code: "error", message: opencodeErrorMessage(ev) });
      return frames;
    }
    default:
      return frames; // step_start / unknown kinds carry no UI frame
  }
}

/**
 * Translate an `opencode export` session JSON into replayable ChatFrames + the session's title —
 * the opencode analogue of chat.ts sessionHistoryFrames (live=false): user prose becomes
 * user-message bubbles (editor-context preamble stripped, like the SDK path), assistant text /
 * reasoning / tool parts replay in order. Tolerant: a malformed export yields { title:null,
 * frames:[] }.
 */
export function translateOpencodeExport(raw: unknown): { title: string | null; frames: ChatFrame[] } {
  if (!raw || typeof raw !== "object") return { title: null, frames: [] };
  const doc = raw as { info?: { title?: unknown }; messages?: unknown };
  const title = typeof doc.info?.title === "string" && doc.info.title.trim() ? doc.info.title.trim() : null;
  return { title, frames: framesFromOpencodeMessages(doc.messages) };
}

/**
 * Translate `GET /session/{id}/message`'s response (server mode's typed history endpoint —
 * `Array<{info: Message, parts: Part[]}>`, verified live to carry the SAME per-message
 * `{info:{role}, parts}` shape `opencode export`'s JSON does) into replayable ChatFrames. Shares
 * `framesFromOpencodeMessages` with `translateOpencodeExport` so both surfaces stay in lockstep —
 * the only difference is where the session's title comes from (export's own `info.title` vs a
 * separate `session.get()` call in server mode), which the caller supplies itself.
 */
export function translateOpencodeSessionMessages(messages: unknown): ChatFrame[] {
  return framesFromOpencodeMessages(messages);
}

/** Shared per-message loop backing translateOpencodeExport + translateOpencodeSessionMessages: user
 *  prose becomes user-message bubbles (editor-context preamble stripped), assistant text/reasoning/
 *  tool parts replay in order. Tolerant of a malformed/missing messages array (yields []). */
function framesFromOpencodeMessages(messages: unknown): ChatFrame[] {
  const out: ChatFrame[] = [];
  if (!Array.isArray(messages)) return out;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as { info?: { role?: unknown }; parts?: unknown };
    const role = m.info?.role;
    if (!Array.isArray(m.parts)) continue;
    if (role === "user") {
      const texts: string[] = [];
      for (const p of m.parts) {
        const pp = p as Record<string, unknown> | null;
        if (pp && pp.type === "text" && typeof pp.text === "string" && pp.text) texts.push(pp.text);
      }
      const text = stripEditorContext(texts.join(""));
      if (text) out.push({ type: "user-message", text });
      continue;
    }
    if (role !== "assistant") continue;
    for (const p of m.parts) {
      const pp = p as Record<string, unknown> | null;
      if (!pp || typeof pp !== "object") continue;
      if (pp.type === "text" && typeof pp.text === "string" && pp.text) {
        out.push({ type: "assistant-text", text: pp.text });
      } else if (pp.type === "reasoning" && typeof pp.text === "string" && pp.text) {
        out.push({ type: "thinking", text: pp.text });
      } else if (pp.type === "tool") {
        out.push(...toolPartFrames(pp, new Set(), new Set()));
      }
    }
  }
  return out;
}

/** One entry of the chat `models` frame, opencode-side. `free` (card #90: "show which one free
 *  and which one isnt") is tri-state: true/false when `opencode models --verbose` reported cost
 *  metadata, undefined when only the plain id list was available (no badge shown). */
export interface OpencodeModelEntry {
  value: string;
  label: string;
  description: string;
  effortLevels: string[];
  free?: boolean;
}

/** A model id is `provider/model` — one slash-separated token, no spaces (anything else is
 *  CLI banner/noise). */
const MODEL_ID_RE = /^[\w.-]+\/[\w.:-]+$/;

/**
 * Parse `opencode models` stdout (one `provider/model` per line) into the `models` frame's entry
 * shape. opencode has no per-model reasoning-effort discovery, so effortLevels is always [] —
 * which makes the frontend's Effort picker hide itself (exactly the graceful degradation the
 * header needs). Blank/garbage lines are dropped; order preserved; duplicates removed.
 */
export function parseOpencodeModels(stdout: string): OpencodeModelEntry[] {
  const seen = new Set<string>();
  const out: OpencodeModelEntry[] = [];
  for (const line of stdout.split("\n")) {
    const id = line.trim();
    if (!MODEL_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ value: id, label: id, description: "", effortLevels: [] });
  }
  return out;
}

/**
 * Parse `opencode models --verbose` stdout: each model is its bare `provider/model` id on a line
 * at column 0 followed by a pretty-printed JSON metadata block (verified live, 1.17.15 — inner
 * JSON lines are indented, so only the id lines match at column 0). The metadata yields:
 *   - `free`: cost.input === 0 && cost.output === 0 (opencode Zen's free tier) vs paid — the
 *     header model picker renders it as a Free/Paid badge (card #90).
 *   - `label`: the model's display `name` ("Claude Sonnet 4.6" beats "opencode/claude-sonnet-4-6");
 *     a name shared by several providers gets ` (providerID)` appended so the picker stays
 *     unambiguous. The full id remains the `value` (what `-m` needs) and the `description`.
 * A block that fails to parse degrades to the plain id (free undefined → no badge), so a format
 * drift can never lose a model. Returns [] when NO ids are found — the caller falls back to the
 * plain `opencode models` list.
 */
export function parseOpencodeModelsVerbose(stdout: string): OpencodeModelEntry[] {
  const seen = new Set<string>();
  const entries: { id: string; name: string | null; free?: boolean }[] = [];
  // Split at each column-0 id line; the first segment (anything before the first id) is noise.
  const segments = stdout.split(/^(?=[\w.-]+\/[\w.:-]+[ \t]*\r?$)/m);
  for (const seg of segments) {
    const nl = seg.indexOf("\n");
    const id = (nl >= 0 ? seg.slice(0, nl) : seg).trim();
    if (!MODEL_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    let name: string | null = null;
    let free: boolean | undefined;
    try {
      const meta = JSON.parse(nl >= 0 ? seg.slice(nl + 1) : "") as Record<string, unknown>;
      if (typeof meta.name === "string" && meta.name.trim()) name = meta.name.trim();
      const cost = (meta.cost && typeof meta.cost === "object" ? meta.cost : null) as Record<string, unknown> | null;
      if (cost && typeof cost.input === "number" && typeof cost.output === "number") {
        free = cost.input === 0 && cost.output === 0;
      }
    } catch {
      /* malformed/missing metadata block — keep the id, skip the badge */
    }
    entries.push({ id, name, free });
  }
  return finalizeModelEntries(entries);
}

/** Disambiguate display-name collisions across providers (e.g. "Kimi K2.5" is served by both
 *  opencode/ and moonshotai/ — every collided entry shows its provider) and shape the final
 *  `OpencodeModelEntry[]`. Shared by `parseOpencodeModelsVerbose` (CLI text, run-mode fallback) and
 *  `modelEntriesFromProviders` (server mode's typed `config.providers()` — no text parsing at all)
 *  so the two never drift on labeling/badge behavior. */
function finalizeModelEntries(entries: { id: string; name: string | null; free?: boolean }[]): OpencodeModelEntry[] {
  const nameCount = new Map<string, number>();
  for (const e of entries) if (e.name) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1);
  return entries.map((e) => {
    const collided = e.name && (nameCount.get(e.name) ?? 0) > 1;
    const label = e.name ? (collided ? `${e.name} (${e.id.split("/")[0]})` : e.name) : e.id;
    return { value: e.id, label, description: e.id, effortLevels: [], ...(e.free === undefined ? {} : { free: e.free }) };
  });
}

/** One provider's model catalog off `GET /config/providers` (server mode) — the fields this file
 *  actually reads, verified live against a real response (opencode 1.18.4): each provider nests its
 *  models under `models: {[modelId]: Model}`, `Model.cost.{input,output}` classify free vs paid
 *  (same $0/$0 rule the CLI-text path uses), `Model.name` is the display name. Deliberately NOT the
 *  SDK's generated `Provider`/`Model` types — those are a fine additional check but this file already
 *  treats every opencode surface as untyped JSON on principle (see opencodeServer.ts's top-of-file
 *  note on verified drift between the generated types and live behavior), so the fields we don't use
 *  are simply never named here. */
export interface OpencodeApiModel {
  id: string;
  name?: string;
  cost?: { input: number; output: number };
}
export interface OpencodeApiProvider {
  id: string;
  models?: Record<string, OpencodeApiModel>;
}

/**
 * Build the `models` frame's entries straight from server mode's typed `GET /config/providers`
 * response — no CLI text parsing at all, and RICHER than the run-mode fallback (real cost/name
 * fields instead of a pretty-printed-JSON scrape). Verified live: `opencode/big-pickle` and six other
 * `opencode/*` ids report `cost.input === 0 && cost.output === 0` (Zen's free tier — same models the
 * CLI-text path's Zen-rotation feature already discovers), `moonshotai/*` reports real paid costs.
 */
export function modelEntriesFromProviders(providers: OpencodeApiProvider[]): OpencodeModelEntry[] {
  const seen = new Set<string>();
  const entries: { id: string; name: string | null; free?: boolean }[] = [];
  for (const p of providers) {
    if (!p || typeof p.id !== "string" || !p.models) continue;
    for (const m of Object.values(p.models)) {
      if (!m || typeof m.id !== "string") continue;
      const id = `${p.id}/${m.id}`;
      if (!MODEL_ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      const name = typeof m.name === "string" && m.name.trim() ? m.name.trim() : null;
      const free = m.cost && typeof m.cost.input === "number" && typeof m.cost.output === "number" ? m.cost.input === 0 && m.cost.output === 0 : undefined;
      entries.push({ id, name, free });
    }
  }
  return finalizeModelEntries(entries);
}

/** Session tab title from the user's first prompt: preamble stripped, whitespace collapsed,
 *  truncated with an ellipsis — mirrors opencode's own truncated-prompt titling. Thin wrapper over
 *  the shared ./titleFromPrompt helper (also used by the ACP driver) — kept under its original
 *  name so existing imports/tests are untouched. */
export function opencodeTitleFromPrompt(text: string, max = 48): string {
  return titleFromPrompt(text, max);
}

// ── opencode commands (RE-FIX #90: "i dont see any opencode commands autocompleting") ────────────

/** One opencode command as offered in the composer's "/" autocomplete. */
export interface OpencodeCommandEntry {
  name: string;
  description: string;
}

/**
 * opencode's own built-in template commands, runnable non-interactively via
 * `opencode run --command <name>` (verified against 1.17.15's command registry — GET /command on a
 * live `opencode serve` lists both with source:"command"). TUI-only actions (/undo, /redo, /share,
 * /models, /connect…) are NOT commands in that registry — they act on the TUI itself and can't run
 * through `opencode run`, so offering them here would only produce server errors.
 */
export const OPENCODE_BUILTIN_COMMANDS: OpencodeCommandEntry[] = [
  { name: "init", description: "Create or update AGENTS.md for this repository" },
  { name: "review", description: "Review changes (commit, branch, PR — defaults to uncommitted)" },
];

/**
 * Parse `opencode debug config` stdout into the user's command list. The output is the RESOLVED
 * config as pretty-printed JSON — its `command` key merges commands from every source opencode
 * itself resolves: `~/.config/opencode/command/*.md`, the project's `.opencode/command/*.md`, the
 * `command` key in opencode.json(c), AND plugin-registered commands (verified live: the
 * oh-my-opencode-slim plugin's /interview, /deepwork, /reflect, /loop, /preset all appear).
 * Each value is `{ template, description?, … }` — description wins, else the template's first line
 * stands in so the popover row always has a blurb. Tolerant: any parse failure yields [].
 */
export function parseOpencodeDebugConfigCommands(stdout: string): OpencodeCommandEntry[] {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let config: unknown;
  try {
    config = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!config || typeof config !== "object") return [];
  const command = (config as Record<string, unknown>).command;
  if (!command || typeof command !== "object" || Array.isArray(command)) return [];
  const out: OpencodeCommandEntry[] = [];
  for (const [name, raw] of Object.entries(command as Record<string, unknown>)) {
    if (!name.trim() || /\s/.test(name)) continue; // a command name must be one "/"-typable token
    const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const description = typeof entry.description === "string" && entry.description.trim() ? entry.description.trim() : "";
    const template = typeof entry.template === "string" ? entry.template.split("\n")[0].trim() : "";
    out.push({ name, description: description || template });
  }
  return out;
}

/** One command off server mode's `GET /command` — the fields this file reads (name/description/
 *  template), verified live against a real response (opencode 1.18.4). */
export interface OpencodeApiCommand {
  name: string;
  description?: string;
  template?: string;
}

/**
 * Build the composer's "/" autocomplete registry straight from server mode's typed `GET /command`
 * — the direct replacement for `parseOpencodeDebugConfigCommands`'s `opencode debug config` JSON
 * scrape, same precedence rules (description wins, else the template's first line, a command name
 * must be one "/"-typable token). Verified live: returns the SAME merged registry (config-dir +
 * opencode.json(c) + plugin-registered commands) the CLI text path parses out of `debug config`.
 */
export function commandEntriesFromApi(commands: OpencodeApiCommand[]): OpencodeCommandEntry[] {
  const out: OpencodeCommandEntry[] = [];
  for (const c of commands) {
    if (!c || typeof c.name !== "string" || !c.name.trim() || /\s/.test(c.name)) continue;
    const description = typeof c.description === "string" && c.description.trim() ? c.description.trim() : typeof c.template === "string" ? c.template.split("\n")[0].trim() : "";
    out.push({ name: c.name, description });
  }
  return out;
}

/** Merge the built-in commands into a parsed command list, deduped by name — a same-named custom
 *  command OVERRIDES the built-in (opencode's own documented precedence). Order: the user's own
 *  commands first (they chose them), built-ins after. */
export function withOpencodeBuiltinCommands(commands: OpencodeCommandEntry[]): OpencodeCommandEntry[] {
  const out = [...commands];
  const names = new Set(commands.map((c) => c.name));
  for (const b of OPENCODE_BUILTIN_COMMANDS) if (!names.has(b.name)) out.push(b);
  return out;
}

/**
 * Detect a leading `/command [args…]` in a composer draft against the KNOWN opencode command
 * names. A match runs the turn as `opencode run --command <name> [args]` (opencode's documented
 * non-interactive command invocation — the message rides as $ARGUMENTS); anything else — including
 * an unknown /word, which is far more likely prose than a typo'd command — flows through as an
 * ordinary prompt. Case-sensitive: opencode command names are exact registry keys.
 */
export function parseOpencodeRunCommand(text: string, commandNames: string[]): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const sp = trimmed.search(/\s/);
  const name = sp === -1 ? trimmed.slice(1) : trimmed.slice(1, sp);
  if (!name || !commandNames.includes(name)) return null;
  return { command: name, args: sp === -1 ? "" : trimmed.slice(sp + 1).trim() };
}

// ── opencode auth (RE-FIX #90: "i dont see a way to do auth") ────────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const DIM = "\x1b[90m";

/**
 * Parse `opencode auth list` stdout into the stored-credential list. Verified live (1.17.15): a
 * clack-style block where each credential line is `●  <Provider Name> <dim><kind>` — the
 * provider name and the credential kind (api/oauth/…) are separated by the dim ANSI escape, so
 * we split there when present and fall back to the last space-separated token when colors are
 * absent (e.g. a future NO_COLOR-honoring opencode). Non-credential lines (the `┌ Credentials
 * <path>` header, `└ N credentials` footer, `│` spacers) carry no bullet and are skipped.
 * Tolerant of anything — worst case [] (= no stored credentials).
 */
export function parseOpencodeAuthList(stdout: string): { name: string; kind: string }[] {
  const out: { name: string; kind: string }[] = [];
  for (const rawLine of stdout.split("\n")) {
    const bullet = rawLine.indexOf("\u25cf");
    if (bullet < 0) continue;
    const body = rawLine.slice(bullet + 1);
    const dimAt = body.indexOf(DIM);
    let name: string;
    let kind: string;
    if (dimAt >= 0) {
      name = body.slice(0, dimAt).replace(ANSI_RE, "").trim();
      kind = body.slice(dimAt).replace(ANSI_RE, "").trim();
    } else {
      const plain = body.replace(ANSI_RE, "").trim();
      const lastSp = plain.lastIndexOf(" ");
      name = lastSp > 0 ? plain.slice(0, lastSp).trim() : plain;
      kind = lastSp > 0 ? plain.slice(lastSp + 1).trim() : "";
    }
    if (name) out.push({ name, kind });
  }
  return out;
}

// ── Zen free-model rotation (RE-FIX #90: "that thing that rotates between free models") ──────────

/**
 * The virtual model id for "rotate among opencode Zen's currently-free models". The `bismuth/`
 * provider prefix can never collide with a real opencode provider id, still satisfies the
 * `provider/model` shape setModel validates, and is intercepted in runTurn BEFORE `-m` is built —
 * it never reaches the opencode CLI.
 */
export const ZEN_FREE_ROTATE_ID = "bismuth/zen-free-rotate";

/** The ids eligible for rotation: opencode Zen models (`opencode/…` — Zen is the `opencode`
 *  provider) whose cost metadata reported $0 in/out. Order preserved from the models list. */
export function zenFreeModelIds(models: OpencodeModelEntry[]): string[] {
  return models.filter((m) => m.free === true && m.value.startsWith("opencode/")).map((m) => m.value);
}

/** Prepend the virtual rotate entry when Zen currently offers free models (the free roster is
 *  promotional and rotates over time — when it's empty the option simply disappears rather than
 *  silently running nothing). Marked free so the picker badges it. */
export function withZenFreeRotate(models: OpencodeModelEntry[]): OpencodeModelEntry[] {
  const free = zenFreeModelIds(models);
  if (!free.length) return models;
  return [
    {
      value: ZEN_FREE_ROTATE_ID,
      label: "Zen Free (rotating)",
      description: `Rotates each turn among opencode Zen's ${free.length} currently-free models`,
      effortLevels: [],
      free: true,
    },
    ...models,
  ];
}

/** Round-robin pick for a rotating-free-models turn: turn N runs free model N mod len. Null when
 *  the free roster is empty/unknown (the run then omits `-m` — opencode's own default model). */
export function pickZenFreeModel(freeIds: string[], turnIndex: number): string | null {
  if (!freeIds.length) return null;
  return freeIds[((turnIndex % freeIds.length) + freeIds.length) % freeIds.length];
}

// ── opencode SERVER mode (`opencode serve` + @opencode-ai/sdk) ──────────────────────────────────────
//
// Translation for the persistent-server surface (chatProviders/opencodeServer.ts +
// chatProviders/opencode.ts's server-mode turn path), replacing the per-turn `opencode run --format
// json` subprocess's NDJSON above. Two real, load-bearing differences from the run-mode CLI's event
// shapes were confirmed by capturing a live `GET /event` stream (opencode 1.18.4) — NEITHER matches
// what @opencode-ai/sdk@1.18.9's generated types.gen.d.ts declares:
//   1. Token-level deltas arrive as a SEPARATE event type, "message.part.delta"
//      ({sessionID,messageID,partID,field,delta}) — NOT a `delta` field nested inside
//      "message.part.updated" the way the generated Event union claims.
//   2. A permission ask arrives as "permission.asked" ({id,permission,patterns,metadata,always,
//      tool:{messageID,callID}}) — NOT "permission.updated" with a Permission{type,pattern,title}
//      shape. ("permission.replied" similarly carries `requestID`/`reply`, not `permissionID`/
//      `response`.)
// So every event here is read as untyped JSON, matching this file's existing tolerance for the
// run-mode CLI's own NDJSON.

/** Mutable per-TURN accounting for translateOpencodeServerEvent — the server-mode analogue of
 *  OpencodeTurnState. Extra bookkeeping vs. the run-mode state: `partKind` remembers which frame
 *  kind a part id maps to (learned off its FIRST "message.part.updated", since a later
 *  "message.part.delta" for the same part carries no `type` of its own) and `messageRoles` remembers
 *  which messageIds are the user's OWN echoed turn (learned off "message.updated") so those never
 *  get re-rendered as assistant output — the server's event bus reports the full session lifecycle,
 *  not just the turn's assistant output the way run-mode's NDJSON does. Cost/tokens are NOT
 *  accumulated here in server mode: the awaited `session.prompt()`/`session.command()` HTTP response
 *  carries the turn's authoritative `info.cost`, which is simpler and can't double-count multi-step
 *  turns the way summing every `step-finish` event would. */
export interface OpencodeServerTurnState {
  emitted: Map<string, number>;
  partKind: Map<string, "text" | "reasoning">;
  messageRoles: Map<string, "user" | "assistant">;
  toolsStarted: Set<string>;
  toolsFinished: Set<string>;
}

export function newOpencodeServerTurnState(): OpencodeServerTurnState {
  return { emitted: new Map(), partKind: new Map(), messageRoles: new Map(), toolsStarted: new Set(), toolsFinished: new Set() };
}

/**
 * Translate ONE raw event off the server's global event stream into the ChatFrame(s) it produces for
 * the CURRENT turn, updating `state`. Deliberately does NOT handle "permission.asked" — that's
 * parsed by `parseOpencodePermissionAsk` instead (chatProviders/opencode.ts calls both per event: a
 * permission ask needs the id echoed back later by `respondPermission`, which doesn't fit this
 * function's stateless-per-event shape as cleanly). Tolerant of anything — never throws.
 */
export function translateOpencodeServerEvent(raw: unknown, state: OpencodeServerTurnState): ChatFrame[] {
  if (!raw || typeof raw !== "object") return [];
  const ev = raw as Record<string, unknown>;
  const props = (ev.properties && typeof ev.properties === "object" ? ev.properties : {}) as Record<string, unknown>;

  if (ev.type === "message.updated") {
    const info = (props.info && typeof props.info === "object" ? props.info : {}) as Record<string, unknown>;
    const id = typeof info.id === "string" ? info.id : null;
    if (id && info.role === "user") state.messageRoles.set(id, "user");
    else if (id && info.role === "assistant") state.messageRoles.set(id, "assistant");
    return [];
  }

  if (ev.type === "message.part.delta") {
    const messageId = typeof props.messageID === "string" ? props.messageID : "";
    if (state.messageRoles.get(messageId) === "user") return []; // never re-echo the user's own prompt
    if (props.field !== "text") return [];
    const partId = typeof props.partID === "string" ? props.partID : "";
    const delta = typeof props.delta === "string" ? props.delta : "";
    if (!partId || !delta) return [];
    state.emitted.set(partId, (state.emitted.get(partId) ?? 0) + delta.length);
    const kind = state.partKind.get(partId) ?? "text";
    return [kind === "reasoning" ? { type: "thinking", text: delta } : { type: "assistant-text", text: delta }];
  }

  if (ev.type === "message.part.updated") {
    const part = (props.part && typeof props.part === "object" ? props.part : {}) as Record<string, unknown>;
    const messageId = typeof part.messageID === "string" ? part.messageID : "";
    if (state.messageRoles.get(messageId) === "user") return [];
    if (part.type === "tool") return toolPartFrames(part, state.toolsStarted, state.toolsFinished);
    if (part.type === "text" || part.type === "reasoning") {
      const id = typeof part.id === "string" ? part.id : "";
      if (!id) return [];
      state.partKind.set(id, part.type);
      // A full-text snapshot: emit only what message.part.delta hasn't already streamed (covers a
      // model/tool that never streams deltas at all, and de-dupes the FINAL settled snapshot against
      // whatever deltas already went out).
      const text = typeof part.text === "string" ? part.text : "";
      const delta = unseenSuffix(state, id, text);
      if (!delta) return [];
      return [part.type === "reasoning" ? { type: "thinking", text: delta } : { type: "assistant-text", text: delta }];
    }
    return []; // step-start/step-finish/snapshot/patch/agent/retry/compaction: no UI frame
  }

  return []; // session.*/permission.*/todo.*/etc: not this function's concern
}

/** One pending approval ask, normalized out of whichever shape the live server emits (see the
 *  top-of-section note on "permission.asked" vs the SDK-declared "permission.updated"/Permission —
 *  this reads BOTH the observed live field names ("permission"/"patterns") and the SDK-declared ones
 *  ("type"/"pattern"/"title") so a future server release that reverts to the documented shape still
 *  works without a code change. */
export interface OpencodePermissionAsk {
  id: string;
  toolName: string;
  input: unknown;
}

/**
 * Parse a raw event into a permission ask, or null when it isn't one / is malformed. Verified live
 * (opencode 1.18.4): `{type:"permission.asked", properties:{id,permission:"bash",
 * patterns:["echo hi"], metadata:{command:"echo hi"}, always:["echo *"], tool:{...}}}` — `metadata`
 * (when non-empty) is the richest `input` for the permission card's summary (e.g. `{command:...}`,
 * which `summarizeInput` on the frontend already knows how to render); `patterns`/`pattern` is the
 * fallback when metadata is empty.
 */
export function parseOpencodePermissionAsk(raw: unknown): OpencodePermissionAsk | null {
  if (!raw || typeof raw !== "object") return null;
  const ev = raw as Record<string, unknown>;
  if (ev.type !== "permission.asked" && ev.type !== "permission.updated") return null;
  const props = (ev.properties && typeof ev.properties === "object" ? ev.properties : ev) as Record<string, unknown>;
  const id = typeof props.id === "string" && props.id ? props.id : null;
  if (!id) return null;
  const toolName = (typeof props.permission === "string" && props.permission) || (typeof props.type === "string" && props.type) || "tool";
  const metadata = (props.metadata && typeof props.metadata === "object" ? props.metadata : {}) as Record<string, unknown>;
  if (Object.keys(metadata).length) return { id, toolName, input: metadata };
  const patterns = props.patterns ?? props.pattern;
  return { id, toolName, input: patterns !== undefined ? { pattern: patterns } : {} };
}

/**
 * Map the chat's generic permission-answer verb onto the server's `{response: "once"|"always"|
 * "reject"}` body (verified live: both "once" and "reject" produced the expected effect — the tool
 * ran, or errored with "The user rejected permission to use this specific tool call."). "always"
 * covers the header's future "always allow this tool" affordance, if one is ever added; today the
 * client only ever sends allow/deny (see app/src/ChatView.tsx's PermissionCard), so `always` stays
 * plumbed through but effectively unused until then.
 */
export function opencodePermissionResponse(behavior: "allow" | "deny", always?: boolean): "once" | "always" | "reject" {
  if (behavior === "deny") return "reject";
  return always ? "always" : "once";
}

/** Split a `provider/model` id into the `{providerID, modelID}` object `session.prompt`/
 *  `session.create` expect — the FIRST "/" is the split point (a modelID may itself contain "/" or
 *  "." per MODEL_ID_RE, e.g. some Zen ids), never `.split("/")`. Null for anything that doesn't look
 *  like a model id (mirrors setModel's own validation), so a stale/garbage model can never reach the
 *  server as a malformed body. */
export function splitOpencodeModelId(model: string): { providerID: string; modelID: string } | null {
  if (!MODEL_ID_RE.test(model)) return null;
  const i = model.indexOf("/");
  if (i < 0) return null;
  return { providerID: model.slice(0, i), modelID: model.slice(i + 1) };
}

/** One part of `session.prompt`'s body — the request-shape subset this file builds (text + file
 *  attachments only; opencode's SDK also allows agent/subtask parts this driver never sends). */
export type OpencodePromptPart = { type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string };

/**
 * Build `session.prompt`'s `parts` array from a turn's text + image attachments. An image rides as a
 * `data:` URL (verified live: `POST /session/{id}/message` accepted a `FilePartInput{type:"file",
 * mime,url:"data:image/png;base64,..."}` with HTTP 200, and a vision-capable free model
 * (`opencode/mimo-v2.5-free`) genuinely read pixel content back — this was NOT assumed from the SDK
 * types, it was independently confirmed with one real call per this task's brief). Text-less image
 * turns still carry a (possibly empty) leading text part, matching the CLI path's own "always send
 * something" convention.
 */
export function buildOpencodePromptParts(text: string, images?: ChatImage[]): OpencodePromptPart[] {
  const parts: OpencodePromptPart[] = [{ type: "text", text }];
  for (const im of images ?? []) {
    parts.push({ type: "file", mime: im.media_type, url: `data:${im.media_type};base64,${im.data}` });
  }
  return parts;
}
