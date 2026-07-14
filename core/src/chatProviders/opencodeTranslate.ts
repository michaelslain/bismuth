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
import type { ChatFrame } from "../chat";
import { stripEditorContext } from "../chat";

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
function unseenSuffix(state: OpencodeTurnState, partId: string, text: string): string {
  const seen = state.emitted.get(partId) ?? 0;
  if (text.length <= seen) return "";
  state.emitted.set(partId, text.length);
  return text.slice(seen);
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
    case "tool_use": {
      // Tool events arrive with their state already resolved (status:"completed"/"error") in run
      // mode — emit the tool-use chip AND its result together. A pending status emits only the
      // chip; a later event for the same callID then resolves it.
      const callId = typeof part.callID === "string" && part.callID ? part.callID : typeof part.id === "string" ? part.id : "tool";
      const name = typeof part.tool === "string" && part.tool ? part.tool : "tool";
      const st = (part.state && typeof part.state === "object" ? part.state : {}) as Record<string, unknown>;
      const status = typeof st.status === "string" ? st.status : "";
      if (!state.toolsStarted.has(callId)) {
        state.toolsStarted.add(callId);
        frames.push({ type: "tool-use", id: callId, name, input: st.input });
      }
      if ((status === "completed" || status === "error") && !state.toolsFinished.has(callId)) {
        state.toolsFinished.add(callId);
        frames.push({
          type: "tool-result",
          id: callId,
          content: toolContent(status === "error" ? st.error ?? st.output : st.output),
          isError: status === "error",
        });
      }
      return frames;
    }
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
  const out: ChatFrame[] = [];
  if (!raw || typeof raw !== "object") return { title: null, frames: out };
  const doc = raw as { info?: { title?: unknown }; messages?: unknown };
  const title = typeof doc.info?.title === "string" && doc.info.title.trim() ? doc.info.title.trim() : null;
  if (!Array.isArray(doc.messages)) return { title, frames: out };
  for (const msg of doc.messages) {
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
        const st = (pp.state && typeof pp.state === "object" ? pp.state : {}) as Record<string, unknown>;
        const id = typeof pp.callID === "string" && pp.callID ? pp.callID : typeof pp.id === "string" ? (pp.id as string) : "tool";
        out.push({ type: "tool-use", id, name: typeof pp.tool === "string" && pp.tool ? pp.tool : "tool", input: st.input });
        const status = typeof st.status === "string" ? st.status : "";
        if (status === "completed" || status === "error") {
          out.push({
            type: "tool-result",
            id,
            content: toolContent(status === "error" ? st.error ?? st.output : st.output),
            isError: status === "error",
          });
        }
      }
    }
  }
  return { title, frames: out };
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
  // Disambiguate display-name collisions across providers (e.g. "Kimi K2.5" is served by both
  // opencode/ and moonshotai/) — every collided entry shows its provider.
  const nameCount = new Map<string, number>();
  for (const e of entries) if (e.name) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1);
  return entries.map((e) => {
    const collided = e.name && (nameCount.get(e.name) ?? 0) > 1;
    const label = e.name ? (collided ? `${e.name} (${e.id.split("/")[0]})` : e.name) : e.id;
    return { value: e.id, label, description: e.id, effortLevels: [], ...(e.free === undefined ? {} : { free: e.free }) };
  });
}

/** Session tab title from the user's first prompt: preamble stripped, whitespace collapsed,
 *  truncated with an ellipsis — mirrors opencode's own truncated-prompt titling. */
export function opencodeTitleFromPrompt(text: string, max = 48): string {
  const clean = stripEditorContext(text).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
