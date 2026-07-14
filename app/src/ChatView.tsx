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
import { apiBase, api, type ChatSessionInfo, type ChatSearchHit } from "./api";
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
import type { ChatFrame, ChatManifest, ChatQuestion } from "../../core/src/chat";
import { getFocusedSelection } from "./editorRegistry";
import { getEditorTabs, addChatReference, getChatReferences, clearChatReferences } from "./chatContext";
import { buildEditorContextText } from "./chatEditorContext";
import { chatPersonaName } from "./daemonIdentity";
import { chatTitle, publishChatTitle, resolveChatHeaderTitle } from "./chatTitles";
import { rememberChatSession, recallChatSession, forgetChatSession } from "./chatSessionStore";
import { chatColor, setChatColor, resolveChatColorArg } from "./chatColors";
import { parseChatSlashCommand, CLIENT_SLASH_COMMANDS, withClientSlashCommands, computeChromeToggle } from "./chatSlashCommands";
import { chatComputerUse, setChatComputerUse } from "./chatComputerUse";
import { resolveInitialModel } from "./chatModelResolution";
import { CHAT_PROVIDER_OPTIONS, modelPriceBadge, modelStorageKeys, providerStorageKey, providerSupportsClaudeControls, sanitizeChatProvider, type ChatProviderChoice } from "./chatProvider";
import { restoreQueuedComposerState } from "./chatQueueRestore";
import { pushToast } from "./Toast";
import { lastChange } from "./serverVersion";
import { DEFAULT_PERMISSION_MODE, sanitizePermissionMode, reconcilePermissionMode } from "./chatPermissionMode";
import { DEFAULT_EFFORT_DISPLAY, effortOptionsForModel } from "./chatEffort";
import { pointInDropRect, imageMimeFromPath, type NativeDragDetail } from "./nativeDrop";
import { wikilinkFor, noteNameFromPath } from "./dnd/noteRef";
import { ChatComposer, type ComposerHandle } from "./ChatComposer";
import { classifyComposerKey } from "./chatComposerKeys";
import { HISTORY_BOTTOM, buildHistoryEntries, historyUp, historyDown, type HistoryCursor } from "./chatHistory";
import type { NoteCandidate } from "./editor/wikilink";
import type { FileCandidate } from "./editor/atMention";
import { settings } from "./settings";

// Derive the WebSocket base from the SAME runtime-resolved backend api.ts uses. apiBase()
// honors ?api= > window.__BISMUTH_API__ > VITE_API_BASE > :4321, so the bundled app's free-port
// sidecar (injected as __BISMUTH_API__) and ?api= windows are reached too — never hardcode a host.
const wsBase = () => apiBase().replace(/^http/, "ws"); // http→ws, https→wss

// The permission modes Claude Code supports, surfaced as a header selector. These are the
// fixed protocol values (not a hardcoded feature list) — the manifest reports which one is
// active; switching sends {set_permission_mode}. (DEFAULT_PERMISSION_MODE + the pure reconcile /
// sanitize rules live in ./chatPermissionMode so they're unit-tested — FEATURE #35.)
const PERMISSION_MODES: { value: string; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "plan", label: "Plan" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "bypassPermissions", label: "Bypass" },
];

// The last permission mode the user picked in ANY chat (FEATURE #35: "permissions keep resetting to
// default"). Persisted like LAST_MODEL_KEY (a transient localStorage key, not a `.settings` value)
// so the chosen mode — and the Bypass default — STICKS across turns AND new/resumed chats instead of
// snapping back. readLastMode falls back to DEFAULT_PERMISSION_MODE (Bypass) on a first run / bad value.
const LAST_MODE_KEY = "bismuth.chat.lastPermissionMode";
function readLastMode(): string {
  try {
    return sanitizePermissionMode(localStorage.getItem(LAST_MODE_KEY));
  } catch {
    return DEFAULT_PERMISSION_MODE;
  }
}
function rememberMode(mode: string) {
  try {
    localStorage.setItem(LAST_MODE_KEY, mode);
  } catch {
    /* localStorage unavailable — the in-memory signal still drives the header */
  }
}

// The header shows a model label the instant the chat opens (BUG #14) — before this session's
// manifest / `models` frames land — by remembering the last model used in THIS chat (per-chat
// localStorage key). Falls back to a global key for brand-new chats that have never had a model
// set. A transient localStorage key (like the graph's 2D/3D toggle), not a user-facing `.settings`
// value. PROVIDER-SCOPED (chatProvider.ts modelStorageKeys): claude keeps the original keys;
// opencode has its own namespace so a Claude model id can never seed an opencode run's `-m`.
function readLastModel(provider: ChatProviderChoice, chatId?: string): string {
  try {
    const keys = modelStorageKeys(provider, chatId ?? "");
    if (chatId) {
      const perChat = localStorage.getItem(keys.perChat);
      if (perChat) return perChat;
    }
    return localStorage.getItem(keys.global) ?? "";
  } catch {
    return "";
  }
}

// This chat TAB's explicit provider choice (per-tab localStorage; null = never chosen → the
// vault's `chat.provider` setting decides). Persisted like the per-chat model.
function readProviderChoice(chatId: string): ChatProviderChoice | null {
  try {
    const raw = localStorage.getItem(providerStorageKey(chatId));
    return raw === "claude" || raw === "opencode" ? raw : null;
  } catch {
    return null;
  }
}

// The last reasoning-effort level the user picked in ANY chat (FEATURE #63: "can't select effort in
// chat"). Persisted like GLOBAL_MODEL_KEY (a transient localStorage key, not a `.settings` value) so
// the chosen level STICKS across turns AND new/resumed chats — re-pushed to each new session on its
// first manifest. Empty ("") = never chosen, which leaves the model/CLI's own default untouched.
const LAST_EFFORT_KEY = "bismuth.chat.lastEffort";
function readLastEffort(): string {
  try {
    return localStorage.getItem(LAST_EFFORT_KEY) ?? "";
  } catch {
    return "";
  }
}

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

// Descriptions for slash commands with no description on the wire, so the popover row's `detail`
// still has a blurb. Two sources: "/mcp" is a TUI-only command the SDK omits from
// init.slash_commands — chat.ts answers it locally AND splices its name into the manifest
// (withLocalSlashCommands, BUG #39). `/rename`/`/color`/`/chrome` are pure CLIENT-side commands
// (chatSlashCommands.ts's CLIENT_SLASH_COMMANDS) spliced into the autocomplete list HERE, in
// slashMatches below (BUG #87 — they parsed fine but never appeared in the "/" picker, so `/chrome`
// read as "missing"). The SDK's own real commands carry no description over the wire (names only),
// so only these synthesized/client ones get a blurb. Unknown commands simply have none.
const SLASH_COMMAND_DETAILS: Record<string, string> = {
  mcp: "Show MCP server status",
  ...Object.fromEntries(CLIENT_SLASH_COMMANDS.map((c) => [c.name, c.detail])),
};

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
/** An interactive AskUserQuestion prompt: 1-4 multiple-choice questions rendered as option buttons.
 *  `answered` records the submitted answers (question text → chosen answer string) once the user picks;
 *  `cancelled` marks a prompt skipped or orphaned by Stop (rendered as a muted "Skipped", buttons
 *  inert). Only one of answered/cancelled is ever set. */
interface QuestionPart {
  kind: "question";
  id: string;
  questions: ChatQuestion[];
  answered: null | Record<string, string>;
  cancelled?: boolean;
}
type AssistantPart = TextPart | ThinkingPart | ToolPart | PermissionPart | QuestionPart;

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
  /** True when this turn answers a slash-command input (the preceding user bubble started with
   *  "/"): its prose is a locally-produced command result (e.g. `/context`'s panel), so it renders
   *  in a boxed monospace "command output" container — like the Claude Code TUI — not loose prose (#28). */
  command?: boolean;
}
/** A transient, non-error system notice (BUG #87) — confirms a client-side slash command actually
 *  DID something (e.g. `/chrome` toggling a setting with no other visible surface nearby), without
 *  claiming to be part of the conversation (no "You"/persona label, not sent to the model, not
 *  replayed from session history). Rendered as a quiet one-line notice, like .chat-turn-error but
 *  neutral instead of danger-colored. */
interface SystemItem {
  role: "system";
  text: string;
}
type TurnItem = UserItem | AssistantItem | SystemItem;

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
 *  no active file and no selection — nothing worth telling Claude.
 *
 *  `hiddenPaths` drops any file whose RESOLVED AI visibility is "hidden" (never "chat-only" —
 *  that tier IS visible to chat) before building the preamble, so a hidden note's path/content
 *  can't reach the model through this side channel. See docs/vault/visibility.md. Filtering logic
 *  itself is pure (chatEditorContext.ts, unit-tested); this just gathers the live state. */
function buildEditorContext(hiddenPaths: ReadonlySet<string>, referencedFiles: string[]): string {
  const sel = getFocusedSelection();
  const { openFiles, activeFile } = getEditorTabs();
  return buildEditorContextText({
    activeFile,
    openFiles,
    selection: sel?.selection ?? "",
    selectionPath: sel?.path,
    hiddenPaths,
    referencedFiles,
  });
}

