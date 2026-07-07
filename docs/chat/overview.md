# Visual Claude Code Chat

Bismuth ships an in-app **chat** tab that is a visual front-end onto the user's own `claude` binary. Each chat is one long-lived [Claude Agent SDK](https://modelcontextprotocol.io) `query()` session, driven over a WebSocket at `/chat`, that runs the locally-installed Claude Code with the user's **machine-login auth** — there is **no API key by design**. The backend (`core/src/chat.ts`) translates the SDK's streaming message feed into a small `ChatFrame` wire union; the frontend (`app/src/ChatView.tsx`) renders those frames as a live transcript that mirrors the Claude Code TUI: streamed assistant prose (markdown), collapsible extended-thinking, labeled tool-call chips with their results, inline permission prompts, and a per-turn manifest (model / permission mode / slash commands / tools / MCP servers). Everything is data-driven off the SDK, so new Claude Code features light up with zero code changes here.

## No API key by design

The driver never makes an API call. `createSession()` (`core/src/chat.ts`) resolves the user's CLI with `whichClaude()` and passes it to the SDK as `pathToClaudeCodeExecutable`:

```ts
const bin = whichClaude();
if (!bin) {
  sink({ type: "error", code: "no-claude", message: "The `claude` CLI was not found. Install Claude Code to use chat." });
  return null;
}
```

If `claude` is not on PATH the driver pushes a single `{ type: "error", code: "no-claude" }` frame and returns — it **never falls back to an API**. `ChatView` catches that frame and swaps the whole transcript for a setup state ("Claude Code isn't available"):

```ts
case "error":
  setStreaming(false);
  if (frame.code === "no-claude") setSetupError(true);
  else setTurnError(frame.message || "Something went wrong.");
```

The setup panel tells the user to install Claude Code and sign in, then reopen the tab.

Because auth is the user's machine login, the SDK reports `apiKeySource: "none"` (read off the `init` event). In that case the SDK's `total_cost_usd` is a notional, *un-billed* API-equivalent figure, so the driver hides it — the `result` frame's `costUsd` is set to `null` unless `apiKeySource` is something other than `"none"` (real API-key billing):

```ts
costUsd:
  session.apiKeySource === "none" || typeof msg.total_cost_usd !== "number"
    ? null
    : msg.total_cost_usd,
```

## One long-lived session per chat

The driver keeps a registry of sessions keyed by a client **chat id** (`const sessions = new Map<string, ChatSession>()`), mirroring `core/src/terminal.ts`. The session bundles the SDK `query()` handle, an input mailbox, the current frame sink, the in-flight permission map, and the always-allow set:

```ts
interface ChatSession {
  id: string;
  cwd: string;            // the vault dir → query()'s cwd, so `claude` works against the user's notes
  input: InputQueue;      // push-input mailbox feeding query() as the multi-turn `prompt`
  q: Query;               // the live query() generator + control surface
  sink: ChatSink;         // where ChatFrames go (the chat WebSocket)
  pending: Map<string, PermissionResolver>;
  alwaysAllow: Set<string>;
  sessionId: string | null;
  apiKeySource: string;
  closeTimer?: ReturnType<typeof setTimeout>;
}
```

A single `query()` runs for the life of the chat. Its `prompt` is an **async-iterable mailbox** (`makeInputQueue()`): each user turn `push()`es one `SDKUserMessage` onto the queue, and `query()` consumes them in order. A slash command is just text — the CLI runs it. `close()` ends the stream. The query is started with the user's CLI, the user's resolved config, partial-message streaming, and the `claude_code` system-prompt preset:

```ts
q = query({
  prompt: input,
  options: {
    pathToClaudeCodeExecutable: bin,
    cwd,
    includePartialMessages: true,
    ...(resume ? { resume } : {}),
    systemPrompt: { type: "preset", preset: "claude_code" },
    canUseTool: canUseTool as unknown as CanUseTool,
  },
});
```

`permissionMode` is intentionally **not** set — omitting it makes the SDK resolve the starting mode from the user's own Claude Code config (the user can still switch it live). The `claude_code` preset is what makes this a *visual Claude Code*: it injects the `<env>` context (working directory, platform, date), loads `CLAUDE.md`, skills, and the full tool guidance, and makes relative paths resolve against `cwd` exactly like the TUI.

A background **drain loop** (`drain(session)`) iterates the `query()` generator and translates each SDK message into `ChatFrame`s. It runs until the generator ends (input queue closed or the CLI exited). On any throw — including `query()`'s "Reached maximum number of turns" — it surfaces a friendly `error` frame rather than crashing the server, and (if the session ended on its own) evicts the session so the next `sendMessage` re-spawns a fresh one.

