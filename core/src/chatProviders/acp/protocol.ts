// core/src/chatProviders/acp/protocol.ts
// PURE Agent Client Protocol (ACP) plumbing: the JSON-RPC 2.0 envelope, the slice of the ACP method
// surface Bismuth's driver speaks, and translateSessionUpdate — the ACP analogue of
// ../opencodeTranslate.ts's translateOpencodeEvent. No spawning, no IO, nothing Bun/node-specific:
// everything here is unit-tested against fixtures shaped like the verified schema (see the ACP
// research report handed to this task — grepped against @agentclientprotocol/sdk@1.3.0's generated
// .d.ts). ../acp/driver.ts is the effectful half (spawns the agent subprocess, owns the socket).
//
// Version-skew posture: ACP's ecosystem is visibly mid-migration (the TS SDK is at 1.3.0; the
// still-current Zed claude-code-acp adapter pins 0.14.1). Every parser here treats its input as
// untrusted `unknown` and degrades to an empty/neutral result rather than throwing — a field
// present in one SDK generation and absent in another must never crash a turn.
import type { ChatFrame } from "../../chat";

// ── JSON-RPC 2.0 envelope ─────────────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: number | string;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: number | string;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/** Any single parsed line off the wire — a request (agent calling INTO us), a notification (no
 *  reply expected), or a response (to a request WE sent). */
export type JsonRpcInbound = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isJsonRpcResponse(msg: JsonRpcInbound): msg is JsonRpcResponse {
  return "id" in msg && !("method" in msg) && ("result" in msg || "error" in msg);
}

export function isJsonRpcRequest(msg: JsonRpcInbound): msg is JsonRpcRequest {
  return "method" in msg && "id" in msg;
}

export function isJsonRpcNotification(msg: JsonRpcInbound): msg is JsonRpcNotification {
  return "method" in msg && !("id" in msg);
}

/** Parse one newline-delimited-JSON-RPC line. Tolerant: blank lines, non-JSON noise a CLI might
 *  print to stdout, and anything not shaped like a JSON-RPC 2.0 envelope all yield null (skipped
 *  by the caller) rather than throwing — mirrors translateOpencodeEvent's NDJSON pump. */
export function parseJsonRpcLine(line: string): JsonRpcInbound | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object" || (msg as Record<string, unknown>).jsonrpc !== "2.0") return null;
  return msg as JsonRpcInbound;
}

