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
import { Icon } from "./icons/Icon";
import { PopoverList, type PopoverRow } from "./ui/popover/PopoverList";
import { createMenuNav } from "./ui/popover/createMenuNav";
import type { ChatFrame, ChatManifest } from "../../core/src/chat";

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
/** An inline permission prompt; `answered` records the user's choice once they pick. */
interface PermissionPart {
  kind: "permission";
  id: string;
  toolName: string;
  input: unknown;
  answered: null | { behavior: "allow" | "deny"; always: boolean };
}
type AssistantPart = TextPart | ThinkingPart | ToolPart | PermissionPart;

interface UserItem { role: "user"; text: string }
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

export function ChatView(props: { chatId: string }) {
  const [transcript, setTranscript] = createStore<TurnItem[]>([]);
  const [draft, setDraft] = createSignal("");
  const [streaming, setStreaming] = createSignal(false);
  const [manifest, setManifest] = createSignal<ChatManifest | null>(null);
  // A fatal setup state (claude not installed) — replaces the transcript with guidance.
  const [setupError, setSetupError] = createSignal(false);
  // A non-fatal per-turn error to show inline below the conversation (spawn/exit/error).
  const [turnError, setTurnError] = createSignal<string | null>(null);

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
  let following = true;
  const onListScroll = () => {
    if (!list) return;
    following = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  };

  // Keep the view pinned to the latest content, but ONLY if the user is still following the bottom.
  // If they've scrolled up to read, leave their position alone instead of yanking them down on every
  // streamed chunk. `force` (used when the user sends a message) re-pins regardless.
  const scrollToBottom = (force = false) => {
    if (force) following = true;
    if (!following) return;
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
        // wire). Render it as a user bubble, identical to a freshly-sent one.
        setTranscript(produce((m) => m.push({ role: "user", text: frame.text })));
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
        break;
      case "error":
        setStreaming(false);
        if (frame.code === "no-claude") setSetupError(true);
        else setTurnError(frame.message || "Something went wrong.");
        break;
    }
  };

  const connect = () => {
    // Pin the chat id so a reconnect resumes the same backend session (continuity). Uses the
    // view-owned activeChatId (not props.chatId) so a "New" chat reconnects on its fresh id.
    ws = new WebSocket(`${wsBase()}/chat?chatId=${encodeURIComponent(activeChatId())}`);
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

  // --- Sending ---------------------------------------------------------------
  const send = () => {
    const text = draft().trim();
    if (!text || streaming() || setupError()) return;
    // Socket not open (backend down / mid-reconnect): tell the user instead of silently dropping the
    // message. The draft is preserved (setDraft("") only runs on success) so they can retry.
    if (!sendJson({ type: "user", text })) {
      setTurnError("Not connected to the backend — message not sent. Reconnecting…");
      return;
    }
    setTurnError(null);
    setTranscript(produce((m) => m.push({ role: "user", text })));
    setDraft("");
    setStreaming(true);
    closeSlash();
    scrollToBottom(true); // sending always re-pins to the bottom
    queueMicrotask(() => autoGrow());
  };

  const stop = () => {
    sendJson({ type: "stop" });
    setStreaming(false);
  };

  const answerPermission = (id: string, behavior: "allow" | "deny", always: boolean) => {
    sendJson({ type: "permission_response", id, behavior, always });
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

  // ── Session history / new chat ──────────────────────────────────────────────────────────────
  /** Wipe the transcript + transient turn state back to the empty state (shared by New + resume). */
  const resetTranscript = () => {
    setTranscript([]);
    setStreaming(false);
    setTurnError(null);
    setManifest(null);
  };

  /** Tear the current WS down (clean close — backend ends that session immediately) and reconnect
   *  on `id`. Used to swap the bound chat id for "New" / resume without touching the tab. */
  const reconnectOn = (id: string) => {
    clearTimeout(reconnectTimer);
    reconnectAttempt = 0;
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

  /** Resume a past session: clear the transcript, rehydrate it from the session's history frames
   *  (fed through the SAME onFrame so they render like live turns), then bind this chat to resume
   *  it over the WS so the next message continues THAT conversation. */
  const resumeSession = async (sessionId: string) => {
    setHistoryOpen(false);
    resetTranscript();
    // Rehydrate from history BEFORE the resume binds — the replayed frames render the past turns;
    // the WS resume then streams the session's init manifest and continues it on the next message.
    let frames: ChatFrame[] = [];
    try {
      frames = await api.chatSessionMessages(sessionId);
    } catch {
      frames = [];
    }
    for (const frame of frames) onFrame(frame);
    // Bind the live socket to resume this session (cancel any in-flight reconnect timer first).
    // If the socket isn't open yet, stash it so onopen flushes the resume instead of dropping it.
    clearTimeout(reconnectTimer);
    if (!sendJson({ type: "resume", sessionId })) pendingResume = sessionId;
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
    // Enter sends; Shift+Enter inserts a newline (default textarea behavior).
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

  return (
    <div class="chat-host">
      <ViewBar>
        <Crumb icon="MessageSquare">Chat</Crumb>
        <Show when={manifest()?.model}>
          {(model) => <span class="chat-model" title="Active model">{model()}</span>}
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
        <div class="chat-list" ref={list!} onClick={onListClick} onScroll={onListScroll}>
          <Show when={transcript.length === 0}>
            <div class="chat-empty">
              <p>Ask Claude anything about your vault. Run any <code>/command</code>, watch tool calls and thinking, and approve tool use inline.</p>
            </div>
          </Show>
          <For each={transcript}>
            {(item) => (
              <Show
                when={item.role === "assistant"}
                fallback={
                  <div class="chat-msg user">
                    {/* The user's own message renders through the SAME note markdown pipeline
                        (renderNoteBody) so it looks like a note too — not just Claude's replies. */}
                    <div class="chat-bubble user" innerHTML={renderNoteBody((item as UserItem).text)} />
                  </div>
                }
              >
                <AssistantTurn item={item as AssistantItem} />
              </Show>
            )}
          </For>
          <Show when={streaming() && (transcript.length === 0 || transcript[transcript.length - 1].role === "user")}>
            <div class="chat-msg assistant">
              <div class="chat-thinking-dots">
                <span class="chat-dot" />
                <span class="chat-dot" />
                <span class="chat-dot" />
              </div>
            </div>
          </Show>
          <Show when={turnError()}>{(msg) => <div class="chat-turn-error">{msg()}</div>}</Show>
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
          <TextInput
            multiline
            ref={((el: HTMLTextAreaElement) => { ta = el; }) as unknown as HTMLInputElement}
            class="chat-input"
            value={draft()}
            onInput={setDraft}
            onKeyDown={onKeyDown}
            placeholder="Message Claude…  ( / for commands · Enter to send · Shift+Enter for newline )"
          />
          <Show
            when={streaming()}
            fallback={
              <IconButton
                icon="Send"
                label="Send message"
                variant="selected"
                onClick={send}
                disabled={!draft().trim()}
              />
            }
          >
            <IconButton icon="Square" label="Stop generating" danger onClick={stop} />
          </Show>
        </div>
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
      <div ref={panel!} class="chat-history-panel">
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
        <div class="chat-bubble assistant" innerHTML={renderNoteBody(p.part.text)} />
      </Show>
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
      <div class="chat-permission" classList={{ answered: !!p.part.answered }}>
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
          when={!p.part.answered}
          fallback={
            <div class="chat-permission-outcome" classList={{ deny: p.part.answered?.behavior === "deny" }}>
              <Icon value={p.part.answered?.behavior === "allow" ? "Check" : "X"} size={13} />
              {p.part.answered?.behavior === "allow"
                ? p.part.answered.always
                  ? "Allowed (always)"
                  : "Allowed"
                : "Denied"}
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