### sendMessage / resumeSession

- **`sendMessage(chatId, text, cwd, sink)`** — the entry point for a user turn. The *first* call for a chatId creates the session and starts the drain loop; every call (first and subsequent) `push`es `text` into the input queue so the CLI runs it as the next turn. On an *existing* session a turn also cancels any pending grace-period teardown, refreshes the sink (a reconnect installs a new socket), and updates `cwd`.

- **`resumeSession(chatId, sessionId, cwd, sink)`** — binds this chatId to an *existing* Claude Code session by passing `options.resume: sessionId` to `query()`. It pushes **no** initial turn: it opens the input queue and starts draining so the resumed session's `init` manifest streams in. If a session already exists for the chatId it is torn down first (`closeChat`) to cleanly re-bind. The next `sendMessage(chatId, …)` continues the resumed conversation normally.

## Unification with terminal sessions

The Agent SDK keeps **one session store per cwd**. Because the chat driver runs `claude` with `cwd: cfg.vault`, the user's *terminal* Claude Code sessions (run from the vault) and their *in-app chat* sessions land in the same store. Two read-only endpoints expose it:

- **`GET /chat/sessions`** → `listChatSessions(cfg.vault)` → `listSessions({ dir: cwd, limit })` from the SDK. Returns `{ sessionId, summary, lastModified }[]`, newest first (the SDK sorts it). Tolerant: returns `[]` if the store can't be read.

  ```ts
  "GET /chat/sessions": async (_, __) => {
    return ok({ sessions: await listChatSessions(cfg.vault) });
  },
  ```

- **`GET /chat/session-messages?id=<sessionId>`** → `sessionHistoryFrames(id, cfg.vault)` → `getSessionMessages(sessionId, { dir: cwd })`. Replays a past session as `ChatFrame[]` *in order*, through the same `translateSdkMessage` source of truth the live drain loop uses (`live: false`), so history and live render identically. An empty `id` yields an empty replay.

The frontend reaches these through `api.chatSessions()` and `api.chatSessionMessages(id)` (`app/src/api.ts`), typed as `ChatSessionInfo { sessionId; summary; lastModified }`.

## The ChatFrame wire protocol over `/chat`

The `/chat` WebSocket is a text-JSON protocol. Server → client is the `ChatFrame` union (exported from `core/src/chat.ts`, imported by `ChatView`). Client → server is a small command set, discriminated by `type`:

| Client → server | Effect |
| --- | --- |
| `{type:"user", text}` | Run a turn — `chatSend()`. Slash commands are just text. |
| `{type:"resume", sessionId}` | Bind this chat to an existing session — `chatResume()`. Its `init` manifest streams back. |
| `{type:"permission_response", id, behavior, always?}` | Answer a `permission` frame — `chatRespondPermission()`. |
| `{type:"set_permission_mode", mode}` | Switch permission mode live — `chatSetPermissionMode()`. |
| `{type:"set_model", model}` | Switch model live — `chatSetModel()` (the header model picker, populated by the `models` frame). |
| `{type:"stop"}` | Interrupt the in-flight turn — `chatAbort()` (leaves the session resumable). |

The `ChatFrame` union (server → client):

- `{type:"manifest", manifest}` — a fresh per-turn manifest from each `system`/`init`.
- `{type:"user-message", text, images?}` — a past user turn, emitted **only** during history replay (live user messages come from the client, not the wire). `images` carries persisted attachments as `data:` URLs so image(-only) turns survive replay.
- `{type:"assistant-text", text}` — a delta of assistant prose, streamed from `content_block_delta` text deltas.
- `{type:"thinking", text}` — a delta of extended-thinking text.
- `{type:"tool-use", id, name, input}` — an assistant `tool_use` block.
- `{type:"tool-result", id, content, isError}` — the matching user `tool_result` block.
- `{type:"permission", id, toolName, input}` — `canUseTool` asking the user to approve/deny.
- `{type:"result", isError, numTurns, costUsd}` — a turn ended.
- `{type:"models", models}` — the models this login can run (`Query.supportedModels()`, fetched once per session after the first init) — populates the header model picker.
- `{type:"title", title}` — the session's conversation summary (`getSessionInfo`), emitted once a non-empty summary exists (retried at each turn-end) — names the chat tab.
- `{type:"context", percentage, totalTokens, maxTokens}` — context-window usage after each completed turn (`Query.getContextUsage()`) — the header pill (warns past ~80%).
- `{type:"done"}` — the turn is fully drained (pushed after `result`).
- `{type:"error", code, message}` — `no-claude` (CLI missing — surface setup), `spawn`/`exit` (child failed), or `error` (an SDK/turn error).

