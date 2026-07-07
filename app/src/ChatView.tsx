// app/src/ChatView.tsx
// A VISUAL Claude Code. The chat tab talks to the backend's Claude Agent SDK driver over the
// /chat WebSocket (see core/src/chat.ts — the single source of truth for the wire contract).
// The backend translates the SDK's message stream into ChatFrames; here we render them as a
// live transcript that mirrors the Claude Code TUI: streamed assistant prose (markdown),
// collapsible extended-thinking, labeled tool-call chips with their results, and INLINE
// permission prompts the user approves/denies. Everything is data-driven off the frames + the
// init manifest (model / permission mode / slash commands / tools / MCP servers), so new Claude
// Code features light up with ZERO code changes here — nothing is hardcoded.
//
// Prose (both the user's messages AND the assistant's replies) renders through renderNoteBody,
// the SAME markdown pipeline notes use, so a chat reads exactly like the editor (Lora, math,
// code, wikilinks, tags). There is NO API fallback by design — if `claude` isn't installed the
// backend emits {error, code:"no-claude"} and we show a setup state.
import { createSignal, onMount, onCleanup, For, Show, createEffect, createMemo } from "solid-js";
import { createStore, produce } from "solid-js/store";
import "./ChatView.css";
import { apiBase, api, type ChatSessionInfo } from "./api";
import { renderNoteBody } from "./bases/markdown";
import { ViewBar, Crumb, ViewBarSpacer } from "./ui/ViewBar";
import { Select } from "./ui/Select";
import { TextInput } from "./ui/TextInput";
import { TextButton } from "./ui/TextButton";
import { IconButton } from "./ui/IconButton";
import { EmptyState } from "./ui/EmptyState";
import { Icon } from "./icons/Icon";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { openContextMenu } from "./nativeMenu";
import { PopoverList, type PopoverRow } from "./ui/popover/PopoverList";
import { createMenuNav } from "./ui/popover/createMenuNav";
import type { ChatFrame, ChatManifest } from "../../core/src/chat";
import { getFocusedSelection } from "./editorRegistry";
import { getEditorTabs } from "./chatContext";
import { chatPersonaName } from "./daemonIdentity";
import { publishChatTitle } from "./chatTitles";
import { pushToast } from "./Toast";

// Derive the WebSocket base from the SAME runtime-resolved backend api.ts uses. apiBase()
// honors ?api= > window.__BISMUTH_API__ > VITE_API_BASE > :4321, so the bundled app's free-port
// sidecar (injected as __BISMUTH_API__) and ?api= windows are reached too — never hardcode a host.
const wsBase = () => apiBase().replace(/^http/, "ws"); // http→ws, https→wss

// The permission modes Claude Code supports, surfaced as a header selector. These are the
// fixed protocol values (not a hardcoded feature list) — the manifest reports which one is
// active; switching sends {set_permission_mode}.
const PERMISSION_MODES: { value: string; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "plan", label: "Plan" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "bypassPermissions", label: "Bypass" },
];

// The image MIME types the Claude Agent SDK accepts as base64 image blocks. Deliberately NARROWER
// than the editor's attachment set (no svg/pdf) — those aren't valid `image` content blocks. A
// dropped/pasted file outside this set is rejected rather than sent.
const CHAT_IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
// A single screenshot rides one JSON WS frame (base64-inflated ~33%), so cap attachments to keep a
// multi-MB paste from wedging the socket. Generous enough for ordinary screenshots.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
// Combined base64 payload cap for ONE turn's attachments. Bun silently drops a WS frame over ~16 MB
// ("message too big"), which would wedge the turn in streaming() forever — so keep the total well
// under that (base64 chars ≈ wire bytes). Several 5 MB images each pass MAX_IMAGE_BYTES but together
// would blow the frame; this catches that.
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024; // ~12 MB of base64

/** A base64 image staged in the composer, before it's sent as an SDK image content block. */
interface Attachment { name: string; mediaType: string; data: string /* base64, no data: prefix */ }

/** Read an image File → base64 (stripping the `data:<mime>;base64,` prefix). Resolves null on a
 *  non-accepted MIME type or a read error, so callers can surface a friendly message. */