function line(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

export function encodeJsonRpcRequest(id: number, method: string, params?: unknown): string {
  return line({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
}

export function encodeJsonRpcNotification(method: string, params?: unknown): string {
  return line({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
}

export function encodeJsonRpcResult(id: number | string, result: unknown): string {
  return line({ jsonrpc: "2.0", id, result });
}

export function encodeJsonRpcError(id: number | string, code: number, message: string): string {
  return line({ jsonrpc: "2.0", id, error: { code, message } });
}

/** A fresh outbound-request id minter, one per spawned agent connection (ids only need to be
 *  unique WITHIN a connection, never across chats/processes). */
export function createIdMinter(): () => number {
  let next = 0;
  return () => ++next;
}

// ── Errors from a rejected outbound call ─────────────────────────────────────────────────────

/** An agent's JSON-RPC error response to a request WE sent (initialize/session/new/session/prompt/
 *  …). Carries the numeric code so isMethodNotFoundError can distinguish "doesn't implement this
 *  verb" (the session/load → session/resume fallback trigger) from a real turn failure. */
export class AcpRpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "AcpRpcError";
    this.code = code;
  }
}

const METHOD_NOT_FOUND = -32601;

/** True when a rejected call means "this agent doesn't implement that method at all" — the
 *  trigger for the session/load → session/resume fallback the report documents (some SDK
 *  generations ship only one of the two verbs). Checks the reserved JSON-RPC code first; falls
 *  back to a textual sniff since not every agent bundle is guaranteed to use it correctly. */
export function isMethodNotFoundError(e: unknown): boolean {
  if (e instanceof AcpRpcError && e.code === METHOD_NOT_FOUND) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /method not found|unknown method|no such method/i.test(msg);
}

// ── ACP wire shapes we send (reference types — params we build ourselves) ───────────────────

export interface AcpMcpServerStdio {
  name: string;
  command: string;
  args: string[];
  /** Array-of-pairs, NOT a plain object — verified field shape. */
  env: { name: string; value: string }[];
}

export type AcpOutboundContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

// ── ACP wire shapes we receive (reference types — for readability; parsers below stay tolerant
// of anything NOT matching, so these are documentation, not a validation boundary) ────────────

export interface AcpToolCallContentEntry {
  type?: string;
  content?: unknown; // a ContentBlock, when type === "content"
  path?: string; // when type === "diff"
  [k: string]: unknown;
}

export interface AcpSessionConfigOption {
  id?: string;
  name?: string;
  description?: string | null;
  category?: string | null;
  type?: "select" | "boolean";
  options?: { id?: string; name?: string }[];
  currentValue?: unknown;
}

export interface AcpNewSessionResult {
  sessionId?: string;
  modes?: unknown;
  /** New shape (SDK ~0.20+): model choice generalized into config options (category "model"). */
  configOptions?: AcpSessionConfigOption[];
  /** Old shape (still-shipping adapters pinned to sdk 0.14.1, and cline's bundled dispatch). */
  models?: {
    availableModels?: { modelId?: string; name?: string; description?: string }[];
    currentModelId?: string;
  };
}

// ── Model/effort version-skew detection (session/new's result → the `models` ChatFrame) ──────

export interface AcpModelEntry {
  value: string;
  label: string;
  description: string;
  effortLevels: string[];
}

export interface AcpModelShapeInfo {
  shape: "new" | "old" | "none";
  models: AcpModelEntry[];
  currentModelId: string | null;
  /** New-shape only: the configId session/set_config_option needs to switch models. */
  modelConfigId: string | null;
  /** New-shape only: the configId session/set_config_option needs to switch reasoning effort (the
   *  sibling configOptions entry with category "thought_level"), or null when the agent exposes
   *  none — setEffort is then a no-op, matching every model's effortLevels being []. */
  effortConfigId: string | null;
}

/**
 * Pure: classify a `session/new` (or session/load/session/resume) result as the NEW config-option
 * model shape, the OLD `models.availableModels` shape, or neither — and project either into the
 * app's `models` ChatFrame entries. This is the single "must handle both eras" branch point the
 * report calls out: SDKs ~0.20+ generalize model choice into `configOptions` (category "model");
 * still-shipping 0.14.1-pinned adapters (claude-code-acp) and cline's bundled dispatch instead
 * report `NewSessionResponse.models`. Every field access is defensive — a malformed/absent result
 * yields shape "none" with an empty model list, never a throw.
 *
 * effortLevels rides EVERY model entry from a sibling `configOptions` entry of category
 * "thought_level", when one exists (session-level, not truly per-model — ACP has no per-model
 * effort granularity — but it's the closest honest mapping onto the app's per-model shape, and an
 * absent thought_level option correctly yields [] on every entry, hiding the header's Effort
 * picker exactly like a model with no reasoning-effort support).
 */
export function detectModelShape(newSessionResult: unknown): AcpModelShapeInfo {
  const r = (newSessionResult && typeof newSessionResult === "object" ? newSessionResult : {}) as AcpNewSessionResult;

  const configOptions = Array.isArray(r.configOptions) ? r.configOptions : null;
  const modelOpt = configOptions?.find((o) => o && o.category === "model" && Array.isArray(o.options));
  if (modelOpt) {
    const thoughtOpt = configOptions?.find((o) => o && o.category === "thought_level" && Array.isArray(o.options));
    const effortLevels = (thoughtOpt?.options ?? [])
      .map((o) => (typeof o?.name === "string" && o.name ? o.name : typeof o?.id === "string" ? o.id : ""))
      .filter(Boolean);
    const models: AcpModelEntry[] = (modelOpt.options ?? [])
      .filter((o): o is { id: string; name?: string } => typeof o?.id === "string" && o.id.length > 0)
      .map((o) => ({
        value: o.id,
        label: typeof o.name === "string" && o.name ? o.name : o.id,
        description: "",
        effortLevels,
      }));
    return {
      shape: "new",
      models,
      currentModelId: typeof modelOpt.currentValue === "string" ? modelOpt.currentValue : null,
      modelConfigId: typeof modelOpt.id === "string" ? modelOpt.id : null,
      effortConfigId: typeof thoughtOpt?.id === "string" ? thoughtOpt.id : null,
    };
  }

  const modelsField = r.models && typeof r.models === "object" ? r.models : null;
  if (modelsField) {
    const avail = Array.isArray(modelsField.availableModels) ? modelsField.availableModels : [];
    const models: AcpModelEntry[] = avail
      .filter((m): m is { modelId: string; name?: string; description?: string } => typeof m?.modelId === "string" && m.modelId.length > 0)
      .map((m) => ({
        value: m.modelId,
        label: typeof m.name === "string" && m.name ? m.name : m.modelId,
        description: typeof m.description === "string" ? m.description : "",
        effortLevels: [],
      }));
    return {
      shape: "old",
      models,
      currentModelId: typeof modelsField.currentModelId === "string" ? modelsField.currentModelId : null,
      modelConfigId: null,
      effortConfigId: null,
    };
  }

  return { shape: "none", models: [], currentModelId: null, modelConfigId: null, effortConfigId: null };
}

// ── Content-block → display text (agent_message_chunk / agent_thought_chunk / tool content) ──

/** Extract display text off ONE ContentBlock (`{type:"text"|"image"|"audio"|"resource_link"|
 *  "resource", …}`). Non-text kinds get a short bracketed placeholder rather than vanishing
 *  silently — a turn that only attached an image would otherwise render as empty prose. */
export function contentBlockText(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  const b = block as Record<string, unknown>;
  switch (b.type) {
    case "text":
      return typeof b.text === "string" ? b.text : "";
    case "image":
      return "[image]";
    case "audio":
      return "[audio]";
    case "resource_link": {
      const name = typeof b.name === "string" && b.name ? b.name : "resource";
      return typeof b.uri === "string" ? `[${name}](${b.uri})` : `[${name}]`;
    }
    case "resource":
      return "[embedded resource]";
    default:
      return "";
  }
}

/** Render a tool call's `content` (ToolCallContent[]) as one display string for the `tool-result`
 *  frame — each entry is either `{type:"content", content:<ContentBlock>}` (text rides here, per
 *  the report's worked example) or a `{type:"diff", path, …}` edit summary; anything else falls
 *  back to its raw JSON so nothing is silently dropped. */
export function toolCallContentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const entry of content) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as AcpToolCallContentEntry;
    if (e.type === "content") {
      const text = contentBlockText(e.content);
      if (text) parts.push(text);
    } else if (e.type === "diff") {
      parts.push(typeof e.path === "string" && e.path ? `diff: ${e.path}` : "diff");
    } else {
      try {
        parts.push(JSON.stringify(e));
      } catch {
        /* unstringifiable — skip this entry, keep the rest */
      }
    }
  }
  return parts.join("\n");
}