### Streaming and de-dup

Assistant prose and thinking are emitted **live** off `stream_event` `content_block_delta` deltas (only present because `includePartialMessages: true`). When the *final* `assistant` message arrives, the drain loop skips its already-streamed text/thinking blocks and emits only its `tool_use` blocks (which have no delta form). The single `translateSdkMessage(msg, { live })` function is the source of truth for both live drain (`live: true`) and history replay (`live: false`).

### Connection lifecycle and resilience

The WS upgrade (`/chat`) enforces the same origin allow-list as `/terminal` (localhost / `tauri://` / `10.x` LAN) and reads a stable `chatId` query param so a reconnect resumes the same session. On WS `open` the server **rebinds the session's sink** to the new socket (`chatRebindSink`), so a reconnect mid-turn keeps the in-flight drain frames (including the turn's tail and `done`) flowing to the live socket. On WS `close`, a clean close (`1000`, intentional tab-close) tears the session down immediately (`closeChat`); an abnormal close (reload `1001`, drop `1006`) schedules a 30s grace teardown (`scheduleChatClose`) so a reconnect resumes the same `claude` conversation. `ChatView` reconnects with exponential backoff (capped at 8s), pinning `activeChatId`, and stashes a `pendingResume` if a session is picked before the socket is open (flushed on `onopen`). All chat sessions are torn down on process exit / SIGINT / SIGTERM so headless `claude` children don't outlive a backend restart.

## Inline permission flow

`canUseTool` fires only for tools **not** already allowed by the user's settings (pre-allowed tools run silently — correct Claude Code behavior). A tool the user chose to *always allow this session* short-circuits via the `alwaysAllow` set; everything else surfaces a `permission` frame and parks the SDK's `canUseTool` promise until the client answers:

```ts
if (session.alwaysAllow.has(toolName)) {
  return Promise.resolve({ behavior: "allow", updatedInput: toolInput });
}
const id = opts.toolUseID ?? randomUUID();
return new Promise((resolve) => {
  session.pending.set(id, ({ behavior, always }) => {
    if (behavior === "allow") {
      if (always) session.alwaysAllow.add(toolName);
      resolve({ behavior: "allow", updatedInput: toolInput });
    } else {
      resolve({ behavior: "deny", message: "Denied by the user" });
    }
  });
  session.sink({ type: "permission", id, toolName, input: toolInput });
});
```

The client renders an inline `PermissionCard` with three actions — **ALLOW** (`allow`, `always:false`), **ALLOW ALWAYS** (`allow`, `always:true`), and **DENY** (`deny`) — and sends `{type:"permission_response", id, behavior, always}`. `respondPermission()` resolves the parked promise; `always` is remembered per session via `alwaysAllow`. The card then shows the outcome ("Allowed", "Allowed (always)", or "Denied"). On teardown, every pending permission is auto-denied so no `canUseTool` promise dangles.

## The per-turn manifest

Every `system`/`init` event emits a fresh `manifest` frame — the lists are sourced **entirely from the SDK init**, never hardcoded, so a manifest self-updates each turn and reflects the live CLI:

```ts
session.sink({
  type: "manifest",
  manifest: {
    model: msg.model,
    permissionMode: msg.permissionMode,
    slashCommands: msg.slash_commands ?? [],
    tools: msg.tools ?? [],
    mcpServers: (msg.mcp_servers ?? []).map((m) => ({ name: m.name, status: m.status })),
  },
});
```