function readImageFile(file: File): Promise<Attachment | null> {
  if (!CHAT_IMAGE_MIME.has(file.type)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === "string" ? reader.result : "";
      const comma = res.indexOf(",");
      const data = comma >= 0 ? res.slice(comma + 1) : "";
      resolve(data ? { name: file.name || "image", mediaType: file.type, data } : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// ── Transcript model ──────────────────────────────────────────────────────────────────────
// The transcript is an ordered list of turn ITEMS. A `user` item is one sent message. An
// `assistant` item is a whole assistant turn — a list of ordered PARTS (prose / thinking / a
// tool call / an inline permission prompt) interleaved in arrival order, plus an optional
// result footer. Streaming deltas append into the current assistant turn's trailing part.

/** A run of streamed assistant prose (markdown), accumulated across `assistant-text` deltas. */
interface TextPart { kind: "text"; text: string }
/** A run of streamed extended-thinking text, accumulated across `thinking` deltas. */
interface ThinkingPart { kind: "thinking"; text: string }
/** A tool invocation chip; `result`/`isError` fill in when the matching tool-result arrives. */
interface ToolPart {
  kind: "tool";
  id: string;
  name: string;
  input: unknown;
  result: string | null;
  isError: boolean;
  pending: boolean;
}
/** An inline permission prompt; `answered` records the user's choice once they pick. `cancelled`
 *  marks a prompt orphaned by Stop (the backend denied it when the turn aborted) — rendered as a
 *  muted "Cancelled" note, NOT as a user denial, and its buttons stop being actionable. */
interface PermissionPart {
  kind: "permission";
  id: string;
  toolName: string;
  input: unknown;
  answered: null | { behavior: "allow" | "deny"; always: boolean };
  cancelled?: boolean;
}
type AssistantPart = TextPart | ThinkingPart | ToolPart | PermissionPart;

interface UserItem {
  role: "user";
  text: string;
  images?: string[]; // data: URLs, shown in the bubble
  /** Staged while a turn streams (dimmed bubble + cancel); cleared when actually dispatched. */
  queued?: boolean;
  /** Joins the bubble to its entry in the queued-turns list for cancel-before-send. */
  queueId?: string;
}
interface AssistantItem {
  role: "assistant";
  parts: AssistantPart[];
  /** Set from the turn's `result` frame — a muted footer (turns + cost). */
  footer: { numTurns: number; costUsd: number | null } | null;
}
type TurnItem = UserItem | AssistantItem;

/** One-line summary of a tool's input for the chip label (the path / command / query / url). */
function summarizeInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (typeof input !== "object") return String(input);
  const o = input as Record<string, unknown>;
  // The fields most tools key their intent on, in priority order.
  for (const k of ["command", "file_path", "path", "pattern", "query", "url", "prompt", "description", "old_string", "content"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

/** A Lucide icon name for a tool, by best-effort match on its name (falls back to a wrench).
 *  Never an exhaustive list — it's purely decorative; unknown tools just get the generic icon. */
function toolIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("bash") || n.includes("terminal")) return "SquareTerminal";
  if (n.includes("read")) return "FileText";
  if (n.includes("write") || n.includes("edit") || n.includes("notebook")) return "Pencil";
  if (n.includes("grep") || n.includes("glob") || n.includes("search") || n.includes("find")) return "Search";
  if (n.includes("web") || n.includes("fetch")) return "Globe";
  if (n.includes("task") || n.includes("agent")) return "Bot";
  if (n.includes("todo")) return "LayoutList";
  if (n.startsWith("mcp__")) return "Server";
  return "Wrench";
}

/** Truncate long tool output / JSON so a chip body stays readable (expand still shows it all
 *  up to a generous cap). */
function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Pretty-print a tool's input for the expanded chip view. */
function prettyInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

/** Compact relative time for a session's lastModified (ms epoch): "just now", "5m ago",
 *  "2h ago", "3d ago", then a short date. Used to label the history rows. */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Build a compact `<editor-context>` preamble describing what the user is looking at right now —
 *  the active file, the open editor tabs, and (only when non-empty) the current editor selection
 *  with the file it came from. Read CLIENT-SIDE from editorRegistry + chatContext at send time and
 *  prepended to the WIRE message only (never the visible transcript bubble), so Claude grounds its
 *  reply in the user's editor without the user having to paste anything. Returns "" when there's
 *  no active file and no selection — nothing worth telling Claude. */
function buildEditorContext(): string {
  const sel = getFocusedSelection();
  const { openFiles, activeFile } = getEditorTabs();
  const selection = sel?.selection ?? "";
  if (!activeFile && !selection) return "";
  const lines: string[] = ["<editor-context>"];
  if (activeFile) lines.push(`Active file: ${activeFile}`);
  if (openFiles.length) lines.push(`Open tabs: ${openFiles.map((f) => f.path).join(", ")}`);
  if (selection) {
    lines.push(`Current selection${sel?.path ? ` (from ${sel.path})` : ""}:`);
    lines.push("```", selection, "```");
  }
  lines.push("</editor-context>");
  return lines.join("\n");
}

export function ChatView(props: { chatId: string }) {
  const [transcript, setTranscript] = createStore<TurnItem[]>([]);
  const [draft, setDraft] = createSignal("");
  // Base64 images staged in the composer (dropped or pasted), sent as SDK image content blocks on
  // the next turn and cleared on send. Rendered as removable thumbnail chips above the textarea.
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [streaming, setStreaming] = createSignal(false);
  const [manifest, setManifest] = createSignal<ChatManifest | null>(null);
  // A fatal setup state (claude not installed) — replaces the transcript with guidance.
  const [setupError, setSetupError] = createSignal(false);
  // A non-fatal per-turn error to show inline below the conversation (spawn/exit/error).
  const [turnError, setTurnError] = createSignal<string | null>(null);
  // The models this login can run (`models` frame, once per session) — powers the header picker.
  const [models, setModels] = createSignal<{ value: string; label: string; description: string }[]>([]);
  // Context-window usage after each completed turn (`context` frame) — the header pill.
  const [context, setContext] = createSignal<{ percentage: number; totalTokens: number; maxTokens: number } | null>(null);
  // Turns staged while a turn is streaming (Claude Code TUI parity): dispatched one at a time
  // from the `done` frame, each with a dimmed transcript bubble the user can cancel before send.
  const [queuedTurns, setQueuedTurns] = createSignal<{ id: string; wire: string; images: Attachment[] }[]>([]);

  // The backend chat id this view's WS is bound to. Seeded from the tab's id (props.chatId), but
  // OWNED here so "New" can swap to a fresh id — a brand-new Claude Code session on the next turn —
  // without touching the tab/App.tsx. The WS pins this id so a reconnect resumes the same session.
  const [activeChatId, setActiveChatId] = createSignal(props.chatId);

  // ── Session history picker ────────────────────────────────────────────────────────────────
  // A popover listing the user's existing Claude Code sessions for the vault (terminal + in-app,
  // one unified store — see core/src/chat.ts). Picking one rehydrates the transcript from its
  // history frames, then binds this chat to resume it (new turns continue THAT session).
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [historyLoading, setHistoryLoading] = createSignal(false);
  const [sessions, setSessions] = createSignal<ChatSessionInfo[]>([]);

  // Right-click menu on a prose bubble (user or assistant) — Reply / Copy. Same <ContextMenu>
  // surface + openContextMenu wiring FileTree/DaemonList use, owned locally (no App.tsx change).
  const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);

  let ws: WebSocket | undefined;
  let list!: HTMLDivElement;
  let ta!: HTMLTextAreaElement;
  // Reconnection state — exponential backoff, cleared on successful open (mirrors Terminal.tsx).
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let disposed = false;
  // A resume requested before the socket was OPEN — flushed on the next onopen so a picked session
  // still binds even if the WS was momentarily connecting/reconnecting.
  let pendingResume: string | null = null;
  // Permission answers that couldn't be delivered (socket down mid-reconnect) — flushed on the
  // next onopen. An ARRAY: parallel tool calls can raise several concurrent prompts, and the
  // backend's pending map survives the ≤30s grace window, so a flushed answer still resolves the
  // parked canUseTool. Without this, a click during a blip shows "Allowed" while the backend
  // grace-timer silently denies it.
  let pendingPermissions: { id: string; behavior: "allow" | "deny"; always: boolean }[] = [];

  const sendJson = (msg: unknown): boolean => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  };

  // Whether the view is "following" the bottom of the transcript. True while pinned to the latest
  // content; flips to false the moment the user scrolls up to read earlier output, and back to true
  // when they return to (near) the bottom. We can't reliably read scroll position right before each
  // append — Solid reconciles the new row synchronously, so scrollHeight has already grown by the
  // time a mutation helper runs — so we track it from a scroll listener instead (mirrors Terminal).
  // A signal (not a bare var) so the render can show a "jump to latest" pill while unfollowed.
  const [following, setFollowing] = createSignal(true);
  const onListScroll = () => {
    if (!list) return;
    setFollowing(list.scrollHeight - list.scrollTop - list.clientHeight < 40);
  };

  // Keep the view pinned to the latest content, but ONLY if the user is still following the bottom.
  // If they've scrolled up to read, leave their position alone instead of yanking them down on every
  // streamed chunk. `force` (used when the user sends a message) re-pins regardless.
  const scrollToBottom = (force = false) => {
    if (force) setFollowing(true);
    if (!following()) return;
    queueMicrotask(() => {
      if (list) list.scrollTop = list.scrollHeight;
    });
  };

  // --- Transcript mutation helpers (all funnel through produce so the store updates in place) --
  const lastTurn = (m: TurnItem[]): TurnItem | undefined => m[m.length - 1];

  /** Ensure the trailing item is an assistant turn (create one if the previous item was the
   *  user's), then run `fn` against it. */
  const withAssistant = (fn: (a: AssistantItem) => void) => {
    setTranscript(
      produce((m) => {
        let last = lastTurn(m);
        if (!last || last.role !== "assistant") {
          const a: AssistantItem = { role: "assistant", parts: [], footer: null };
          m.push(a);
          last = a;
        }
        fn(last as AssistantItem);
      }),
    );
    scrollToBottom();
  };

  /** Append a prose/thinking delta into the assistant turn's trailing part of that kind, or
   *  start a new part (so an interleaved tool call splits prose into separate bubbles). */
  const appendStream = (kind: "text" | "thinking", text: string) => {
    withAssistant((a) => {
      const tail = a.parts[a.parts.length - 1];
      if (tail && tail.kind === kind) tail.text += text;
      // `{ kind, text }` widens `kind` to "text"|"thinking", which isn't assignable to the
      // discriminated AssistantPart union — the cast (sound: it IS a TextPart|ThinkingPart) keeps it
      // a one-liner without the narrowing ternary.
      else a.parts.push({ kind, text } as TextPart | ThinkingPart);
    });
  };

  const onFrame = (frame: ChatFrame) => {
    switch (frame.type) {
      case "manifest":
        setManifest(frame.manifest);
        break;
      case "user-message":
        // A replayed past user turn (history only — live user messages come from send(), not the
        // wire). Render it as a user bubble, identical to a freshly-sent one — including any
        // persisted image attachments (data: URLs), so an image-only turn doesn't vanish.
        setTranscript(produce((m) => m.push({ role: "user", text: frame.text, images: frame.images })));
        scrollToBottom();
        break;
      case "assistant-text":
        appendStream("text", frame.text);
        break;
      case "thinking":
        appendStream("thinking", frame.text);
        break;
      case "tool-use":
        withAssistant((a) => {
          a.parts.push({
            kind: "tool",
            id: frame.id,
            name: frame.name,
            input: frame.input,
            result: null,
            isError: false,
            pending: true,
          });
        });
        break;
      case "tool-result":
        setTranscript(
          produce((m) => {
            // Match the chip by id anywhere in the transcript (results can arrive out of band).
            for (const item of m) {
              if (item.role !== "assistant") continue;
              const part = item.parts.find((p) => p.kind === "tool" && p.id === frame.id) as ToolPart | undefined;
              if (part) {
                part.result = frame.content;
                part.isError = frame.isError;
                part.pending = false;
                return;
              }
            }
          }),
        );
        scrollToBottom();
        break;
      case "permission":
        withAssistant((a) => {
          a.parts.push({
            kind: "permission",
            id: frame.id,
            toolName: frame.toolName,
            input: frame.input,
            answered: null,
          });
        });
        break;
      case "result":
        if (frame.isError) setTurnError("The turn ended with an error.");
        withAssistant((a) => {
          a.footer = { numTurns: frame.numTurns, costUsd: frame.costUsd };
        });
        break;
      case "done":
        setStreaming(false);
        dispatchQueued();
        break;
      case "models":
        setModels(frame.models);
        break;
      case "title":
        // Names this TAB (props.chatId — the tab's identity, independent of the view-internal
        // id a "New chat" swaps to). App's chat-label provider reads it reactively.
        publishChatTitle(props.chatId, frame.title);
        break;
      case "context":
        setContext({ percentage: frame.percentage, totalTokens: frame.totalTokens, maxTokens: frame.maxTokens });
        break;
      case "error":
        setStreaming(false);
        if (frame.code === "no-claude") setSetupError(true);
        else {
          setTurnError(frame.message || "Something went wrong.");
          // exit/error ended the session — a queued follow-up still gets dispatched (chatSend
          // spins up a fresh session for it), matching the user's intent when they staged it.
          dispatchQueued();
        }
        break;
    }
  };

  /** Send the front queued turn, if any: un-dim its bubble and flip back to streaming. Called
   *  from the frames that end a turn (`done`, terminal `error`). If the socket is down the turn
   *  stays queued — the next turn-end (or the user's cancel) picks it up. */
  const dispatchQueued = () => {
    const q = queuedTurns();
    if (!q.length) return;
    const next = q[0];
    if (!sendJson({ type: "user", text: next.wire, ...(next.images.length ? { images: next.images.map((a) => ({ media_type: a.mediaType, data: a.data })) } : {}) })) return;
    setQueuedTurns(q.slice(1));
    setTranscript(
      produce((m) => {
        for (const item of m) {
          if (item.role === "user" && item.queueId === next.id) {
            item.queued = false;
            item.queueId = undefined;
            return;
          }
        }
      }),
    );
    setStreaming(true);
  };

  /** Cancel a still-queued turn: drop it from the queue and remove its staged bubble. */
  const cancelQueued = (queueId: string) => {
    setQueuedTurns((q) => q.filter((t) => t.id !== queueId));
    setTranscript(produce((m) => {
      const i = m.findIndex((item) => item.role === "user" && item.queueId === queueId);
      if (i >= 0) m.splice(i, 1);
    }));
  };

  const connect = () => {
    // Pin the chat id so a reconnect resumes the same backend session (continuity). Uses the
    // view-owned activeChatId (not props.chatId) so a "New" chat reconnects on its fresh id.
    // `rebind=1` marks a RECONNECT (not a first open / deliberate switch): the server then tells
    // us explicitly if the session we expect was already torn down (grace window expired), so a
    // wedged mid-turn UI clears instead of silently continuing against a fresh session.
    const rebind = reconnectAttempt > 0 ? "&rebind=1" : "";
    ws = new WebSocket(`${wsBase()}/chat?chatId=${encodeURIComponent(activeChatId())}${rebind}`);
    ws.onopen = () => {
      reconnectAttempt = 0;
      // Clear any stale "connection lost" notice — the backend rebinds this socket's sink on open
      // (server.ts), so an in-flight turn resumes streaming here. Safe: turn-level errors are set by
      // `result`/`error` frames that only arrive AFTER this point.
      setTurnError(null);
      // Flush a resume that was requested while the socket wasn't open yet.
      if (pendingResume) {
        const sid = pendingResume;
        pendingResume = null;
        sendJson({ type: "resume", sessionId: sid });
      }
      // Flush permission answers clicked while the socket was down — the backend session's
      // pending map survives the grace window, so these still resolve the parked prompts.
      if (pendingPermissions.length) {
        const queued = pendingPermissions;
        pendingPermissions = [];
        for (const p of queued) sendJson({ type: "permission_response", ...p });
      }
    };
    ws.onmessage = (ev) => {
      try {
        onFrame(JSON.parse(ev.data as string) as ChatFrame);
      } catch {
        /* ignore unparseable frames */
      }
    };
    ws.onclose = () => {
      if (disposed) return;
      // Mid-turn drop: tell the user we're reconnecting rather than leaving the composer looking
      // live but wedged in streaming() (the backend holds the session in a grace window and the
      // reconnect's open rebinds the sink, so the turn resumes; turnError clears on onopen).
      if (streaming()) setTurnError("Connection lost — reconnecting…");
      // Reconnect with exponential backoff; the backend keeps the session resumable by chatId.
      const delay = Math.min(500 * 2 ** reconnectAttempt, 8000);
      reconnectAttempt++;
      reconnectTimer = setTimeout(() => {
        if (!disposed) connect();
      }, delay);
    };
    ws.onerror = () => {
      /* surfaced via onclose → reconnect */
    };
  };

  // --- Image attachments (drop / paste) --------------------------------------
  // Stage each accepted image File as a base64 attachment, rejecting oversized / unsupported ones
  // with an inline notice. Preserves drop/paste order (sequential awaits append in turn).
  const addImageFiles = async (files: File[]) => {
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > MAX_IMAGE_BYTES) {
        setTurnError(`Image "${f.name || "attachment"}" is too large (max 10 MB).`);
        continue;
      }
      const att = await readImageFile(f);
      if (att) setAttachments((a) => [...a, att]);
      else setTurnError(`Unsupported image type ${f.type || "(unknown)"} — use PNG, JPEG, GIF, or WebP.`);
    }
  };
  // Allow the drop by cancelling the browser default the moment a file drag is over the composer —
  // this alone stops the OS file PATH from being inserted as text into the textarea.
  const onComposerDragOver = (e: DragEvent) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
  };
  const onComposerDrop = (e: DragEvent) => {
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
    if (!files.some((f) => f.type.startsWith("image/"))) return; // not an image drop — leave default text handling
    e.preventDefault();
    void addImageFiles(files);
  };
  // Mirror Editor.tsx: pull image Files out of the clipboard items (a pasted screenshot) and attach
  // them instead of letting the browser insert their path/blob text.
  const onComposerPaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (!files.length) return;
    e.preventDefault();
    void addImageFiles(files);
  };
  const removeAttachment = (i: number) => setAttachments((a) => a.filter((_, idx) => idx !== i));

  // --- Sending ---------------------------------------------------------------
  const send = () => {
    const text = draft().trim();
    const atts = attachments();
    // A message needs SOMETHING to send — text or at least one image attachment. (Streaming no
    // longer blocks: a mid-turn send STAGES the message instead — see the queued branch below.)
    if ((!text && atts.length === 0) || setupError()) return;
    // A slash command can't carry images: the CLI only expands a leading "/command" for a plain
    // STRING turn, but attachments force an array-of-blocks shape, so the command would be silently
    // sent to the model as literal text. Refuse rather than degrade it.
    if (text.startsWith("/") && atts.length > 0) {
      setTurnError("Slash commands can't include image attachments — remove the image or the command.");
      return;
    }
    // Bound the combined attachment payload: a WS frame over ~16 MB is silently dropped by Bun,
    // which would leave the turn wedged in streaming() with no reply. Reject before we commit.
    if (atts.reduce((n, a) => n + a.data.length, 0) > MAX_TOTAL_IMAGE_BYTES) {
      setTurnError("Those images are too large to send together — remove one or attach a smaller image.");
      return;
    }
    // Prepend the user's editor context (active file / open tabs / current selection) to the WIRE
    // message ONLY — the transcript bubble below stays the raw typed text, so the injected context
    // never clutters what the user sees. Empty when nothing's open/selected (see buildEditorContext).
    // Skipped for slash commands: Claude Code only recognises a `/command` at the START of the
    // message, so a preamble would silently break it.
    const preamble = text.startsWith("/") ? "" : buildEditorContext();
    const wire = preamble ? `${preamble}\n\n${text}` : text;
    // Show the sent images in the user bubble (data URLs) so an image-only turn isn't an empty bubble.
    const bubbleImages = atts.map((a) => `data:${a.mediaType};base64,${a.data}`);
    // Mid-turn: STAGE the message (Claude Code TUI parity) — a dimmed bubble with a cancel; the
    // `done` frame dispatches queued turns in order. The editor context is captured now (what
    // the user was looking at when they wrote it), not at dispatch time.
    if (streaming()) {
      const id = crypto.randomUUID();
      setQueuedTurns((q) => [...q, { id, wire, images: atts }]);
      setTranscript(produce((m) => m.push({ role: "user", text, images: bubbleImages.length ? bubbleImages : undefined, queued: true, queueId: id })));
      setDraft("");
      setAttachments([]);
      closeSlash();
      scrollToBottom(true);
      queueMicrotask(() => autoGrow());
      return;
    }
    const images = atts.map((a) => ({ media_type: a.mediaType, data: a.data }));
    // Socket not open (backend down / mid-reconnect): tell the user instead of silently dropping the
    // message. The draft is preserved (setDraft("") only runs on success) so they can retry.
    if (!sendJson({ type: "user", text: wire, ...(images.length ? { images } : {}) })) {
      setTurnError("Not connected to the backend — message not sent. Reconnecting…");
      return;
    }
    setTurnError(null);
    setTranscript(produce((m) => m.push({ role: "user", text, images: bubbleImages.length ? bubbleImages : undefined })));
    setDraft("");
    setAttachments([]);
    setStreaming(true);
    closeSlash();
    scrollToBottom(true); // sending always re-pins to the bottom
    queueMicrotask(() => autoGrow());
  };

  const stop = () => {
    // Socket not open (mid-reconnect): the stop never reaches the backend — don't lie by
    // flipping to the idle Send state while the turn keeps running server-side. Leave the
    // streaming UI; rebindSink resumes the turn's frames on reconnect and the user can retry.
    if (!sendJson({ type: "stop" })) {
      setTurnError("Not connected to the backend — couldn't stop. Reconnecting…");
      return;
    }
    setStreaming(false);
    // Stop means the whole pipeline: cancel anything still queued (never sent — bubbles come
    // out) so the interrupted turn's `done` doesn't immediately fire a staged follow-up.
    setQueuedTurns([]);
    setTranscript(
      produce((m) => {
        for (let i = m.length - 1; i >= 0; i--) {
          const item = m[i];
          if (item.role === "user" && item.queued) m.splice(i, 1);
        }
        // The aborted turn's unanswered permission prompts are now moot — the backend denied
        // them when it interrupted (abortTurn). Mark them cancelled so the cards stop offering
        // a live decision (rendered as a muted "Cancelled", not a user denial).
        for (const item of m) {
          if (item.role !== "assistant") continue;
          for (const part of item.parts) {
            if (part.kind === "permission" && !part.answered && !part.cancelled) part.cancelled = true;
          }
        }
      }),
    );
  };

  const answerPermission = (id: string, behavior: "allow" | "deny", always: boolean) => {
    // Queue the answer if the socket is down (flushed on the next onopen — the backend's pending
    // map survives the grace window); the optimistic transcript mark below stays for responsiveness.
    if (!sendJson({ type: "permission_response", id, behavior, always })) {
      pendingPermissions.push({ id, behavior, always });
    }
    setTranscript(
      produce((m) => {
        for (const item of m) {
          if (item.role !== "assistant") continue;
          const part = item.parts.find((p) => p.kind === "permission" && p.id === id) as PermissionPart | undefined;
          if (part) {
            part.answered = { behavior, always };
            return;
          }
        }
      }),
    );
  };

  const setPermissionMode = (mode: string) => {
    sendJson({ type: "set_permission_mode", mode });
    // Optimistically reflect it; the next manifest frame confirms.
    const m = manifest();
    if (m) setManifest({ ...m, permissionMode: mode });
  };

  const switchModel = (model: string) => {
    sendJson({ type: "set_model", model });
    // Optimistically reflect it; the next turn's init manifest confirms.
    const m = manifest();
    if (m) setManifest({ ...m, model });
  };

  // ── Session history / new chat ──────────────────────────────────────────────────────────────
  /** Wipe the transcript + transient turn state back to the empty state (shared by New + resume). */
  const resetTranscript = () => {
    setTranscript([]);
    setStreaming(false);
    setTurnError(null);
    setManifest(null);
    setQueuedTurns([]);
    setContext(null);
    // The conversation this tab was named after is gone — revert the tab label to the persona
    // fallback until the new/resumed session publishes its own title frame.
    publishChatTitle(props.chatId, "");
  };

  /** Tear the current WS down (clean close — backend ends that session immediately) and reconnect
   *  on `id`. Used to swap the bound chat id for "New" / resume without touching the tab. */
  const reconnectOn = (id: string) => {
    clearTimeout(reconnectTimer);
    reconnectAttempt = 0;
    // A deliberate switch invalidates anything queued for the OLD socket: a stale stashed resume
    // would otherwise be flushed by the NEW socket's onopen (silently resuming a session the user
    // just navigated away from), and queued permission answers belong to a session being closed.
    pendingResume = null;
    pendingPermissions = [];
    // Detach the OLD socket's handlers BEFORE closing it. A `close` event fires asynchronously —
    // after connect() below has already reassigned `ws` — and the onclose handler only bails on
    // `disposed`, so a deliberate switch would otherwise schedule a stray reconnect that opens a
    // SECOND socket bound to the new id (duplicate session + leaked socket, accumulating per click).
    const old = ws;
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      old.onerror = null;
      try {
        old.close(1000, "switch");
      } catch {
        /* ignore */
      }
    }
    setActiveChatId(id);
    connect();
  };

  /** "New": a fresh chat id → a brand-new Claude Code session on the next message. Clears the view. */
  const startNewChat = () => {
    setHistoryOpen(false);
    resetTranscript();
    reconnectOn(crypto.randomUUID());
    ta?.focus();
  };

  /** Open the history panel and (re)fetch the user's existing sessions for the vault. */
  const openHistory = async () => {
    const next = !historyOpen();
    setHistoryOpen(next);
    if (!next) return;
    setHistoryLoading(true);
    try {
      setSessions(await api.chatSessions());
    } catch {
      setSessions([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  /** Resume a past session: tear the current socket + its in-flight turn down FIRST (a clean
   *  reconnect — the server closeChat()s the old session, so no stray frame from the abandoned
   *  turn can land in the just-cleared transcript or raise a permission card whose answer would
   *  be silently dropped), then rehydrate from the session's history frames (fed through the SAME
   *  onFrame so they render like live turns). The new socket's onopen flushes the stashed resume,
   *  whose only frame (the init manifest) doesn't touch the transcript — so it can't interleave
   *  with the replayed history. */
  const resumeSession = async (sessionId: string) => {
    setHistoryOpen(false);
    resetTranscript();
    reconnectOn(activeChatId()); // clears any stale pendingResume/pendingPermissions itself
    pendingResume = sessionId; // set AFTER reconnectOn — the new socket's onopen flushes it
    let frames: ChatFrame[] = [];
    try {
      frames = await api.chatSessionMessages(sessionId);
    } catch {
      frames = [];
    }
    for (const frame of frames) onFrame(frame);
    scrollToBottom(true); // jump to the latest turn of the resumed conversation
    ta?.focus();
  };

  // ── Slash-command autocomplete ────────────────────────────────────────────────────────────
  // When the draft starts with "/", offer the manifest's slash_commands filtered by prefix
  // (NEVER a hardcoded list). Reuses the shared PopoverList + createMenuNav like BlockEditor.
  const [slashOpen, setSlashOpen] = createSignal(false);
  const slashQuery = createMemo(() => {
    const d = draft();
    if (!d.startsWith("/")) return null;
    // Single-token only: once a space is typed it's an argument, not a command pick.
    if (/\s/.test(d)) return null;
    return d.slice(1).toLowerCase();
  });
  const slashMatches = createMemo<string[]>(() => {
    const q = slashQuery();
    if (q === null) return [];
    const cmds = manifest()?.slashCommands ?? [];
    return cmds.filter((c) => c.toLowerCase().startsWith(q)).slice(0, 50);
  });
  const slashRows = createMemo<PopoverRow[]>(() => slashMatches().map((c) => ({ label: `/${c}`, icon: "ChevronRight" })));
  const slashNav = createMenuNav({
    count: () => slashMatches().length,
    onSelect: (i) => chooseSlash(i),
    onEscape: () => closeSlash(),
  });
  const closeSlash = () => setSlashOpen(false);
  // Open whenever there are matches to show; reset the highlight to the top on every change.
  createEffect(() => {
    const open = slashQuery() !== null && slashMatches().length > 0;
    setSlashOpen(open);
    if (open) slashNav.setActive(0);
  });
  /** Pick a command: insert it into the draft (a trailing space readies an argument). The user
   *  presses Enter again to send — inserting (not auto-sending) lets commands take arguments. */
  const chooseSlash = (i: number) => {
    const cmd = slashMatches()[i];
    if (!cmd) return;
    setDraft(`/${cmd} `);
    closeSlash();
    ta?.focus();
    queueMicrotask(() => autoGrow());
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // While the slash popover is open it owns the navigation keys.
    if (slashOpen()) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Escape") {
        slashNav.onKeyDown(e);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        chooseSlash(slashNav.active());
        return;
      }
    }
    // Escape interrupts the in-flight turn (Claude Code TUI parity). Only when the slash
    // popover isn't open — it owns Escape above — and only while actually streaming.
    if (e.key === "Escape" && streaming()) {
      e.preventDefault();
      stop();
      return;
    }
    // Enter sends (or stages, mid-turn); Shift+Enter inserts a newline (default textarea behavior).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Grow the composer textarea with its content, up to a max (then it scrolls).
  const autoGrow = () => {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };
  createEffect(() => {
    draft(); // re-run on draft change
    autoGrow();
  });

  // A rendered prose bubble can carry `[[wikilinks]]` (as `.bismuth-wikilink` anchors with a
  // `data-href`) — open them in-app via the global `bismuth-open` event, the same navigation the
  // rest of the app uses. Delegated on the list so it covers every (re-rendered) bubble.
  const onListClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement)?.closest?.("a.bismuth-wikilink") as HTMLElement | null;
    if (!a) return;
    const href = a.getAttribute("data-href");
    if (!href) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("bismuth-open", { detail: href }));
  };

  // ── Bubble right-click menu (Reply / Copy) ────────────────────────────────────────────────
  /** Copy a message's raw markdown to the clipboard — shared by the hover copy button (CopyButton)
   *  and the right-click menu's Copy item, so both surfaces do exactly the same thing. */
  const copyMessage = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => pushToast("Copied"))
      .catch(() => pushToast("Couldn't copy"));
  };

  // A quoted head this long is plenty to identify what's being replied to without the composer
  // drowning in it — long messages truncate with an ellipsis.
  const QUOTE_HEAD_MAX = 300;

  /** "Reply": quote the message as a markdown blockquote prefixed onto the composer draft, then
   *  focus the composer and bring it into view — mirrors quoting a message in any chat client. */
  const replyToMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const head = trimmed.length > QUOTE_HEAD_MAX ? `${trimmed.slice(0, QUOTE_HEAD_MAX).trimEnd()}…` : trimmed;
    const quote = head
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    setDraft((d) => `${quote}\n\n${d}`);
    queueMicrotask(() => autoGrow());
    ta?.focus();
    ta?.scrollIntoView({ block: "nearest" });
  };

  /** Right-click a prose bubble (user or assistant) → Reply / Copy. Same <ContextMenu> surface +
   *  openContextMenu wiring as everywhere else in the app (FileTree, DaemonList). */
  const onBubbleContextMenu = (e: MouseEvent, text: string) => {
    if (!text.trim()) return; // nothing to quote/copy (e.g. an image-only bubble)
    e.preventDefault();
    const items: MenuItem[] = [
      { label: "Reply", icon: "Reply", onSelect: () => replyToMessage(text) },
      { label: "Copy", icon: "Copy", onSelect: () => copyMessage(text) },
    ];
    openContextMenu(e.clientX, e.clientY, items, setMenu);
  };

  onMount(() => {
    connect();
    ta?.focus();
  });

  onCleanup(() => {
    disposed = true;
    clearTimeout(reconnectTimer);
    try {
      ws?.close(1000, "dispose");
    } catch {
      /* ignore */
    }
  });

  // ── Render ──────────────────────────────────────────────────────────────────────────────
  const mcpConnected = () => (manifest()?.mcpServers ?? []).filter((s) => /connect|ready|ok/i.test(s.status)).length;
  // The pre-first-delta waiting dots: streaming with no assistant output for the CURRENT turn
  // yet. Queued (staged, unsent) user bubbles belong to future turns — skip them, or the dots
  // would vanish/misplace the moment a follow-up is staged.
  const awaitingReply = () => {
    if (!streaming()) return false;
    for (let i = transcript.length - 1; i >= 0; i--) {
      const it = transcript[i];
      if (it.role === "user" && it.queued) continue;
      return it.role === "user";
    }
    return true;
  };
  // The chat presents AS the vault's daemon when one is enabled — its identity name replaces
  // "Chat"/"Claude" in the header, empty state, and composer (see daemonIdentity.ts).
  const persona = () => chatPersonaName() ?? "Claude";

  return (
    <div class="chat-host">
      <ViewBar>
        <Crumb icon="MessageSquare">{chatPersonaName() ?? "Chat"}</Crumb>
        {/* Model: a live picker once the session reports its supported models (set_model is
            wired end-to-end); a read-only span before that / for single-model logins. */}
        <Show
          when={models().length > 1}
          fallback={
            <Show when={manifest()?.model}>
              {(model) => <span class="chat-model" title="Active model">{model()}</span>}
            </Show>
          }
        >
          <Select
            class="chat-model-select"
            value={manifest()?.model ?? ""}
            options={models().map((m) => ({ value: m.value, label: m.label }))}
            onChange={switchModel}
          />
        </Show>
        <ViewBarSpacer />
        <Show when={manifest()}>
          {(m) => (
            <>
              <Show when={m().tools.length > 0}>
                <span class="chat-stat" title={`${m().tools.length} tools available`}>
                  <Icon value="Wrench" size={13} /> {m().tools.length}
                </span>
              </Show>
              <Show when={m().mcpServers.length > 0}>
                <span class="chat-stat" title={`${mcpConnected()}/${m().mcpServers.length} MCP servers connected`}>
                  <Icon value="Server" size={13} /> {mcpConnected()}/{m().mcpServers.length}
                </span>
              </Show>
              <Show when={context()}>
                {(c) => (
                  <span
                    class="chat-stat chat-context"
                    classList={{ warn: c().percentage >= 80 }}
                    title={`Context window: ${c().totalTokens.toLocaleString()} / ${c().maxTokens.toLocaleString()} tokens`}
                  >
                    <Icon value="Gauge" size={13} /> {Math.round(c().percentage)}%
                  </span>
                )}
              </Show>
              <Select
                class="chat-mode-select"
                value={m().permissionMode}
                options={PERMISSION_MODES}
                onChange={setPermissionMode}
              />
            </>
          )}
        </Show>
        {/* History (resume a past Claude Code session) + New (fresh session) — always available,
            even before the first turn's manifest. The history panel anchors to this wrapper. */}
        <div class="chat-history-anchor">
          <IconButton
            icon="Clock"
            label="Session history"
            variant={historyOpen() ? "selected" : "normal"}
            onClick={openHistory}
          />
          <Show when={historyOpen()}>
            <HistoryPanel />
          </Show>
        </div>
        <IconButton icon="Plus" label="New chat" onClick={startNewChat} />
      </ViewBar>

      <Show
        when={!setupError()}
        fallback={
          <div class="chat-setup">
            <div class="chat-setup-icon">
              <IconButton icon="MessageSquare" label="Chat" iconSize={28} disabled />
            </div>
            <h3>Claude Code isn't available</h3>
            <p>
              Chat runs the <code>claude</code> CLI on your machine — it isn't installed or signed
              in. Install Claude Code and sign in, then reopen this tab.
            </p>
          </div>
        }
      >
        <div class="chat-list-wrap">
        <div class="chat-list" ref={list!} onClick={onListClick} onScroll={onListScroll}>
          <Show when={transcript.length === 0}>
            <EmptyState class="chat-empty">
              Ask {persona()} anything about your vault. Run any <code>/command</code>, watch tool calls and thinking, and approve tool use inline.
            </EmptyState>
          </Show>
          <For each={transcript}>
            {(item) => (
              <Show
                when={item.role === "assistant"}
                fallback={
                  <div class="chat-msg user" classList={{ queued: !!(item as UserItem).queued }}>
                    {/* Notebook-transcript: a quiet speaker label marks the turn (no bubble fill /
                        alignment). The message renders through the SAME note markdown pipeline
                        (renderNoteBody) so it reads exactly like a note. */}
                    <div class="chat-turn-label">
                      You
                      <Show when={(item as UserItem).queued}>
                        <span class="chat-queued-note">· queued</span>
                        <IconButton
                          icon="X"
                          label="Cancel queued message"
                          iconSize={11}
                          class="chat-queued-cancel"
                          onClick={() => cancelQueued((item as UserItem).queueId!)}
                        />
                      </Show>
                    </div>
                    <Show when={(item as UserItem).text.trim()}>
                      <div
                        class="chat-bubble-wrap"
                        onContextMenu={(e) => onBubbleContextMenu(e, (item as UserItem).text)}
                      >
                        <div class="chat-bubble user" innerHTML={renderNoteBody((item as UserItem).text)} />
                        <CopyButton text={(item as UserItem).text} />
                      </div>
                    </Show>
                    <Show when={(item as UserItem).images?.length}>
                      <div class="chat-user-images">
                        <For each={(item as UserItem).images}>
                          {(src) => <img class="chat-user-image" src={src} alt="attachment" />}
                        </For>
                      </div>
                    </Show>
                  </div>
                }
              >
                <AssistantTurn item={item as AssistantItem} />
              </Show>
            )}
          </For>
          <Show when={awaitingReply()}>
            <div class="chat-msg assistant">
              <div class="chat-turn-label"><Icon value="MessageSquare" size={11} /> {persona()}</div>
              <div class="chat-thinking-dots">
                <span class="chat-dot" />
                <span class="chat-dot" />
                <span class="chat-dot" />
              </div>
            </div>
          </Show>
          <Show when={turnError()}>
            {(msg) => (
              <div class="chat-turn-error">
                <Icon value="TriangleAlert" size={13} class="chat-turn-error-icon" />
                <span>{msg()}</span>
              </div>
            )}
          </Show>
        </div>
        {/* Floating jump-back pill while the user has scrolled up off the live tail. */}
        <Show when={!following() && transcript.length > 0}>
          <button class="chat-jump-bottom" onClick={() => scrollToBottom(true)}>
            <Icon value="ArrowDown" size={13} /> Latest
          </button>
        </Show>
        </div>

        <div class="chat-composer">
          <Show when={slashOpen()}>
            <div class="chat-slash-popover" onMouseDown={(e) => e.preventDefault() /* keep textarea focus */}>
              <PopoverList
                items={slashRows()}
                active={slashNav.active()}
                onActivate={(i) => chooseSlash(i)}
                onHover={(i) => slashNav.setActive(i)}
              />
            </div>
          </Show>
          <div class="chat-composer-inner">
            {/* Column wrapper so the attachment chips stack ABOVE the textarea (the inner row is
                [this column][send button]); all layout lives in ChatView.css, no inline styles. */}
            <div class="chat-composer-main">
              <Show when={attachments().length > 0}>
                <div class="chat-attachments">
                  <For each={attachments()}>
                    {(att, i) => (
                      <div class="chat-attachment">
                        <img
                          class="chat-attachment-img"
                          src={`data:${att.mediaType};base64,${att.data}`}
                          alt={att.name}
                          title={att.name}
                        />
                        <IconButton
                          icon="X"
                          label="Remove attachment"
                          iconSize={11}
                          class="chat-attachment-remove"
                          onClick={() => removeAttachment(i())}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <TextInput
                multiline
                ref={((el: HTMLTextAreaElement) => { ta = el; }) as unknown as HTMLInputElement}
                class="chat-input"
                value={draft()}
                onInput={setDraft}
                onKeyDown={onKeyDown}
                onDragOver={onComposerDragOver}
                onDrop={onComposerDrop}
                onPaste={onComposerPaste}
                placeholder={`Message ${persona()}…  ( / for commands · drop or paste an image · Enter to send · Shift+Enter for newline )`}
              />
            </div>
            <Show
              when={streaming()}
              fallback={
                <IconButton
                  icon="Send"
                  label="Send message"
                  variant="selected"
                  onClick={send}
                  disabled={!draft().trim() && attachments().length === 0}
                />
              }
            >
              <IconButton icon="Square" label="Stop generating" danger onClick={stop} />
            </Show>
          </div>
        </div>
      </Show>
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setMenu(null)} />}
      </Show>
    </div>
  );

  // ── Session history panel ─────────────────────────────────────────────────────────────────
  // A popover under the History button listing the user's existing Claude Code sessions for the
  // vault. Each row: the session summary (one line, ellipsized) + a relative time. Picking one
  // resumes it. Reuses the shared PopoverList chrome (icon + label + detail) so it matches every
  // other menu. Dismisses on an outside click / Escape.
  function HistoryPanel() {
    let panel!: HTMLDivElement;
    const rows = createMemo<PopoverRow[]>(() =>
      sessions().map((s) => ({
        label: s.summary?.trim() || "Untitled session",
        icon: "MessageSquare",
        detail: relativeTime(s.lastModified),
      })),
    );
    const onDocPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // Ignore clicks inside the panel OR on the History button (which toggles it itself).
      if (panel?.contains(t) || (t as HTMLElement)?.closest?.(".chat-history-anchor")) return;
      setHistoryOpen(false);
    };
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHistoryOpen(false);
    };
    onMount(() => {
      document.addEventListener("pointerdown", onDocPointerDown, true);
      document.addEventListener("keydown", onDocKey, true);
    });
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onDocKey, true);
    });
    return (
      <div ref={panel!} class="chat-history-panel bismuth-popover">
        <div class="chat-history-title">Resume a conversation</div>
        <Show
          when={!historyLoading()}
          fallback={<div class="chat-history-state">Loading…</div>}
        >
          <Show
            when={sessions().length > 0}
            fallback={<div class="chat-history-state">No past conversations yet.</div>}
          >
            <div class="chat-history-scroll">
              <PopoverList
                class="chat-history-list"
                items={rows()}
                onActivate={(i) => {
                  const s = sessions()[i];
                  if (s) void resumeSession(s.sessionId);
                }}
              />
            </div>
          </Show>
        </Show>
      </div>
    );
  }

  // ── Assistant turn renderer ───────────────────────────────────────────────────────────────
  function AssistantTurn(p: { item: AssistantItem }) {
    return (
      <div class="chat-msg assistant">
        {/* Persona glyph + the daemon's name — per-turn identity without an avatar. */}
        <div class="chat-turn-label"><Icon value="MessageSquare" size={11} /> {persona()}</div>
        <div class="chat-turn">
          <For each={p.item.parts}>
            {(part) => {
              if (part.kind === "text") return <TextBubble part={part} />;
              if (part.kind === "thinking") return <ThinkingBlock part={part} />;
              if (part.kind === "tool") return <ToolChip part={part} />;
              return <PermissionCard part={part} />;
            }}
          </For>
          <Show when={p.item.footer}>
            {(f) => (
              <div class="chat-turn-footer">
                · {f().numTurns} {f().numTurns === 1 ? "turn" : "turns"}
                <Show when={f().costUsd != null}> · ${f().costUsd!.toFixed(4)}</Show>
              </div>
            )}
          </Show>
        </div>
      </div>
    );
  }

  function TextBubble(p: { part: TextPart }) {
    return (
      <Show when={p.part.text.trim()}>
        <div class="chat-bubble-wrap" onContextMenu={(e) => onBubbleContextMenu(e, p.part.text)}>
          <div class="chat-bubble assistant" innerHTML={renderNoteBody(p.part.text)} />
          <CopyButton text={p.part.text} />
        </div>
      </Show>
    );
  }

  /** Hover-revealed copy control on every prose bubble — copies the RAW markdown source
   *  (what you'd paste into a note), never the rendered HTML. */
  function CopyButton(p: { text: string }) {
    return (
      <IconButton
        icon="Copy"
        label="Copy message"
        iconSize={13}
        class="chat-copy-btn"
        onClick={() => copyMessage(p.text)}
      />
    );
  }

  function ThinkingBlock(p: { part: ThinkingPart }) {
    // Collapsed by default — a dim, muted, expandable "Thinking" section.
    const [open, setOpen] = createSignal(false);
    return (
      <div class="chat-thinking" classList={{ open: open() }}>
        <button class="chat-thinking-head" onClick={() => setOpen(!open())}>
          <Icon value={open() ? "ChevronDown" : "ChevronRight"} size={13} />
          <Icon value="Brain" size={13} />
          <span>Thinking</span>
        </button>
        <Show when={open()}>
          <pre class="chat-thinking-body">{p.part.text}</pre>
        </Show>
      </div>
    );
  }

  function ToolChip(p: { part: ToolPart }) {
    const [open, setOpen] = createSignal(false);
    const summary = () => clamp(summarizeInput(p.part.input), 120);
    return (
      <div class="chat-tool" classList={{ open: open(), error: p.part.isError }}>
        <button class="chat-tool-head" onClick={() => setOpen(!open())}>
          <Icon value={toolIcon(p.part.name)} size={14} class="chat-tool-icon" />
          <span class="chat-tool-name">{p.part.name}</span>
          <Show when={summary()}>
            <span class="chat-tool-summary">{summary()}</span>
          </Show>
          <span class="chat-tool-status">
            <Show
              when={p.part.pending}
              fallback={<Icon value={p.part.isError ? "X" : "Check"} size={13} class={p.part.isError ? "chat-tool-x" : "chat-tool-check"} />}
            >
              <span class="chat-tool-spinner" />
            </Show>
          </span>
          <Icon value={open() ? "ChevronDown" : "ChevronRight"} size={13} class="chat-tool-caret" />
        </button>
        <Show when={open()}>
          <div class="chat-tool-detail">
            <div class="chat-tool-section-label">Input</div>
            <pre class="chat-tool-pre">{prettyInput(p.part.input)}</pre>
            <Show when={p.part.result != null}>
              <div class="chat-tool-section-label">{p.part.isError ? "Error" : "Result"}</div>
              <pre class="chat-tool-pre" classList={{ "chat-tool-pre-error": p.part.isError }}>
                {clamp(p.part.result ?? "", 4000)}
              </pre>
            </Show>
          </div>
        </Show>
      </div>
    );
  }

  function PermissionCard(p: { part: PermissionPart }) {
    const summary = () => clamp(summarizeInput(p.part.input), 160);
    return (
      <div class="chat-permission" classList={{ answered: !!p.part.answered || !!p.part.cancelled }}>
        <div class="chat-permission-head">
          <Icon value="Lock" size={14} class="chat-permission-icon" />
          <span class="chat-permission-title">
            Allow <b>{p.part.toolName}</b>?
          </span>
        </div>
        <Show when={summary()}>
          <pre class="chat-permission-summary">{summary()}</pre>
        </Show>
        <Show
          when={!p.part.answered && !p.part.cancelled}
          fallback={
            <div class="chat-permission-outcome" classList={{ deny: p.part.answered?.behavior === "deny", cancelled: !p.part.answered && !!p.part.cancelled }}>
              <Icon value={p.part.answered ? (p.part.answered.behavior === "allow" ? "Check" : "X") : "Ban"} size={13} />
              {p.part.answered
                ? p.part.answered.behavior === "allow"
                  ? p.part.answered.always
                    ? "Allowed (always)"
                    : "Allowed"
                  : "Denied"
                : "Cancelled"}
            </div>
          }
        >
          <div class="chat-permission-actions">
            <TextButton variant="selected" size="sm" onClick={() => answerPermission(p.part.id, "allow", false)}>
              ALLOW
            </TextButton>
            <TextButton size="sm" onClick={() => answerPermission(p.part.id, "allow", true)}>
              ALLOW ALWAYS
            </TextButton>
            <TextButton danger size="sm" onClick={() => answerPermission(p.part.id, "deny", false)}>
              DENY
            </TextButton>
          </div>
        </Show>
      </div>
    );
  }
}