/** Synthesize a `tool-use` frame's `input` from a ToolCall, which (unlike opencode/Claude tool
 *  calls) carries no structured parameters — only a human-readable `title` and an optional
 *  `kind`. `description` is one of summarizeInput's (app/src/ChatView.tsx) recognized keys, so
 *  the chip's one-line label shows the title text directly instead of a raw `{"title":"…"}` blob. */
export function toolCallInput(u: { title?: unknown; kind?: unknown }): unknown {
  const out: Record<string, unknown> = {};
  if (typeof u.title === "string" && u.title) out.description = u.title;
  if (typeof u.kind === "string" && u.kind) out.kind = u.kind;
  return Object.keys(out).length ? out : undefined;
}

// ── session/update → ChatFrame[] ─────────────────────────────────────────────────────────────

/** The manifest fields translateSessionUpdate can't derive on its own (model/permissionMode/tools/
 *  mcpServers come from session/new + setModel, not from session/update) — the driver seeds this
 *  once at session-open and keeps it current; available_commands_update only refreshes the
 *  slash-command fields, so the rest must be read from here to emit a COMPLETE manifest. */
export interface AcpManifestBaseline {
  model: string;
  permissionMode: string;
  tools: string[];
  mcpServers: { name: string; status: string }[];
  slashCommands: string[];
  commandDetails: Record<string, string>;
}

/** Mutable per-SESSION scratch for translateSessionUpdate: tool-call bookkeeping (never double-
 *  resolve a chip), accumulated usage/cost, and the manifest baseline above. One per ACP session,
 *  reset only when the session itself is recreated (NOT per turn — a tool call in ACP is a
 *  notification stream tied to the session's own request/response pair, not something that needs
 *  turn-scoped isolation the way opencode's per-spawn turns do). */
export interface AcpTranslateState {
  manifest: AcpManifestBaseline;
  toolCalls: Map<string, { name: string }>;
  toolsResolved: Set<string>;
  costUsd: number | null;
  usedTokens: number | null;
  maxTokens: number | null;
}