export function ChatView(props: {
  chatId: string;
  /** The owning tab's user-set name, if any — keeps the pane header in sync with the tab chip. */
  tabName?: () => string | undefined;
  noteNames: () => NoteCandidate[];
  tagNames: () => string[];
}) {
  const [transcript, setTranscript] = createStore<TurnItem[]>([]);
  const [draft, setDraft] = createSignal("");
  // ── Prompt history (Row 84): ArrowUp/ArrowDown cycle through this chat's own sent messages, like a
  // shell or Claude Code's own composer. `historyCursor` + `historyEntries` feed the pure state
  // machine (chatHistory.ts); both live as plain mutable locals (not signals) since they're read/written
  // only from the keydown handler, never rendered. `pendingHistoryText` distinguishes a
  // history-recall's OWN doc update (which must NOT reset the cursor) from a genuine keystroke (which
  // must) — both funnel through the SAME CodeMirror `onInput` callback below. It's a value (not a bare
  // flag) so a coincidental no-op recall (recalled text same as what's already showing, so CodeMirror
  // never actually fires a change) can't leave a stale suppression stuck forever — the very next real
  // edit's differing value naturally clears it.
  let historyCursor: HistoryCursor = HISTORY_BOTTOM;
  let pendingHistoryText: string | null = null;
  // Sent (non-queued) user turns, oldest → newest, consecutive duplicates collapsed.
  const historyEntries = createMemo(() =>
    buildHistoryEntries(
      transcript.filter((it): it is UserItem => it.role === "user" && !it.queued).map((it) => it.text),
    ),
  );
  /** The composer's `onInput`: genuine typing resets history browsing back to the bottom (spec: reset
   *  "whenever the user sends or types a new edit"); a history-recall's own doc update (see
   *  `applyHistoryMove` below) passes through untouched. */
  const onComposerInput = (value: string) => {
    if (pendingHistoryText !== null && value === pendingHistoryText) pendingHistoryText = null;
    else {
      pendingHistoryText = null;
      historyCursor = HISTORY_BOTTOM;
    }
    setDraft(value);
  };
  // Base64 images staged in the composer (dropped or pasted), sent as SDK image content blocks on
  // the next turn and cleared on send. Rendered as removable thumbnail chips above the textarea.
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [streaming, setStreaming] = createSignal(false);
  const [manifest, setManifest] = createSignal<ChatManifest | null>(null);
  // The permission mode shown in the header Select. Seeded to the LAST-CHOSEN mode (persisted;
  // Bypass on a first run) so the control reflects the user's real preference the instant the chat
  // opens, before any session/manifest exists (BUG #14 + FEATURE #35). This is the display source of
  // truth: the user's picks update it (and persist), and on a session's FIRST manifest it's pushed
  // down to the session (see onFrame "manifest").
  const [permMode, setPermMode] = createSignal<string>(readLastMode());
  // A fatal setup state — WHICH provider's CLI is missing (`no-claude`/`no-opencode`), or null.
  // Replaces the transcript with provider-specific guidance + a one-click switch to the other
  // provider (card #90: gate gracefully, never crash).
  const [setupError, setSetupError] = createSignal<ChatProviderChoice | null>(null);
  // A non-fatal per-turn error to show inline below the conversation (spawn/exit/error).
  const [turnError, setTurnError] = createSignal<string | null>(null);
  // The models this login can run (`models` frame, once per session) — powers the header picker.
  // Each entry also carries the effort levels IT supports (FEATURE #63), so the Effort picker below
  // tracks the SELECTED model's real levels rather than a hardcoded list; opencode entries carry
  // `free` (cost metadata) → the picker's Free/Paid badge (card #90).
  const [models, setModels] = createSignal<{ value: string; label: string; description: string; effortLevels: string[]; free?: boolean }[]>([]);
  // The reasoning-effort level shown in the header Select (FEATURE #63). Seeded to the LAST-CHOSEN
  // level (persisted) so the control reflects the user's preference the instant the chat opens; on a
  // session's first manifest a non-empty value is pushed down (see onFrame "manifest"). "" = never
  // chosen → leave the model default alone.
  const [effort, setEffort] = createSignal<string>(readLastEffort());
  const rememberEffort = (level: string) => {
    if (!level) return;
    setEffort(level);
    try {
      localStorage.setItem(LAST_EFFORT_KEY, level);
    } catch {
      /* localStorage unavailable — the in-memory signal still drives the header */
    }
  };
  // The provider this chat runs on (card #90): this TAB's explicit choice (per-tab localStorage),
  // else the vault's `chat.provider` setting (reactive — a tab that never chose follows the
  // setting until its first session spawns, which latches the choice via rememberProvider so the
  // backend session and the header can never drift apart mid-conversation).
  const [providerChoice, setProviderChoice] = createSignal<ChatProviderChoice | null>(readProviderChoice(props.chatId));
  const provider = createMemo<ChatProviderChoice>(() => providerChoice() ?? sanitizeChatProvider(settings.chat.provider));
  const rememberProvider = (p: ChatProviderChoice) => {
    setProviderChoice(p);
    try {
      localStorage.setItem(providerStorageKey(props.chatId), p);
    } catch {
      /* localStorage unavailable — the in-memory signal still drives the header */
    }
  };
  // The last model used in THIS chat (persisted per-chat, PROVIDER-scoped — see chatProvider.ts) —
  // shown in the header as a sensible default before this session's manifest/`models` frames land,
  // so the model area is never blank (BUG #14). Falls back to the global last-model for brand-new
  // chats.
  const [lastModel, setLastModel] = createSignal(readLastModel(provider(), props.chatId));
  const rememberModel = (model: string) => {
    if (!model) return;
    setLastModel(model);
    try {
      const keys = modelStorageKeys(provider(), props.chatId);
      localStorage.setItem(keys.perChat, model);
      localStorage.setItem(keys.global, model); // global fallback for brand-new chats
    } catch {
      /* localStorage unavailable — the in-memory signal still updates the header */
    }
  };
  // Context-window usage after each completed turn (`context` frame) — the header pill.
  const [context, setContext] = createSignal<{ percentage: number; totalTokens: number; maxTokens: number } | null>(null);
  // Turns staged while a turn is streaming (Claude Code TUI parity): dispatched one at a time
  // from the `done` frame, each with a dimmed transcript bubble the user can cancel before send.
  // `text` is the raw typed text (pre-preamble) — kept alongside `wire` so Stop can restore the
  // ORIGINAL composer text (see restoreQueuedComposerState) instead of the model-bound wire message.
  const [queuedTurns, setQueuedTurns] = createSignal<{ id: string; wire: string; text: string; images: Attachment[] }[]>([]);

  // The backend chat id this view's WS is bound to. Seeded from the tab's id (props.chatId), but
  // OWNED here so "New" can swap to a fresh id — a brand-new Claude Code session on the next turn —
  // without touching the tab/App.tsx. The WS pins this id so a reconnect resumes the same session.
  const [activeChatId, setActiveChatId] = createSignal(props.chatId);

  // The pane header title reads the tab's user-set name directly via props.tabName (supplied by
  // App.tsx from the owning Tab.name), so context-menu renames and `/rename` slash commands both
  // update the in-pane title immediately and stay in sync with the tab chip.

  // Paths whose RESOLVED AI visibility is "hidden" (core/src/visibility.ts) — refreshed on mount
  // and whenever the vault changes (SSE), like the rest of the app's tree state. Best-effort/
  // eventually-consistent, not a live round trip per keystroke: buildEditorContext filters
  // against the last-known set so a hidden file's path never reaches the model via the preamble.
  const [hiddenPaths, setHiddenPaths] = createSignal<ReadonlySet<string>>(new Set());
  // Every vault FILE, powering the composer's `@file` mention switcher (Row 79a). Built from the SAME
  // tree fetch as hiddenPaths (one round trip): files only (not folders), hidden ones excluded (an
  // @-mention must never surface — or leak the content of — a chat-hidden file), mapped to the
  // wikilink-target label the mention inserts (noteNameFromPath: notes lose `.md`, other files keep
  // their extension so the reference resolves).
  const [fileCandidates, setFileCandidates] = createSignal<FileCandidate[]>([]);
  const refreshHiddenPaths = async () => {
    try {
      const entries = await api.tree();
      setHiddenPaths(new Set(entries.filter((e) => e.visibility === "hidden").map((e) => e.path)));
      setFileCandidates(
        entries
          .filter((e) => e.kind === "file" && e.visibility !== "hidden")
          .map((e) => ({ label: noteNameFromPath(e.path), path: e.path, folder: e.path.includes("/") ? e.path.split("/")[0] : undefined })),
      );
    } catch {
      // Leave the last-known set — better a stale filter than none.
    }
  };
  createEffect(() => {
    lastChange();
    refreshHiddenPaths();
  });

  // ── Session history picker ────────────────────────────────────────────────────────────────
  // A popover listing the user's existing Claude Code sessions for the vault (terminal + in-app,
  // one unified store — see core/src/chat.ts). Picking one rehydrates the transcript from its
  // history frames, then binds this chat to resume it (new turns continue THAT session).
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [historyLoading, setHistoryLoading] = createSignal(false);
  const [sessions, setSessions] = createSignal<ChatSessionInfo[]>([]);
  // Content search across past sessions (FEATURE #34): filters the SDK's OWN session data
  // server-side (title + message text — see core/src/chat.ts searchChatSessions), NOT a parallel
  // index. Empty query → the plain "resume" list; a non-empty query → matching sessions with a
  // snippet of where the text matched. Selecting a hit resumes it via the same resumeSession path.
  const [historyQuery, setHistoryQuery] = createSignal("");
  const [searchHits, setSearchHits] = createSignal<ChatSearchHit[]>([]);
  const [searchLoading, setSearchLoading] = createSignal(false);
  // Debounced content search: re-runs when the query changes while the panel is open; clears when
  // the query empties or the panel closes. Mirrors the vault find bar's typing→search cadence.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const open = historyOpen();
    const q = historyQuery().trim();
    clearTimeout(searchTimer);
    if (!open || !q) {
      setSearchHits([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimer = setTimeout(() => {
      void (async () => {
        try {
          setSearchHits(await api.chatSearch(q));
        } catch {
          setSearchHits([]);
        } finally {
          setSearchLoading(false);
        }
      })();
    }, 200);
  });
  onCleanup(() => clearTimeout(searchTimer));

  // Right-click menu on a prose bubble (user or assistant) — Reply / Copy. Same <ContextMenu>
  // surface + openContextMenu wiring FileTree/DaemonList use, owned locally (no App.tsx change).
  const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);
  // A floating "Reply" button anchored to an active text SELECTION inside a message bubble (FEATURE
  // #18): selecting part of a message and clicking it quotes JUST that text, not the whole message.
  // Positioned in viewport coords (fixed) above the selection; cleared on scroll / empty selection.
  const [selReply, setSelReply] = createSignal<{ x: number; y: number; text: string } | null>(null);

  let ws: WebSocket | undefined;
  let host: HTMLDivElement | undefined; // chat pane root — the drop hit-test target (BUG #54)
  let list!: HTMLDivElement;
  // Imperative handle onto the live-preview composer (ChatComposer) — the reply/mention/slash-pick
  // flows drive focus + scroll-into-view through it, replacing the old raw-textarea `ta` ref.
  let composer: ComposerHandle | undefined;
  const focusComposer = () => composer?.focus();
  // Reconnection state — exponential backoff, cleared on successful open (mirrors Terminal.tsx).
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let disposed = false;
  // Latched false at each new/resumed session: the app default (Bypass) is pushed to the backend on
  // the session's FIRST manifest (the SDK spawns it in the user's config mode) — see onFrame
  // "manifest". After that first turn, the manifest is trusted as the live mode so server-side
  // transitions (e.g. plan-mode exit) are reflected instead of fought (BUG #14).
  let modeEnforced = false;
  // A resume requested before the socket was OPEN — flushed on the next onopen so a picked session
  // still binds even if the WS was momentarily connecting/reconnecting.
  let pendingResume: string | null = null;
  // Permission answers that couldn't be delivered (socket down mid-reconnect) — flushed on the
  // next onopen. An ARRAY: parallel tool calls can raise several concurrent prompts, and the
  // backend's pending map survives the ≤30s grace window, so a flushed answer still resolves the
  // parked canUseTool. Without this, a click during a blip shows "Allowed" while the backend
  // grace-timer silently denies it.
  let pendingPermissions: { id: string; behavior: "allow" | "deny"; always: boolean }[] = [];
  // AskUserQuestion answers that couldn't be delivered (socket down mid-reconnect) — flushed on the
  // next onopen, exactly like pendingPermissions. The backend's parked dialog survives the grace
  // window, so a flushed answer still resolves it. `answers` null = the user skipped/cancelled.
  let pendingQuestionResponses: { id: string; answers: Record<string, string> | null }[] = [];

  const sendJson = (msg: unknown): boolean => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    // BUG #87: carry the CURRENT --chrome (browser/computer-use) choice on every message that
    // spawns or runs a turn (open/user/resume), so a /chrome or Globe-pill toggle takes effect on
    // the next turn without waiting for the async .settings reload the server would otherwise read.
    // The server reconciles it against the live session and respawns query() when it changed. Only
    // stamped when the caller didn't set it explicitly, and only for turn-driving message types.
    const m = msg as { type?: string; computerUse?: boolean };
    const out =
      m && (m.type === "open" || m.type === "user" || m.type === "resume") && m.computerUse === undefined
        ? { ...m, computerUse: chatComputerUse(props.chatId) }
        : msg;
    ws.send(JSON.stringify(out));
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
    // The floating selection-reply button is anchored to a viewport position that scrolling
    // invalidates — drop it (a fresh selection re-shows it).
    if (selReply()) setSelReply(null);
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
          // A turn answering a slash-command input (the preceding user bubble starts with "/") is a
          // command result — flag it so its prose renders as a boxed monospace panel, not prose (#28).
          const command = !!last && last.role === "user" && last.text.trim().startsWith("/");
          const a: AssistantItem = { role: "assistant", parts: [], footer: null, command };
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
      case "manifest": {
        setManifest(frame.manifest);
        // BUG #89 ("chat not saving model per session"): the old code called
        // `rememberModel(frame.manifest.model)` HERE, unconditionally, before checking what the user
        // had actually picked — clobbering the very `lastModel` signal the reapply step below reads,
        // so it always just re-sent the manifest's own default back to itself (a no-op) and the
        // user's real choice was silently discarded on every open. Fixed by resolving BEFORE any
        // rememberModel call — see chatModelResolution.ts for the extracted, unit-tested rule.
        if (!modeEnforced) {
          // First manifest of this session: the SDK spawned it in the user's OWN config mode, but
          // the header/app default is Bypass (permMode's seed) — or the user picked a mode before
          // the first turn. Push our desired mode down so the session matches the header (BUG #14).
          // Claude-only: opencode has no permission modes / effort levels — its sessions run
          // `--auto` (the same effective posture) and these controls are hidden in the header.
          modeEnforced = true;
          const claudeControls = providerSupportsClaudeControls(provider());
          if (claudeControls && frame.manifest.permissionMode !== permMode()) {
            sendJson({ type: "set_permission_mode", mode: permMode() });
          }
          // Re-apply the user's persisted reasoning-effort level (FEATURE #63) to this fresh session
          // so it sticks across new/resumed chats — the wire carries no current-effort to reconcile
          // against, so we push it once here. Only when a level was actually chosen ("" leaves the
          // model default). applyFlagSettings server-side no-ops a level the model doesn't support.
          if (claudeControls && effort()) sendJson({ type: "set_effort", effort: effort() });
          // Re-apply the user's persisted per-chat model choice (Bug #89): `lastModel()` read here,
          // BEFORE anything can clobber it, and compared against the session's own spawn default.
          const modelDecision = resolveInitialModel(lastModel(), frame.manifest.model);
          if (modelDecision && "enforce" in modelDecision) {
            sendJson({ type: "set_model", model: modelDecision.enforce });
            // setModel never triggers another manifest frame from the backend (core/src/chat.ts's
            // setModel just mutates the live session) — reflect the override optimistically, same
            // as the header's own switchModel, so displayModel() shows the REAL active model
            // immediately instead of the spawn default we just overrode.
            setManifest({ ...frame.manifest, model: modelDecision.enforce });
          } else if (modelDecision && "adopt" in modelDecision) {
            // No persisted choice for this chat yet — adopt the session's own default as the
            // fallback for next time.
            rememberModel(modelDecision.adopt);
          }
        } else {
          // Later manifests: DON'T blindly trust the reported mode (FEATURE #35). A mid-session
          // query() re-init (e.g. a visibility respawn) re-reports the SDK's SPAWN default
          // ("default"), which used to silently revert the user's Bypass/explicit choice. Reconcile:
          // adopt a genuine plan-mode EXIT, but re-enforce the desired mode on any other divergence.
          const decision = reconcilePermissionMode(permMode(), frame.manifest.permissionMode);
          if (decision && "adopt" in decision) setPermMode(decision.adopt);
          else if (decision && "enforce" in decision) sendJson({ type: "set_permission_mode", mode: decision.enforce });
          // Keep the persisted per-chat model fallback in sync with any live drift after the
          // session's first manifest (e.g. a mid-session respawn reporting a changed model).
          rememberModel(frame.manifest.model);
        }
        break;
      }
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
      case "question":
        // AskUserQuestion: render its questions as an interactive card (QuestionCard). Parking the
        // dialog server-side keeps the turn from ending, so no extra client-side gating is needed —
        // a follow-up message the user sends meanwhile is STAGED (streaming() is still true) and
        // dispatched on `done`, which only fires once the question is answered or skipped.
        withAssistant((a) => {
          a.parts.push({ kind: "question", id: frame.id, questions: frame.questions, answered: null });
        });
        break;
      case "result":
        // Don't clobber the SPECIFIC message an earlier `error` frame already set — a failed
        // opencode turn emits its error frame first, then a result with isError (exit code 0).
        if (frame.isError && !turnError()) setTurnError("The turn ended with an error.");
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
      case "session":
        // Remember the SDK session_id this TAB is currently on, keyed by props.chatId (the durable
        // tab id — NOT activeChatId, which "New"/resume swaps internally). Reopening the tab
        // (Cmd+Shift+T) resumes THIS conversation from here (see onMount). Persisted across relaunch.
        rememberChatSession(props.chatId, frame.sessionId);
        break;
      case "context":
        setContext({ percentage: frame.percentage, totalTokens: frame.totalTokens, maxTokens: frame.maxTokens });
        break;
      case "error":
        setStreaming(false);
        if (frame.code === "no-claude") setSetupError("claude");
        else if (frame.code === "no-opencode") setSetupError("opencode");
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
    if (!sendJson({ type: "user", text: next.wire, provider: provider(), ...(next.images.length ? { images: next.images.map((a) => ({ media_type: a.mediaType, data: a.data })) } : {}) })) return;
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
    const isReconnect = reconnectAttempt > 0;
    const rebind = isReconnect ? "&rebind=1" : "";
    ws = new WebSocket(`${wsBase()}/chat?chatId=${encodeURIComponent(activeChatId())}${rebind}`);
    ws.onopen = () => {
      reconnectAttempt = 0;
      // Clear any stale "connection lost" notice — the backend rebinds this socket's sink on open
      // (server.ts), so an in-flight turn resumes streaming here. Safe: turn-level errors are set by
      // `result`/`error` frames that only arrive AFTER this point.
      setTurnError(null);
      // Flush a resume that was requested while the socket wasn't open yet. Both resume and open
      // carry the provider (card #90) so the backend spawns the session on the right driver; the
      // choice is latched + persisted the moment a session actually spawns, so a later
      // `chat.provider` settings edit can't flip this tab's header away from its live backend.
      if (pendingResume) {
        const sid = pendingResume;
        pendingResume = null;
        rememberProvider(provider());
        sendJson({ type: "resume", sessionId: sid, provider: provider() });
      } else if (!isReconnect) {
        // A FIRST open of this chat id (mount, or a "New"/resume-cleared reconnectOn) with no resume
        // pending: eagerly spawn the backend session so its `init` manifest + `models` frame +
        // permission mode land in the header BEFORE the first message (BUG #14). Skipped on a
        // reconnect — the backend rebinds the live session's sink on WS open (or reports it ended),
        // so there's nothing to spawn — and skipped when resuming (the resume spawns the session).
        rememberProvider(provider());
        sendJson({ type: "open", provider: provider() });
      }
      // Flush permission answers clicked while the socket was down — the backend session's
      // pending map survives the grace window, so these still resolve the parked prompts.
      if (pendingPermissions.length) {
        const queued = pendingPermissions;
        pendingPermissions = [];
        for (const p of queued) sendJson({ type: "permission_response", ...p });
      }
      // Flush AskUserQuestion answers clicked while the socket was down (same rationale as above).
      if (pendingQuestionResponses.length) {
        const queued = pendingQuestionResponses;
        pendingQuestionResponses = [];
        for (const q of queued) sendJson({ type: "question_response", id: q.id, ...(q.answers ? { answers: q.answers } : { cancelled: true }) });
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
  // Drag-and-drop image staging works over the WHOLE chat pane (not just the textarea) across BOTH
  // transports (BUG #54 — dropping images into chats had stopped working in the packaged app):
  //  • Browser / dev build: HTML5 drag events fire — handled by the host-level onHost* handlers below.
  //  • Packaged Tauri app: the native drag-drop handler SUPPRESSES the webview's HTML5 `drop` for
  //    external OS files, so those arrive ONLY as a `bismuth-native-drag` window event (nativeDrop.ts).
  //    ChatView was never wired to that bridge (Terminal + Editor were) — the regression — so image
  //    drops silently did nothing in the real app. The window listener in onMount below handles that
  //    path, hit-testing the cursor against THIS chat's host rect (pointInDropRect) so only the pane
  //    under the cursor stages the drop.
  const [dragActive, setDragActive] = createSignal(false);

  /** Read each dropped OS image path's bytes (Tauri fs plugin — real absolute paths from the native
   *  drag-drop handler) and stage them, reusing addImageFiles' size/MIME validation + base64 by
   *  wrapping the bytes in a File. Only reached under Tauri (the event never fires in a browser), so
   *  the fs-plugin import is dynamic/desktop-only. Non-image paths (by extension) are skipped. */
  const addImagePaths = async (paths: string[]) => {
    const images = paths
      .map((p) => ({ p, mime: imageMimeFromPath(p) }))
      .filter((x): x is { p: string; mime: string } => !!x.mime);
    if (!images.length) return;
    let readFile: (p: string) => Promise<Uint8Array>;
    try {
      ({ readFile } = await import("@tauri-apps/plugin-fs"));
    } catch (e) {
      setTurnError("Couldn't read the dropped image — see console.");
      console.error("fs plugin import failed", e);
      return;
    }
    const files: File[] = [];
    for (const { p, mime } of images) {
      try {
        const bytes = await readFile(p);
        files.push(new File([bytes as BlobPart], p.split(/[\\/]/).pop() ?? "image", { type: mime }));
      } catch (e) {
        setTurnError(`Couldn't read ${p.split(/[\\/]/).pop() ?? p}.`);
        console.error("native drop read failed", e);
      }
    }
    if (files.length) await addImageFiles(files);
  };

  // Host-level HTML5 drag handlers (browser / dev build). dragover + drop BUBBLE from the textarea and
  // transcript, so attaching them to the chat host covers the whole pane — a drop anywhere stages the
  // image. preventDefault on dragover is what stops the OS path from being inserted as text.
  const onHostDragOver = (e: DragEvent) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragActive(true);
  };
  const onHostDragLeave = (e: DragEvent) => {
    // Ignore leaves into a child element — only clear when the cursor exits the host entirely.
    if (e.relatedTarget && host?.contains(e.relatedTarget as Node)) return;
    setDragActive(false);
  };
  const onHostDrop = (e: DragEvent) => {
    setDragActive(false);
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

  /** Push a quiet, non-error notice into the transcript (BUG #87 cause #2): a client-side command
   *  like `/chrome` toggles a setting with no other visible surface nearby, so the composer just
   *  clearing silently made it FEEL like nothing happened. Distinct from turnError (which is for
   *  failures) — this confirms a command actually DID something. Not sent to the backend, not part
   *  of the conversation history (a resumed/replayed session never re-shows it). */
  const pushSystemNote = (text: string) => {
    setTranscript(produce((m) => m.push({ role: "system", text })));
    scrollToBottom();
  };

  /** Toggle Claude's --chrome (browser/computer-use) capability — ONE path shared by the header
   *  Globe pill and the /chrome slash command so both behave identically (BUG #87). Persists the
   *  choice PER-CHAT (chatComputerUse — carried on every subsequent turn + across reload), and
   *  confirms in the transcript. --chrome is a spawn-fixed CLI flag, so the LIVE session picks it up
   *  by respawning on the next message: the client stamps the new value onto the next user/open/
   *  resume message (sendJson), and the server reconciles it against the running session and
   *  respawns query() with/without --chrome, resuming the same conversation (core/src/chat.ts
   *  computerUseChange + respawnSession). The re-fix moved the state off the GLOBAL setting (which
   *  leaked across chats, so a chat could open already-on and `/chrome` reported "disabled" instead
   *  of enabling) onto per-chat storage seeded from the global default. */
  const toggleComputerUse = () => {
    // Flip THIS chat's --chrome state (not the global setting — BUG #87 re-fix: the global leaked
    // across chats/sessions, so a chat could open already-on and the user's `/chrome` to "enable" it
    // flipped it OFF and reported "disabled"). computeChromeToggle keeps the new state + its note in
    // lockstep, so the message always reflects the NEW state.
    const { next, note } = computeChromeToggle(chatComputerUse(props.chatId));
    setChatComputerUse(props.chatId, next);
    pushSystemNote(note);
  };

  /** Apply a CLIENT-SIDE chat slash command (Row 75: `/rename`, `/color`, `/chrome`) intercepted in
   *  send() before the turn reaches the model. Returns true when it consumed the draft (command
   *  applied) so send() clears the composer; false when it couldn't (an unknown `/color` value),
   *  leaving the draft in place with an inline error so the user can fix it. */
  const applyLocalCommand = (cmd: ReturnType<typeof parseChatSlashCommand>): boolean => {
    if (!cmd) return false;
    if (cmd.kind === "rename") {
      // Rename THIS chat's tab via the same Tab.name override the right-click Rename sets (App owns
      // the tab tree) — persisted across reload/reopen. Empty name reverts to the auto label. The
      // pane header reads props.tabName, so it updates automatically once App applies the rename.
      window.dispatchEvent(new CustomEvent("bismuth-chat-rename", { detail: { chatId: props.chatId, name: cmd.name } }));
      setTurnError(null);
      return true;
    }
    if (cmd.kind === "chrome") {
      // Toggle --chrome (browser/computer-use) for THIS chat — not just future ones (BUG #87's real
      // gap: --chrome is spawn-fixed, so the old settings-only toggle silently did nothing for the
      // session the user typed /chrome into and the browser kept reading disabled). toggleComputerUse
      // persists the setting AND makes the live session respawn with the new flag on the next message.
      toggleComputerUse();
      setTurnError(null);
      return true;
    }
    // color: resolve the token to a swatch/hex/clear; an unknown token is reported, not applied.
    const resolved = resolveChatColorArg(cmd.arg);
    if (resolved === undefined) {
      setTurnError(`Unknown color "${cmd.arg}" — use a swatch name (e.g. blue) or a hex like #ffcc00.`);
      return false; // keep the draft so the user can correct it
    }
    setChatColor(props.chatId, resolved); // signal-backed → the pane re-tints live + persists
    setTurnError(null);
    return true;
  };

  // --- Sending ---------------------------------------------------------------
  const send = () => {
    const text = draft().trim();
    const atts = attachments();
    // A message needs SOMETHING to send — text or at least one image attachment. (Streaming no
    // longer blocks: a mid-turn send STAGES the message instead — see the queued branch below.)
    if ((!text && atts.length === 0) || setupError()) return;
    // Row 75: `/rename` / `/color` are handled CLIENT-SIDE and never sent to the model. Intercept
    // before everything else (they take no attachments, no wire message). A consumed command clears
    // the composer; an unrecognized `/color` value leaves the draft + shows an inline error.
    if (text.startsWith("/")) {
      const cmd = parseChatSlashCommand(text);
      if (cmd) {
        if (applyLocalCommand(cmd)) {
          setDraft("");
          closeSlash();
        }
        return;
      }
    }
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
    const preamble = text.startsWith("/") ? "" : buildEditorContext(hiddenPaths(), getChatReferences(props.chatId));
    const wire = preamble ? `${preamble}\n\n${text}` : text;
    // Show the sent images in the user bubble (data URLs) so an image-only turn isn't an empty bubble.
    const bubbleImages = atts.map((a) => `data:${a.mediaType};base64,${a.data}`);
    // Mid-turn: STAGE the message (Claude Code TUI parity) — a dimmed bubble with a cancel; the
    // `done` frame dispatches queued turns in order. The editor context is captured now (what
    // the user was looking at when they wrote it), not at dispatch time.
    if (streaming()) {
      const id = crypto.randomUUID();
      setQueuedTurns((q) => [...q, { id, wire, text, images: atts }]);
      setTranscript(produce((m) => m.push({ role: "user", text, images: bubbleImages.length ? bubbleImages : undefined, queued: true, queueId: id })));
      setDraft("");
      setAttachments([]);
      clearChatReferences(props.chatId); // folded into this turn's captured wire — don't ride the next
      closeSlash();
      scrollToBottom(true);
      return;
    }
    const images = atts.map((a) => ({ media_type: a.mediaType, data: a.data }));
    // Socket not open (backend down / mid-reconnect): tell the user instead of silently dropping the
    // message. The draft is preserved (setDraft("") only runs on success) so they can retry.
    if (!sendJson({ type: "user", text: wire, provider: provider(), ...(images.length ? { images } : {}) })) {
      setTurnError("Not connected to the backend — message not sent. Reconnecting…");
      return;
    }
    setTurnError(null);
    setTranscript(produce((m) => m.push({ role: "user", text, images: bubbleImages.length ? bubbleImages : undefined })));
    setDraft("");
    setAttachments([]);
    clearChatReferences(props.chatId); // conveyed in this turn's preamble — don't repeat next turn
    setStreaming(true);
    closeSlash();
    scrollToBottom(true); // sending always re-pins to the bottom
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
    // Stop means the whole pipeline: cancel anything still queued (never sent — bubbles come out)
    // so the interrupted turn's `done` doesn't immediately fire a staged follow-up. Row 83: that
    // used to just DELETE the queued text — instead, restore it into the composer (prepended above
    // whatever the user was already typing, oldest queued turn first) along with any staged image
    // attachments, so Stop never throws away what the user typed.
    const queued = queuedTurns();
    if (queued.length) {
      const restored = restoreQueuedComposerState(queued, { text: draft(), images: attachments() });
      setDraft(restored.text);
      setAttachments(restored.images);
      focusComposer();
      composer?.scrollIntoView();
    }
    setQueuedTurns([]);
    setTranscript(
      produce((m) => {
        for (let i = m.length - 1; i >= 0; i--) {
          const item = m[i];
          if (item.role === "user" && item.queued) m.splice(i, 1);
        }
        // The aborted turn's unanswered permission prompts AND AskUserQuestion prompts are now moot —
        // the backend denied/cancelled them when it interrupted (abortTurn). Mark them cancelled so the
        // cards stop offering a live decision (rendered as a muted "Cancelled"/"Skipped").
        for (const item of m) {
          if (item.role !== "assistant") continue;
          for (const part of item.parts) {
            if (part.kind === "permission" && !part.answered && !part.cancelled) part.cancelled = true;
            if (part.kind === "question" && !part.answered && !part.cancelled) part.cancelled = true;
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

  /** Answer (or skip) an AskUserQuestion prompt. `answers` maps each question's TEXT to the chosen
   *  answer string (multi-select comma-joined; free-text "Other" rides in as its own answer); null =
   *  the user skipped. Mirrors answerPermission: optimistic transcript mark + a down-socket queue that
   *  the next onopen flushes (the backend's parked dialog survives the grace window). */
  const answerQuestion = (id: string, answers: Record<string, string> | null) => {
    if (!sendJson({ type: "question_response", id, ...(answers ? { answers } : { cancelled: true }) })) {
      pendingQuestionResponses.push({ id, answers });
    }
    setTranscript(
      produce((m) => {
        for (const item of m) {
          if (item.role !== "assistant") continue;
          const part = item.parts.find((p) => p.kind === "question" && p.id === id) as QuestionPart | undefined;
          if (part) {
            if (answers) part.answered = answers;
            else part.cancelled = true;
            return;
          }
        }
      }),
    );
  };

  const setPermissionMode = (mode: string) => {
    // permMode is the header's source of truth (seeded to the last-chosen mode before any session),
    // so update it immediately — even before a session exists, the picked mode is held and later
    // pushed down on the first manifest. sendJson is a no-op server-side until the session exists.
    setPermMode(mode);
    rememberMode(mode); // persist so the choice sticks across turns AND new/resumed chats (#35)
    sendJson({ type: "set_permission_mode", mode });
  };

  const switchModel = (model: string) => {
    sendJson({ type: "set_model", model });
    rememberModel(model); // persist so the next chat shows this as its default before its manifest
    // Optimistically reflect it; the next turn's init manifest confirms.
    const m = manifest();
    if (m) setManifest({ ...m, model });
  };

  const switchEffort = (level: string) => {
    rememberEffort(level); // updates the signal + persists so the next chat defaults to it
    sendJson({ type: "set_effort", effort: level });
  };

  /** Switch this chat's PROVIDER (card #90). A conversation can't hop drivers mid-stream, so this
   *  behaves like "New chat" on the other provider: persist the choice for this tab, drop the
   *  provider-scoped last-model (a Claude id must never ride an opencode `-m` and vice versa),
   *  clear the transcript, and reconnect on a fresh chat id so the backend spawns the new driver. */
  const switchProvider = (p: string) => {
    const next = sanitizeChatProvider(p, provider());
    if (next === provider()) return;
    rememberProvider(next);
    setModels([]); // the other provider's model list is stale — the new session re-emits its own
    setLastModel(readLastModel(next, props.chatId));
    // The old provider's conversation can't be resumed by the new one — forget the tab's
    // remembered session id so a close/reopen doesn't try (and error).
    forgetChatSession(props.chatId);
    setHistoryOpen(false);
    // A missing CLI blanks the transcript with the setup screen — switching providers must clear
    // it (the whole point of a second provider when the first one isn't installed).
    setSetupError(null);
    resetTranscript();
    reconnectOn(crypto.randomUUID());
    focusComposer();
  };

  // ── Session history / new chat ──────────────────────────────────────────────────────────────
  /** Wipe the transcript + transient turn state back to the empty state (shared by New + resume). */
  const resetTranscript = () => {
    setTranscript([]);
    setStreaming(false);
    setTurnError(null);
    setManifest(null);
    // Back to the user's LAST-CHOSEN mode (persisted; Bypass on a first run) — NOT a hardcoded
    // default — so a new/resumed chat keeps the mode the user actually wants (#35). The next
    // session re-enforces it on its first manifest.
    setPermMode(readLastMode());
    // Back to the user's LAST-CHOSEN effort (persisted) too (FEATURE #63) — re-pushed to the new
    // session on its first manifest, so a new/resumed chat keeps the level the user wants.
    setEffort(readLastEffort());
    setQueuedTurns([]);
    setContext(null);
    // Drop any pending @-mention / drag references (Row 79) — they belonged to the conversation
    // being cleared, and must not leak into the new/resumed one's first turn.
    clearChatReferences(props.chatId);
    // The conversation this tab was named after is gone — revert the tab label to the persona
    // fallback until the new/resumed session publishes its own title frame.
    publishChatTitle(props.chatId, "");
  };

  /** Tear the current WS down (clean close — backend ends that session immediately) and reconnect
   *  on `id`. Used to swap the bound chat id for "New" / resume without touching the tab. */
  const reconnectOn = (id: string) => {
    clearTimeout(reconnectTimer);
    reconnectAttempt = 0;
    // A new/resumed session re-enforces the app-default permission mode on its first manifest.
    modeEnforced = false;
    // A deliberate switch invalidates anything queued for the OLD socket: a stale stashed resume
    // would otherwise be flushed by the NEW socket's onopen (silently resuming a session the user
    // just navigated away from), and queued permission answers belong to a session being closed.
    pendingResume = null;
    pendingPermissions = [];
    pendingQuestionResponses = [];
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
    focusComposer();
  };

  /** Open the history panel and (re)fetch the user's existing sessions for the vault. */
  const openHistory = async () => {
    const next = !historyOpen();
    setHistoryOpen(next);
    if (!next) return;
    setHistoryQuery(""); // fresh search each open (the effect clears hits when the query empties)
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
      frames = await api.chatSessionMessages(sessionId, provider());
    } catch {
      frames = [];
    }
    for (const frame of frames) onFrame(frame);
    scrollToBottom(true); // jump to the latest turn of the resumed conversation
    focusComposer();
  };

  // ── Slash-command autocomplete ────────────────────────────────────────────────────────────
  // When the draft starts with "/", offer the manifest's slash_commands filtered by prefix, PLUS
  // the client-side commands (rename/color/chrome — BUG #87: these are never in manifest.
  // slashCommands, since they're intercepted before a turn reaches the backend, so they used to be
  // absent from this list entirely). withClientSlashCommands appends them (deduped) even before any
  // manifest exists, so they're offered from the moment the chat opens. Reuses the shared
  // PopoverList + createMenuNav like BlockEditor.
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
    // opencode sessions have no backend slash commands (the manifest's list is empty) and no
    // --chrome capability — only the provider-agnostic client commands (/rename, /color) remain.
    const cmds = withClientSlashCommands(manifest()?.slashCommands ?? []).filter(
      (c) => providerSupportsClaudeControls(provider()) || c !== "chrome",
    );
    return cmds.filter((c) => c.toLowerCase().startsWith(q)).slice(0, 50);
  });
  const slashRows = createMemo<PopoverRow[]>(() =>
    slashMatches().map((c) => ({ label: `/${c}`, icon: "ChevronRight", detail: SLASH_COMMAND_DETAILS[c] })),
  );
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
    focusComposer();
  };

  /** Apply a prompt-history move: stash the new cursor, mark the recalled text as an expected FEEDBACK
   *  doc-change (see `onComposerInput`) so it doesn't reset the cursor it was just given, then write it
   *  into the composer. Shared by ArrowUp and ArrowDown below. */
  const applyHistoryMove = (move: { cursor: HistoryCursor; text: string }) => {
    historyCursor = move.cursor;
    pendingHistoryText = move.text;
    setDraft(move.text);
  };

  // Composer keydown, delegated from ChatComposer's CodeMirror instance. Returns TRUE when it fully
  // handled the key (CodeMirror then stops) or FALSE to let CodeMirror handle it — notably Shift+Enter,
  // which falls through to CodeMirror's plain-newline insertion, and ordinary ArrowUp/Down cursor
  // movement inside a multi-line draft. ChatComposer never calls this for keys the vault autocomplete
  // popup owns while it's open, so the [[wikilink]]/tag/emoji menu keeps its own Arrow/Enter/Escape/Tab
  // navigation. `boundary` reports whether the caret is on the composer's first/last visual line
  // (computed in ChatComposer via CodeMirror's own line-wrap-aware geometry) — see chatComposerKeys.ts.
  const onComposerKey = (e: KeyboardEvent, boundary: { atTop: boolean; atBottom: boolean }): boolean => {
    // Pure routing (chatComposerKeys.ts) decides WHAT the key means; this maps it to the effect.
    switch (classifyComposerKey(e, { slashOpen: slashOpen(), streaming: streaming(), ...boundary })) {
      case "slash-nav":
        slashNav.onKeyDown(e); // preventDefaults Arrow/Enter itself
        return true;
      case "slash-select":
        e.preventDefault();
        chooseSlash(slashNav.active());
        return true;
      case "stop":
        e.preventDefault();
        stop();
        return true;
      case "send":
        e.preventDefault();
        send();
        return true;
      case "history-up": {
        const move = historyUp(historyCursor, historyEntries(), draft());
        if (!move) return false; // already at the oldest entry (or none) — let the caret behave normally
        e.preventDefault();
        applyHistoryMove(move);
        return true;
      }
      case "history-down": {
        const move = historyDown(historyCursor, historyEntries());
        if (!move) return false; // not currently browsing history — ordinary ArrowDown
        e.preventDefault();
        applyHistoryMove(move);
        return true;
      }
      case "pass":
        return false; // Shift+Enter newline, plain typing → CodeMirror handles it
    }
  };

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
    focusComposer();
    composer?.scrollIntoView();
  };

  /** The current text selection IF it lies within `container` (a message bubble), else "". Used so
   *  Reply can quote just the highlighted span rather than the whole message (FEATURE #18). */
  const selectionWithin = (container: HTMLElement | null): string => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return "";
    const text = sel.toString().trim();
    if (!text) return "";
    if (container && !container.contains(sel.getRangeAt(0).commonAncestorContainer)) return "";
    return text;
  };

  /** Right-click a prose bubble (user or assistant) → Reply / Copy. Same <ContextMenu> surface +
   *  openContextMenu wiring as everywhere else in the app (FileTree, DaemonList). When TEXT IS
   *  SELECTED within this bubble, Reply quotes just that selection (FEATURE #18); otherwise the
   *  whole message. */
  const onBubbleContextMenu = (e: MouseEvent, text: string) => {
    if (!text.trim()) return; // nothing to quote/copy (e.g. an image-only bubble)
    e.preventDefault();
    // Reply ALWAYS quotes the WHOLE message (bug #18 follow-up): the floating "Reply" button anchored
    // above a text selection is the sole selection-reply path, so the right-click menu never offers a
    // redundant "Reply to selection". Copy still prefers a live selection, else the whole message.
    const selected = selectionWithin(e.currentTarget as HTMLElement);
    const items: MenuItem[] = [
      { label: "Reply", icon: "Reply", onSelect: () => replyToMessage(text) },
      { label: "Copy", icon: "Copy", onSelect: () => copyMessage(selected || text) },
    ];
    openContextMenu(e.clientX, e.clientY, items, setMenu);
  };

  /** On mouse-up in the transcript, if there's a non-empty text selection inside a message bubble,
   *  float a "Reply" button just above it (FEATURE #18). Deferred a microtask so the browser has
   *  finalized the selection. Clears when the selection is empty or outside a bubble. */
  const onListMouseUp = () => {
    queueMicrotask(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setSelReply(null);
        return;
      }
      const text = sel.toString().trim();
      const range = sel.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest?.(".chat-bubble");
      if (!text || !el) {
        setSelReply(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelReply({ x: rect.left + rect.width / 2, y: rect.top, text });
    });
  };

  onMount(() => {
    // Resume the conversation this TAB was last on, if we remember one — so a REOPENED chat tab
    // (Cmd+Shift+T revives the same ::chat:<id>, whose backend session was torn down on close)
    // comes back on the SAME Claude Code conversation instead of a blank new session. resumeSession
    // fetches its history over HTTP, replays it into the transcript, and binds the socket to resume
    // it. A brand-new chat (no remembered session_id) takes the plain eager open — a fresh session
    // whose manifest/models populate the header before the first message (BUG #14).
    const resumeId = recallChatSession(props.chatId);
    if (resumeId) void resumeSession(resumeId);
    else connect();
    focusComposer();
  });

  // Tauri native OS file drop onto the chat (BUG #54). Under the native drag-drop handler the webview's
  // HTML5 `drop` no longer fires for external files, so we stage the REAL image paths nativeDrop.ts
  // forwards — only when the cursor is over THIS chat's pane (pointInDropRect against the host rect, so
  // a drop routed to a backgrounded pane at (0,0) or another pane's area is ignored). No-op in the
  // browser (the event never fires there; the host-level HTML5 handlers serve that build).
  onMount(() => {
    const onNativeDrag = (e: Event) => {
      const d = (e as CustomEvent<NativeDragDetail>).detail;
      if (!d || !host) return;
      const inside = pointInDropRect(host.getBoundingClientRect(), d.x, d.y);
      if (d.type === "drop") {
        setDragActive(false);
        if (!inside || d.paths.length === 0) return;
        void addImagePaths(d.paths);
      } else if (d.type === "leave") {
        setDragActive(false);
      } else {
        // enter / over: show the drop affordance only while the cursor is over this chat pane.
        setDragActive(inside);
      }
    };
    window.addEventListener("bismuth-native-drag", onNativeDrag);
    onCleanup(() => window.removeEventListener("bismuth-native-drag", onNativeDrag));
  });

  // Drop-to-mention (Row 74a): App resolves a note dragged onto THIS chat's pane (from the sidebar
  // or a note tab) and dispatches `bismuth-chat-mention`. Append a `[[wikilink]]` reference to the
  // composer draft so the note is named in the next message — the wire preamble (buildEditorContext)
  // + wikilink resolution let the assistant pull it in. Scoped to this chat by id.
  onMount(() => {
    const onMention = (e: Event) => {
      const d = (e as CustomEvent<{ chatId?: string; path?: string }>).detail;
      if (!d || d.chatId !== props.chatId || !d.path) return;
      const ref = wikilinkFor(d.path);
      setDraft((cur) => (cur && !cur.endsWith(" ") && cur.length ? `${cur} ${ref} ` : `${cur}${ref} `));
      // Wire the dragged file into this chat's context (Row 79a) so its content reaches the model —
      // the same registration the `@file` mention makes, just via drag instead of the picker.
      addChatReference(props.chatId, d.path);
      focusComposer();
    };
    window.addEventListener("bismuth-chat-mention", onMention);
    onCleanup(() => window.removeEventListener("bismuth-chat-mention", onMention));
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
  // The model label the header shows: this session's manifest model once it arrives, else the
  // last-used model (persisted). Empty only on a brand-new install with no prior chat — rendered as
  // a neutral "Default model" placeholder — so the model area is never blank before the first turn.
  const displayModel = () => manifest()?.model || lastModel();
  // The effort levels the CURRENTLY-displayed model supports (from the `models` frame). The header's
  // Effort picker offers exactly these — never a hardcoded list — and hides when the model exposes
  // none / the frame hasn't landed. (FEATURE #63.) Before the first manifest NAMES a model,
  // displayModel() is empty, so key off the login's default (first-listed) model instead — so the
  // picker is usable the instant the chat opens (like the model picker), then refines once the
  // manifest reports the real active model.
  const effortOptions = createMemo(() => {
    const ms = models();
    const cur = displayModel();
    const target = ms.some((m) => m.value === cur) ? cur : ms[0]?.value ?? "";
    return effortOptionsForModel(target, ms);
  });
  // The value shown in the Effort Select: the user's chosen level if the current model supports it,
  // else the SDK default ("high") when available, else the first supported level — so the control
  // always reflects a REAL option rather than a stale/blank value when the model changes.
  const effortDisplay = () => {
    const opts = effortOptions();
    const cur = effort();
    if (cur && opts.some((o) => o.value === cur)) return cur;
    if (opts.some((o) => o.value === DEFAULT_EFFORT_DISPLAY)) return DEFAULT_EFFORT_DISPLAY;
    return opts[0]?.value ?? "";
  };
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
  // "Chat"/"Claude" in the header, empty state, and composer (see daemonIdentity.ts). An opencode
  // session isn't Claude — name it honestly (the daemon persona still wins when enabled).
  const persona = () => chatPersonaName() ?? (provider() === "opencode" ? "opencode" : "Claude");
  // The title shown in the pane's toolbar header (Row 75). Same precedence the TAB uses — the
  // user-set tab name wins, else this session's backend title (chatTitle, published from `title`
  // frames), else the daemon persona / "Chat". Reactive, so a rename or a new session summary
  // updates the header in place — and it sits over the color-tinted pane like the rest of the bar.
  const headerTitle = () => resolveChatHeaderTitle(props.tabName?.(), chatTitle(props.chatId), chatPersonaName() ?? "Chat");

  return (
    <div
      class="chat-host"
      ref={host}
      classList={{ "chat-drop-active": dragActive() }}
      // Per-chat pane tint (FEATURE #75): wash the chosen color into the pane background so the WHOLE
      // chat surface reads as that color — the header, transcript, and composer padding are all
      // transparent, so they paint over THIS host background — while --fg text stays legible. We use
      // srgb mixing for predictable hue fidelity (oklch shifted pinks toward orange), and expose the
      // tint as the local --chat-tint CSS variable so descendant surfaces can blend against it
      // instead of floating as opaque rectangles. Reactive: picking a color in the tab's Color menu
      // re-tints live.
      data-chat-tint={chatColor(props.chatId)}
      style={chatColor(props.chatId) ? {
        background: `color-mix(in srgb, ${chatColor(props.chatId)} 50%, var(--bg))`,
        "--chat-tint": chatColor(props.chatId),
      } : undefined}
      onDragOver={onHostDragOver}
      onDragLeave={onHostDragLeave}
      onDrop={onHostDrop}
    >
      <ViewBar>
        <Crumb icon="MessageSquare">{headerTitle()}</Crumb>
        {/* Provider (card #90): which CLI drives this chat — Claude Code or opencode. Persisted
            per tab (like the model); switching starts a FRESH session on the other driver (a
            conversation can't hop providers), so it acts like "New chat" on the new provider. */}
        <Select
          class="chat-provider-select"
          value={provider()}
          options={CHAT_PROVIDER_OPTIONS}
          onChange={switchProvider}
        />
        {/* Model: a LIVE, interactive picker as soon as the session reports its supported models —
            which the backend now emits EAGERLY on session spawn (core/src/chat.ts emitSupportedModels),
            so the picker is populated and switchable the instant the chat opens, BEFORE the first
            message (set_model is wired end-to-end and works pre-turn). Its value is the best-known
            model — this session's manifest model, else the last-used one (persisted) — so switching
            pre-send is reflected via rememberModel→displayModel. Before the models frame lands (or for
            single-model logins) a read-only best-known label. Placeholder covers the brand-new install
            with no prior chat, where no active model is known yet until the user picks one. */}
        <Show
          when={models().length > 1}
          fallback={
            <span class="chat-model" title="Active model">{displayModel() || "Default model"}</span>
          }
        >
          <Select
            class="chat-model-select"
            value={displayModel()}
            placeholder="Default model"
            options={models().map((m) => ({ value: m.value, label: m.label, detail: modelPriceBadge(m.free) }))}
            onChange={switchModel}
          />
        </Show>
        {/* Effort: a LIVE picker of the SELECTED model's reasoning-effort levels (FEATURE #63),
            straight from the `models` frame — never a hardcoded list. Hidden when the model exposes
            no effort levels (or the frame hasn't landed). Changes send {set_effort} and persist so
            the chosen level sticks across turns and new/resumed chats. */}
        <Show when={effortOptions().length > 1}>
          <Select
            class="chat-effort-select"
            value={effortDisplay()}
            placeholder="Effort"
            options={effortOptions()}
            onChange={switchEffort}
          />
        </Show>
        <ViewBarSpacer />
        {/* Tools / MCP / context stats: counts that only mean something once the manifest reports
            them, so these stay gated on it (nothing sensible to show before the first turn). */}
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
            </>
          )}
        </Show>
        {/* Claude-specific controls (card #90 graceful degradation): permission modes, --chrome,
            and the Claude Code session-history picker have no opencode counterpart (`opencode run`
            is non-interactive + a separate session store) — hidden rather than broken. The Effort
            picker above hides itself (opencode models carry no effortLevels). */}
        <Show when={providerSupportsClaudeControls(provider())}>
          {/* Browser/computer-use (--chrome): same toggle as the /chrome slash command
              (toggleComputerUse) — persists the setting AND retargets the LIVE session, which picks
              the flag up on the next message via a respawn that resumes this conversation (BUG #87). */}
          <IconButton
            icon="Globe"
            label={chatComputerUse(props.chatId) ? "Browser (--chrome) on" : "Browser (--chrome) off"}
            title={chatComputerUse(props.chatId) ? "--chrome enabled — click to disable (applies from your next message)" : "Enable --chrome browser/computer-use (applies from your next message)"}
            variant={chatComputerUse(props.chatId) ? "selected" : "normal"}
            onClick={toggleComputerUse}
          />
          {/* Permission mode: rendered from the START (not gated on the manifest) so the header is
              populated the instant the chat opens (BUG #14). Seeded to the app default (Bypass) and
              updated live — the user's picks and each manifest flow through permMode(). */}
          <Select
            class="chat-mode-select"
            value={permMode()}
            options={PERMISSION_MODES}
            onChange={setPermissionMode}
          />
          {/* History (resume a past Claude Code session) — always available, even before the first
              turn's manifest. The history panel anchors to this wrapper. */}
          <div class="chat-history-anchor">
            <IconButton
              icon="MessagesSquare"
              label="Past conversations"
              variant={historyOpen() ? "selected" : "normal"}
              onClick={openHistory}
            />
            <Show when={historyOpen()}>
              <HistoryPanel />
            </Show>
          </div>
        </Show>
        <IconButton icon="Plus" label="New chat" onClick={startNewChat} />
      </ViewBar>

      <Show
        when={!setupError()}
        fallback={
          <div class="chat-setup">
            <div class="chat-setup-icon">
              <IconButton icon="MessageSquare" label="Chat" iconSize={28} disabled />
            </div>
            {/* Provider-specific guidance (card #90): name the missing CLI, how to get it, and a
                one-click switch to the OTHER provider — gate gracefully, never a dead end. */}
            <Show
              when={setupError() === "opencode"}
              fallback={
                <>
                  <h3>Claude Code isn't available</h3>
                  <p>
                    This chat runs the <code>claude</code> CLI on your machine — it isn't installed
                    or signed in. Install Claude Code and sign in, then reopen this tab.
                  </p>
                </>
              }
            >
              <h3>opencode isn't available</h3>
              <p>
                This chat is set to the opencode provider, but the <code>opencode</code> CLI wasn't
                found on your machine. Install it from opencode.ai (e.g.{" "}
                <code>brew install sst/tap/opencode</code>), then reopen this tab.
              </p>
            </Show>
            <TextButton onClick={() => switchProvider(setupError() === "opencode" ? "claude" : "opencode")}>
              {setupError() === "opencode" ? "USE CLAUDE CODE INSTEAD" : "USE OPENCODE INSTEAD"}
            </TextButton>
          </div>
        }
      >
        <div class="chat-list-wrap">
        <div class="chat-list" ref={list!} onClick={onListClick} onScroll={onListScroll} onMouseUp={onListMouseUp}>
          <Show when={transcript.length === 0}>
            <EmptyState class="chat-empty">
              Ask {persona()} anything about your vault. Run any <code>/command</code>, watch tool calls and thinking, and approve tool use inline.
            </EmptyState>
          </Show>
          <For each={transcript}>
            {(item) => (
              <Show
                when={item.role === "system"}
                fallback={
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
                }
              >
                {/* A quiet, non-error system notice (BUG #87): confirms a client-side slash command
                    like `/chrome` actually did something, without pretending to be part of the
                    conversation (no speaker label, never replayed from session history). */}
                <div class="chat-system-note">
                  <Icon value="Info" size={13} />
                  <span>{(item as SystemItem).text}</span>
                </div>
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
              {/* Live-preview composer (Row 77): a single-purpose CodeMirror instance running the SAME
                  markdown/live-preview/autocomplete stack as the note editor, so **bold**, lists,
                  `code`, ```fences``` and [[wikilinks]] render as-you-type. Still a plain text input —
                  Enter sends, Shift+Enter newlines (onComposerKey), paste stages images, and the value
                  round-trips as raw markdown SOURCE through the same draft() signal. */}
              <ChatComposer
                value={draft}
                onInput={onComposerInput}
                onKeyDown={onComposerKey}
                onPaste={onComposerPaste}
                onReady={(h) => { composer = h; }}
                getNotes={props.noteNames}
                getTags={props.tagNames}
                getFiles={fileCandidates}
                onFileMention={(p) => addChatReference(props.chatId, p)}
                placeholder={() => `Message ${persona()}…  ( / for commands · @ to reference a file · drop or paste an image · Enter to send · Shift+Enter for newline )`}
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
      {/* Floating "Reply" on an active text selection inside a bubble (FEATURE #18). onMouseDown +
          preventDefault keeps the selection alive so replyToMessage quotes it before it collapses. */}
      <Show when={selReply()}>
        {(s) => (
          <button
            class="chat-sel-reply"
            style={{ left: `${s().x}px`, top: `${s().y}px` }}
            onMouseDown={(e) => {
              e.preventDefault();
              replyToMessage(s().text);
              window.getSelection()?.removeAllRanges();
              setSelReply(null);
            }}
          >
            <Icon value="Reply" size={13} /> Reply
          </button>
        )}
      </Show>
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setMenu(null)} />}
      </Show>
    </div>
  );

  // ── Session history panel ─────────────────────────────────────────────────────────────────
  // A popover under the History button listing the user's existing Claude Code sessions for the
  // vault. A search box at the top filters those sessions by CONTENT (title + message text — served
  // by /chat/search, which filters the SDK's own session data; FEATURE #34): empty query → the plain
  // "resume" list (session summary + relative time), a non-empty query → matching sessions each with
  // a snippet of where it matched. Picking either resumes it. Dismisses on an outside click / Escape.
  function HistoryPanel() {
    let panel!: HTMLDivElement;
    const rows = createMemo<PopoverRow[]>(() =>
      sessions().map((s) => ({
        label: s.summary?.trim() || "Untitled session",
        icon: "MessageSquare",
        detail: relativeTime(s.lastModified),
      })),
    );
    const searching = () => historyQuery().trim().length > 0;
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
        {/* Content search across past conversations (FEATURE #34). */}
        <div class="chat-history-search">
          <Icon value="Search" size={13} class="chat-history-search-icon" />
          <TextInput
            class="chat-history-search-input"
            value={historyQuery()}
            onInput={setHistoryQuery}
            placeholder="Search conversations…"
            autofocus
          />
        </div>
        <Show
          when={searching()}
          fallback={
            <>
              <div class="chat-history-title">Resume a conversation</div>
              <Show when={!historyLoading()} fallback={<div class="chat-history-state">Loading…</div>}>
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
            </>
          }
        >
          {/* Search results: each hit shows the session title + when, and a snippet of the match. */}
          <Show when={!searchLoading()} fallback={<div class="chat-history-state">Searching…</div>}>
            <Show
              when={searchHits().length > 0}
              fallback={<div class="chat-history-state">No conversations match that search.</div>}
            >
              <div class="chat-history-scroll">
                <div class="chat-history-hits">
                  <For each={searchHits()}>
                    {(hit) => (
                      <button class="chat-history-hit" onClick={() => void resumeSession(hit.sessionId)}>
                        <div class="chat-history-hit-head">
                          <Icon value="MessageSquare" size={13} class="chat-history-hit-icon" />
                          <span class="chat-history-hit-title">{hit.summary?.trim() || "Untitled session"}</span>
                          <span class="chat-history-hit-time">{relativeTime(hit.lastModified)}</span>
                        </div>
                        <div class="chat-history-hit-snippet">{hit.snippet}</div>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
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
              if (part.kind === "text") return <TextBubble part={part} command={p.item.command} />;
              if (part.kind === "thinking") return <ThinkingBlock part={part} />;
              if (part.kind === "tool") return <ToolChip part={part} />;
              if (part.kind === "question") return <QuestionCard part={part} />;
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

  function TextBubble(p: { part: TextPart; command?: boolean }) {
    return (
      <Show when={p.part.text.trim()}>
        <div class="chat-bubble-wrap" onContextMenu={(e) => onBubbleContextMenu(e, p.part.text)}>
          {/* Slash-command result (#28): a boxed "command output" panel — like the Claude Code TUI's
              /context view. The BODY renders through the SAME markdown pipeline as ordinary assistant
              prose (renderNoteBody → sanitized HTML on .chat-bubble), so `##` headings, `**bold**`,
              code fences, and `| … |` pipe tables display FORMATTED — not as literal raw text. Only
              the subtle boxed container + "Command output" label frame it; wide tables scroll inside. */}
          <Show
            when={p.command}
            fallback={<div class="chat-bubble assistant" innerHTML={renderNoteBody(p.part.text)} />}
          >
            <div class="chat-command-output">
              <div class="chat-command-output-head">
                <Icon value="SquareTerminal" size={12} /> Command output
              </div>
              <div class="chat-bubble assistant chat-command-output-body" innerHTML={renderNoteBody(p.part.text)} />
            </div>
          </Show>
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

  /** Interactive AskUserQuestion card: renders each question's options as clickable buttons.
   *  Single-select + a single question submits on click (Claude-TUI feel); multi-select or several
   *  questions stage selections and submit together. Every question also offers a free-text "Other"
   *  (the tool provides that affordance automatically). Skipping sends a cancel. */
  function QuestionCard(p: { part: QuestionPart }) {
    const questions = p.part.questions;
    // Per-question selected option labels + free-text "Other" input, by question index.
    const [sel, setSel] = createStore<{ picks: string[][]; other: string[] }>({
      picks: questions.map(() => []),
      other: questions.map(() => ""),
    });
    const done = () => !!p.part.answered || !!p.part.cancelled;
    const isPicked = (qi: number, label: string) => sel.picks[qi].includes(label);
    const answeredFor = (qi: number) => sel.picks[qi].length > 0 || sel.other[qi].trim().length > 0;
    const allAnswered = () => questions.every((_, qi) => answeredFor(qi));
    // A lone single-select question submits the instant an option is clicked (no Submit needed) —
    // but only while the user hasn't started typing an "Other" answer, which would be lost.
    const immediate = (qi: number) => questions.length === 1 && !questions[qi].multiSelect && !sel.other[qi].trim();

    const buildAnswers = (): Record<string, string> => {
      const answers: Record<string, string> = {};
      questions.forEach((q, qi) => {
        const parts = [...sel.picks[qi]];
        const o = sel.other[qi].trim();
        if (o) parts.push(o);
        answers[q.question] = parts.join(", "); // multi-select answers are comma-joined
      });
      return answers;
    };
    const submit = () => {
      if (done() || !allAnswered()) return;
      answerQuestion(p.part.id, buildAnswers());
    };
    const onOption = (qi: number, label: string) => {
      if (done()) return;
      if (immediate(qi)) {
        answerQuestion(p.part.id, { [questions[qi].question]: label });
        return;
      }
      setSel("picks", qi, (cur) => {
        if (questions[qi].multiSelect) return cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label];
        return cur.includes(label) ? [] : [label]; // single-select: clicking again clears it
      });
    };

    return (
      <div class="chat-question" classList={{ answered: done() }}>
        <div class="chat-question-head">
          <Icon value="ListChecks" size={14} class="chat-question-icon" />
          <span class="chat-question-title">{questions.length > 1 ? `${questions.length} questions` : "Question"}</span>
        </div>
        <For each={questions}>
          {(q, qi) => (
            <div class="chat-question-block">
              <div class="chat-question-prompt">
                <Show when={q.header}>
                  <span class="chat-question-chip">{q.header}</span>
                </Show>
                <span class="chat-question-text">{q.question}</span>
                <Show when={q.multiSelect}>
                  <span class="chat-question-multi">select all that apply</span>
                </Show>
              </div>
              <div class="chat-question-options">
                <For each={q.options}>
                  {(opt) => (
                    <button
                      type="button"
                      class="chat-question-option"
                      classList={{ picked: isPicked(qi(), opt.label) }}
                      disabled={done()}
                      onClick={() => onOption(qi(), opt.label)}
                    >
                      <span class="chat-question-option-main">
                        <Show when={q.multiSelect}>
                          <Icon value={isPicked(qi(), opt.label) ? "SquareCheck" : "Square"} size={13} class="chat-question-check" />
                        </Show>
                        <span class="chat-question-option-label">{opt.label}</span>
                      </span>
                      <Show when={opt.description}>
                        <span class="chat-question-option-desc">{opt.description}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
              <Show when={!done()}>
                <input
                  type="text"
                  class="chat-question-other"
                  placeholder="Other… (type a custom answer)"
                  value={sel.other[qi()]}
                  onInput={(e) => setSel("other", qi(), e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              </Show>
            </div>
          )}
        </For>
        <Show
          when={!done()}
          fallback={
            <div class="chat-question-outcome" classList={{ cancelled: !p.part.answered }}>
              <Show
                when={p.part.answered}
                fallback={
                  <>
                    <Icon value="Ban" size={13} /> Skipped
                  </>
                }
              >
                {(ans) => (
                  <For each={questions}>
                    {(q) => (
                      <Show when={ans()[q.question]}>
                        <div class="chat-question-answer">
                          <Icon value="Check" size={13} />
                          <Show when={q.header}>
                            <span class="chat-question-chip">{q.header}</span>
                          </Show>
                          <span>{ans()[q.question]}</span>
                        </div>
                      </Show>
                    )}
                  </For>
                )}
              </Show>
            </div>
          }
        >
          <div class="chat-question-actions">
            <TextButton variant="selected" size="sm" disabled={!allAnswered()} onClick={submit}>
              SUBMIT
            </TextButton>
            <TextButton size="sm" onClick={() => answerQuestion(p.part.id, null)}>
              SKIP
            </TextButton>
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