In the header `ViewBar`, `ChatView` shows the model (a live picker once the `models` frame arrives, read-only before), a tools count (`Wrench N`), a connected/total MCP count (`Server X/Y`, where "connected" matches `/connect|ready|ok/i` on each server's status), a context-usage pill (`Gauge N%`, danger-tinted past 80%), and a permission-mode `Select` (Default / Plan / Accept edits / Bypass — the fixed protocol values). The manifest's `slashCommands` drives the composer's `/`-prefix autocomplete: type `/` and the popover filters `manifest().slashCommands` by prefix (single-token only; a space turns it into an argument). Picking a command inserts `"/cmd "` into the draft so the user can add arguments before pressing Enter to send.

> The model is switchable live from the header: the `models` frame (from `Query.supportedModels()`) populates a `Select` that sends `{type:"set_model"}`; before the list arrives (or for a single-model login) the active model shows read-only.

## Session history picker

The header's **Past conversations** button (a `MessagesSquare` icon) opens a popover (`HistoryPanel`) listing the user's existing Claude Code sessions for the vault — terminal *and* in-app, newest-first — fetched via `api.chatSessions()`. Each row shows the session summary (ellipsized, falling back to "Untitled session") plus a relative time ("just now", "5m ago", "2h ago", "3d ago", then a short date). Picking a row calls `resumeSession(sessionId)`, which:

1. clears the transcript (`resetTranscript`),
2. rehydrates the past turns by fetching `api.chatSessionMessages(sessionId)` and feeding every replayed frame through the **same** `onFrame` that handles live frames, then
3. binds the live socket to resume that session (`{type:"resume", sessionId}`), or stashes it as `pendingResume` if the socket isn't open yet.

The next message continues that conversation. The **Plus** button (`startNewChat`) swaps to a fresh chat id (`crypto.randomUUID()`) — a brand-new Claude Code session on the next message — and clears the view, without touching the tab. Both reconnect via `reconnectOn(id)`, which detaches the old socket's handlers before closing it so a deliberate switch never leaks a duplicate socket.

## Editor context injection

Every non-slash-command turn is prefixed with a compact `<editor-context>` preamble describing what the user is looking at — grounding for Claude, never something the user typed. Two pieces cooperate:

- **`app/src/chatContext.ts`** is a tiny module-level **singleton** mirroring `editorRegistry`, but for "which files is the user looking at": `publishEditorTabs(t: EditorTabsSnapshot)` (`{ openFiles: {path,label}[], activeFile: string | null }`) and `getEditorTabs()`. Plain module state, not reactive — consumers only ever want the freshest value at send time. `App.tsx` calls `publishEditorTabs` from a `createEffect` that re-derives `openContents()`/`focusedContent()` on every tab/pane open/close/focus change, filtering out sentinel content ids (`::graph`, `::chat:…`, terminals, …) via `isSentinel()` so only real note paths count as "open" or "active" (`app/src/App.tsx:192-204`).
- **`ChatView.buildEditorContext()`** (`app/src/ChatView.tsx:190-204`) reads `getEditorTabs()` plus the focused CodeMirror selection (`getFocusedSelection()` from `editorRegistry`) and renders a `<editor-context>…</editor-context>` block: an `Active file:` line, an `Open tabs:` line (comma-joined paths), and, only when there's a live selection, a `Current selection (from <path>):` line with the selected text fenced in a code block. Returns `""` when there's no active file and no selection — nothing worth telling Claude.

`send()` prepends this preamble to the **wire** text only (`preamble + "\n\n" + text`) — the transcript bubble stores and shows the user's raw typed text, so the context never clutters what the user sees (`app/src/ChatView.tsx:485-491`). It's skipped entirely for a `/slash-command` turn, since Claude Code only recognizes a command at the very start of the message.

Because the SDK persists the literal wire text (preamble included) as the turn's message content, replaying a resumed session would otherwise show the preamble as if the user had typed it. `core/src/chat.ts`'s `stripEditorContext(text)` strips a single leading `<editor-context>\n…\n</editor-context>\n\n` block via regex; `userMessageText()` (used by `translateSdkMessage`'s history path) runs every replayed user message through it before emitting the `user-message` frame, so a replayed bubble shows only what the user actually typed — kept in sync with `buildEditorContext`'s exact shape (a lone `<editor-context>` line … `</editor-context>` then a blank line).

## Image attachments

The composer accepts dropped or pasted images, sent alongside (or instead of) text as SDK image content blocks — no OCR/description step, the model sees the actual image.

- **Client** (`app/src/ChatView.tsx`): `onComposerDrop`/`onComposerPaste` intercept image `File`s (mirroring `Editor.tsx`'s own image handling) and hand them to `addImageFiles()`, which rejects anything over `MAX_IMAGE_BYTES` (10 MB) or outside `CHAT_IMAGE_MIME` (`image/png|jpeg|gif|webp` — deliberately narrower than the editor's attachment set: no svg/pdf, since those aren't valid SDK `image` blocks) and otherwise stages a base64 `Attachment` (`readImageFile()`, `FileReader.readAsDataURL` with the `data:<mime>;base64,` prefix stripped). Staged attachments render as removable thumbnail chips above the textarea (`chat-attachments`/`chat-attachment` with a remove button); a chat needs *some* content to send — text or ≥1 attachment.
- **Send-time guards**: a slash command can't carry images — `send()` refuses with an inline error if `text` starts with `/` and attachments are staged (the CLI only expands `/command` for a plain string turn; an array-of-blocks shape would forward it as literal text and silently break the command). `MAX_TOTAL_IMAGE_BYTES` (~12 MB of combined base64) bounds one turn's payload, since Bun silently drops a `/chat` WS frame over ~16 MB, which would otherwise wedge the turn in `streaming()` forever with no reply.
- **Wire shape**: `{type:"user", text, images?: {media_type, data}[]}` — `data` is base64 without the `data:` prefix. The server validates each entry's `media_type`/`data` are strings before forwarding to `chatSend` (`core/src/server.ts`).
- **Backend** (`core/src/chat.ts`): `ChatImage { media_type: string; data: string }` flows through `sendMessage(chatId, text, cwd, sink, images?)` → the input queue's `push(text, images)` → `makeUserMessage(text, images)`, which shapes the SDK `SDKUserMessage.message.content`. With **no** images, content is a **plain string** (required so the spawned `claude` CLI still runs its own slash-command detection/expansion — an array-of-blocks shape would be forwarded to the model as literal text and never execute `/compact`, `/clear`, or a custom command). With images, content becomes an **array**: an optional leading `{type:"text", text}` block, then one `{type:"image", source:{type:"base64", media_type, data}}` block per attachment.
- **Rendering**: the sent images are shown in the user bubble as `data:` URLs (`bubbleImages`) so an image-only turn isn't an empty-looking bubble — rendered via `UserItem.images` in a `chat-user-images` flex row of thumbnails (`app/src/ChatView.tsx:798-805`), separate from the `renderNoteBody` markdown path used for text.

## Rendering

Both the user's messages and the assistant's replies render through `renderNoteBody` (`app/src/bases/markdown` — the same markdown pipeline notes use), so a chat reads exactly like the editor (Lora, math, code, wikilinks, tags):

```tsx
<div class="chat-bubble user" innerHTML={renderNoteBody((item as UserItem).text)} />
...
<div class="chat-bubble assistant" innerHTML={renderNoteBody(p.part.text)} />
```

`[[wikilinks]]` in a rendered bubble (emitted as `a.bismuth-wikilink` with a `data-href`) open in-app via a delegated click that dispatches the global `bismuth-open` event. An assistant turn is an ordered list of **parts** — prose (`TextBubble`), collapsible thinking (`ThinkingBlock`, raw `<pre>`, not markdown), tool chips (`ToolChip`, with input/result detail and a pending spinner), and permission cards (`PermissionCard`) — plus an optional muted footer with the turn count and (only on API-key billing) the cost. A streaming turn with no parts yet shows a three-dot thinking indicator.

## Tab routing, command, and keybinding

A chat tab is a sentinel pane content id: `CHAT_PREFIX + "<chat id>"`, where `CHAT_PREFIX = "::chat:"` (`app/src/tabIds.ts`). It labels as **"Chat"** with a `MessageSquare` icon (`contentLabel` / `contentIcon`). `PaneContent.tsx` routes `path.startsWith(CHAT_PREFIX)` to a lazily-loaded `<ChatView chatId={path.slice(CHAT_PREFIX.length)} />`.

The **`new-claude-chat`** command (catalog entry in `core/src/commands.ts`, label "New Claude Chat", icon `MessageSquare`; bound in `app/src/commands.ts`) runs `newClaudeChat` in `App.tsx`, which opens a fresh tab with a new uuid each time:

```ts
const newClaudeChat = () => openInNewTab(CHAT_PREFIX + crypto.randomUUID());
```

Its default keybinding is **`Mod+Shift+C`** (`core/src/keybindings.ts`, id `new-claude-chat`: "Open a new Claude Code chat session in its own tab."), dispatched in `App.tsx` via `matchesKeybinding(e, kb["new-claude-chat"])`.

---

Source: `core/src/chat.ts`, `core/src/server.ts` (`/chat` WS + `GET /chat/sessions` + `GET /chat/session-messages`), `app/src/ChatView.tsx`, `app/src/chatContext.ts`, `app/src/tabIds.ts`, `app/src/PaneContent.tsx`, `app/src/api.ts`, `app/src/App.tsx`, `app/src/commands.ts`, `core/src/commands.ts`, `core/src/keybindings.ts`.