export function newAcpTranslateState(manifest: AcpManifestBaseline): AcpTranslateState {
  return { manifest, toolCalls: new Map(), toolsResolved: new Set(), costUsd: null, usedTokens: null, maxTokens: null };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Translate ONE parsed `session/update` notification payload (the `update` field — NOT the whole
 * JSON-RPC envelope) into the ChatFrame(s) it produces, mutating `state`. Handles every
 * `sessionUpdate` kind in the verified union; unknown/future kinds and malformed input both yield
 * [] — never throw. Mirrors translateOpencodeEvent's tolerant-NDJSON-pump posture.
 */
export function translateSessionUpdate(raw: unknown, state: AcpTranslateState): ChatFrame[] {
  if (!raw || typeof raw !== "object") return [];
  const u = raw as Record<string, unknown>;

  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      const text = contentBlockText(u.content);
      return text ? [{ type: "assistant-text", text }] : [];
    }

    case "agent_thought_chunk": {
      const text = contentBlockText(u.content);
      return text ? [{ type: "thinking", text }] : [];
    }

    case "tool_call": {
      const id = str(u.toolCallId);
      if (!id) return [];
      const name = str(u.name) || str(u.kind) || "tool";
      state.toolCalls.set(id, { name });
      const frames: ChatFrame[] = [{ type: "tool-use", id, name, input: toolCallInput(u) }];
      const status = str(u.status);
      // Defensive: an agent that resolves a tool call INSTANTLY (no separate tool_call_update)
      // still gets its result frame from the initial event, same guard as tool_call_update below.
      if ((status === "completed" || status === "failed") && !state.toolsResolved.has(id)) {
        state.toolsResolved.add(id);
        frames.push({ type: "tool-result", id, content: toolCallContentText(u.content), isError: status === "failed" });
      }
      return frames;
    }

    case "tool_call_update": {
      const id = str(u.toolCallId);
      if (!id) return [];
      const status = str(u.status);
      // Only completed/failed carries a result — pending/in_progress updates have nothing new to
      // show the user (the chip is already up from the initial tool_call).
      if (status !== "completed" && status !== "failed") return [];
      if (state.toolsResolved.has(id)) return []; // never double-resolve a chip
      state.toolsResolved.add(id);
      return [{ type: "tool-result", id, content: toolCallContentText(u.content), isError: status === "failed" }];
    }

    case "available_commands_update": {
      const raw2 = Array.isArray(u.availableCommands) ? u.availableCommands : [];
      const commands = raw2
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as Record<string, unknown>).name === "string" && !!(c as Record<string, unknown>).name)
        .map((c) => ({ name: c.name as string, description: typeof c.description === "string" ? c.description : "" }));
      state.manifest.slashCommands = commands.map((c) => c.name);
      state.manifest.commandDetails = Object.fromEntries(commands.filter((c) => c.description).map((c) => [c.name, c.description]));
      return [{ type: "manifest", manifest: { ...state.manifest } }];
    }

    case "usage_update": {
      const used = num(u.used);
      const size = num(u.size);
      if (used != null) state.usedTokens = used;
      if (size != null) state.maxTokens = size;
      const cost = u.cost && typeof u.cost === "object" ? (u.cost as Record<string, unknown>) : null;
      const amount = cost ? num(cost.amount) : null;
      if (amount != null && amount > 0) state.costUsd = (state.costUsd ?? 0) + amount;
      if (used != null && size != null && size > 0) {
        const percentage = Math.max(0, Math.min(100, Math.round((used / size) * 100)));
        return [{ type: "context", percentage, totalTokens: used, maxTokens: size }];
      }
      return [];
    }

    // Confirmed-absent-of-UI-value kinds (plans, mode/config-option echoes the driver doesn't
    // separately track, session metadata) and anything a future SDK adds that we don't know about
    // yet — all ignored gracefully rather than surfacing as an error.
    case "session_info_update":
    case "current_mode_update":
    case "config_option_update":
    case "plan":
    case "plan_update":
    case "plan_removed":
    case "user_message_chunk":
    default:
      return [];
  }
}

// ── Permission-option mapping (session/request_permission ↔ our allow/deny + always) ─────────

export interface AcpPermissionOption {
  kind?: string;
  optionId?: string;
  name?: string;
}

/**
 * Pure: map our permission decision (allow/deny × once/always — the same vocabulary chat.ts's
 * `respondPermission` already uses) onto the closest PermissionOptionKind the agent actually
 * offered for THIS tool call. Exact kind match wins; falls back to any option in the right
 * allow/reject family; last resort the first offered option — an agent's permission prompt must
 * never hang because our four-way vocabulary didn't line up exactly with its option list. Returns
 * null only when the agent offered zero options (the driver then answers "cancelled").
 */
export function choosePermissionOption(options: AcpPermissionOption[], decision: { behavior: "allow" | "deny"; always?: boolean }): string | null {
  const usable = options.filter((o): o is { kind: string; optionId: string; name?: string } => typeof o.kind === "string" && typeof o.optionId === "string");
  if (!usable.length) return null;
  const wantKind = decision.behavior === "allow" ? (decision.always ? "allow_always" : "allow_once") : decision.always ? "reject_always" : "reject_once";
  const exact = usable.find((o) => o.kind === wantKind);
  if (exact) return exact.optionId;
  const family = decision.behavior === "allow" ? "allow" : "reject";
  const byFamily = usable.find((o) => o.kind.startsWith(family));
  if (byFamily) return byFamily.optionId;
  return usable[0]!.optionId;
}
