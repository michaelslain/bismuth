# Visual Claude Code Chat

> Chats can also run on **opencode** instead of Claude Code — see [Chat providers](providers.md) for the provider seam (`core/src/chatProviders/`), the header picker, and what degrades gracefully. This page documents the default Claude Code driver.

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
    allowDangerouslySkipPermissions: true,
    ...(session.effort ? { effort: session.effort } : {}),
  },
});
```

`permissionMode` is intentionally **not** set — omitting it makes the SDK resolve the *starting* mode from the user's own Claude Code config (the user can still switch it live). The `claude_code` preset is what makes this a *visual Claude Code*: it injects the `<env>` context (working directory, platform, date), loads `CLAUDE.md`, skills, and the full tool guidance, and makes relative paths resolve against `cwd` exactly like the TUI.

`allowDangerouslySkipPermissions: true` **enables** the bypass capability (BUG #60). `bypassPermissions` — whether set at spawn or via the runtime `setPermissionMode` control request — is gated behind this flag: the SDK only passes `--allow-dangerously-skip-permissions` to the CLI when it's true, and without it the CLI silently refuses to enter bypass mode, so `canUseTool` kept firing and every tool call still prompted even after the user selected **Bypass** in the header. Enabling the capability does **not** change the starting mode (still resolved from config) — it only lets the client's `set_permission_mode` actually take effect. Visibility stays enforced under bypass because the `managedSettings` deny + `sandbox` `denyRead` are policy-tier and survive the permission mode.

`effort` (reasoning-effort level, FEATURE #63) is applied **live** via `Query.applyFlagSettings({ effortLevel })` when the user picks one in the header, and stashed on the session so a mid-conversation visibility respawn re-applies it through this spawn option. Omitted until a level is chosen.

### Browser / computer-use (`--chrome`)

When the **`chat.computerUse`** setting is on (a boolean, default `false`, in `core/src/schema/settingsSchema.ts` under the `chat` section), `spawnChatQuery` passes `extraArgs: { chrome: null }` (a bare `--chrome` boolean flag) to `query()`, so the spawned `claude` process can launch and control a **Chromium browser** for Claude's browser/computer-use tools. It requires a Chromium-based browser on the system (Chrome/Edge/Brave). The capability is read from settings at spawn time and stashed on `session.computerUse`, so a visibility respawn preserves the flag (like `effort`/`model`). It's threaded end-to-end: `sendMessage`/`resumeSession`/`openSession` all take a `computerUse?` argument (the server reads the setting), and the client-side **`/chrome`** slash command (see [Client-side slash commands](#client-side-slash-commands)) toggles `settings.chat.computerUse` from the composer.

A background **drain loop** (`drain(session)`) iterates the `query()` generator and translates each SDK message into `ChatFrame`s. It runs until the generator ends (input queue closed or the CLI exited). On any throw — including `query()`'s "Reached maximum number of turns" — it surfaces a friendly `error` frame rather than crashing the server, and (if the session ended on its own) evicts the session so the next `sendMessage` re-spawns a fresh one.

### sendMessage / resumeSession

- **`sendMessage(chatId, text, cwd, sink)`** — the entry point for a user turn. The *first* call for a chatId creates the session and starts the drain loop; every call (first and subsequent) `push`es `text` into the input queue so the CLI runs it as the next turn. On an *existing* session a turn also cancels any pending grace-period teardown, refreshes the sink (a reconnect installs a new socket), and updates `cwd`.

- **`resumeSession(chatId, sessionId, cwd, sink)`** — binds this chatId to an *existing* Claude Code session by passing `options.resume: sessionId` to `query()`. It pushes **no** initial turn: it opens the input queue and starts draining so the resumed session's `init` manifest streams in. If a session already exists for the chatId it is torn down first (`closeChat`) to cleanly re-bind. The next `sendMessage(chatId, …)` continues the resumed conversation normally.

## Unification with terminal sessions

The Agent SDK keeps **one session store per cwd**. Because the chat driver runs `claude` with `cwd: cfg.vault`, the user's *terminal* Claude Code sessions (run from the vault) and their *in-app chat* sessions land in the same store. Two read-only endpoints expose it:

- **`GET /chat/sessions`** → `listChatSessions(cfg.vault)` → the SDK's `listSessions({ dir: cwd, … })`. Returns `{ sessionId, summary, lastModified }[]`, newest first (the SDK sorts it). Tolerant: returns `[]` if the store can't be read.

  **Only the USER's chats.** The vault's daemon runs Claude sessions when its crons fire, with `cwd` = the vault root — so they land in this *same* store and used to fill the History picker with conversations the user never opened. `listChatSessions` subtracts the daemon's own sessions, identified by `readDaemonSessionIds` (`core/src/daemon.ts`). They are only *hidden here* — never deleted; the crons need them, and a later surface will read the same set to show them. Note this is a **membership test against every id the daemon ever minted**, not a comparison against the sibling `session-id` pointer (which names only the daemon's latest run, and so would leave every earlier cron session looking like a user chat).

  That set is the **union of two files**, because the two halves of "every id the daemon ever minted" have different origins:

  | file | written by | covers |
  | --- | --- | --- |
  | `<vault>/.daemon/session-ids` | the daemon, as it mints each session (`daemon/src/daemon/sessionIds.ts`) | everything from that mechanism forward |
  | `<vault>/.daemon/session-ids-legacy` | **core**, once (`core/src/chatDaemonLegacy.ts`) | everything before it — recovered by a one-time scan |

  The second file is what makes this fix *land* rather than merely be correct going forward: the durable set is empty on exactly the machines that have the problem, so on a real vault (the reporting one held 997 sessions — **129 daemon boot sessions + 759 cron sessions = 89% of the picker**) shipping only the set would leave every chat the user complained about listed, aging out over ~30 days. `backfillLegacyDaemonSessions` runs on the first History open and identifies those sessions by the prompts **the daemon itself composed** — not a "does this look automated" heuristic, but an exact match on daemon-authored constants anchored at the transcript's *opening* message (see `chatDaemonLegacy.ts` for the anchors and why they are frozen). It is bounded (reads only each transcript's first message: ~1s for ~1000 sessions), idempotent (the file's existence is the marker), gated on the vault actually having a `.daemon`, and never deletes anything.

  The asymmetry that drives every rule there: a false positive **hides the user's own conversation**, which is far worse than leaving a daemon chat listed. So anything unjudgeable — an assistant-first transcript, an unreadable file, a user merely *discussing* crons — is treated as the user's.

  Because the daemon can mint far more sessions than the user (one per cron fire), the scan **paginates** the store until it has `limit` *user* sessions (bounded by a scan cap) — filtering a single fixed page would return an empty History whenever the newest page happened to be all daemon.

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
| `{type:"user", text}` | Run a turn — `chatSend()`. Slash commands are just text, with one exception: `/mcp` is answered locally (see below). |
| `{type:"resume", sessionId}` | Bind this chat to an existing session — `chatResume()`. Its `init` manifest streams back. |
| `{type:"permission_response", id, behavior, always?}` | Answer a `permission` frame — `chatRespondPermission()`. |
| `{type:"question_response", id, answers?, cancelled?}` | Answer an AskUserQuestion `question` frame — `chatRespondQuestion()`. `answers` maps each question's text → the chosen answer string (multi-select comma-joined); `cancelled`/no answers skips. |
| `{type:"set_permission_mode", mode}` | Switch permission mode live — `chatSetPermissionMode()`. |
| `{type:"set_model", model}` | Switch model live — `chatSetModel()` (the header model picker, populated by the `models` frame). |
| `{type:"set_effort", effort}` | Switch reasoning-effort level live — `chatSetEffort()` → `Query.applyFlagSettings({ effortLevel })` (the header Effort picker; options come from the selected model's `effortLevels` in the `models` frame). |
| `{type:"stop"}` | Interrupt the in-flight turn — `chatAbort()` (leaves the session resumable). |

The `ChatFrame` union (server → client):

- `{type:"manifest", manifest}` — a fresh per-turn manifest from each `system`/`init`.
- `{type:"user-message", text, images?}` — a past user turn, emitted **only** during history replay (live user messages come from the client, not the wire). `images` carries persisted attachments as `data:` URLs so image(-only) turns survive replay.
- `{type:"assistant-text", text}` — a delta of assistant prose, streamed from `content_block_delta` text deltas.
- `{type:"thinking", text}` — a delta of extended-thinking text.
- `{type:"tool-use", id, name, input}` — an assistant `tool_use` block.
- `{type:"tool-result", id, content, isError}` — the matching user `tool_result` block.
- `{type:"permission", id, toolName, input}` — `canUseTool` asking the user to approve/deny.
- `{type:"question", id, questions}` — Claude called **AskUserQuestion**: 1–4 multiple-choice questions the user must answer for the turn to continue (see [Interactive questions](#interactive-questions-askuserquestion)).
- `{type:"result", isError, numTurns, costUsd}` — a turn ended.
- `{type:"models", models}` — the models this login can run (`Query.supportedModels()`, fetched once per session after the first init) — populates the header model picker. Each entry also carries `effortLevels` (the model's `supportedEffortLevels`), which drives the header **Effort** picker (FEATURE #63) so it offers exactly the *selected* model's levels — never a hardcoded list, and hidden when the model exposes none.
- `{type:"title", title}` — the session's conversation summary (`getSessionInfo`), emitted once a non-empty summary exists (retried at each turn-end) — names the chat tab.
- `{type:"session", sessionId}` — the SDK `session_id` this chat is bound to, emitted the moment the drain loop first learns it (and again if it ever changes, e.g. after a resume). `ChatView` persists it keyed by the chat **tab** id (`app/src/chatSessionStore.ts`), so **Reopen closed tab** (Cmd+Shift+T) can resume the *same* conversation — a reopened `::chat:` tab reads the remembered `sessionId` on mount and calls `resumeSession()` instead of spawning a blank session. Durable (the CLI's on-disk session store), so it survives a relaunch too.
- `{type:"context", percentage, totalTokens, maxTokens}` — context-window usage after each completed turn (`Query.getContextUsage()`) — the header pill (warns past ~80%).
- `{type:"done"}` — the turn is fully drained (pushed after `result`).
- `{type:"error", code, message}` — `no-claude` (CLI missing — surface setup), `spawn`/`exit` (child failed), or `error` (an SDK/turn error).

### Locally-answered slash commands: `/mcp` (BUG #39)

Almost every slash command is "just text" — `sendMessage` pushes it into the input queue unmodified and the spawned `claude` CLI does its own detection/expansion, exactly like the TUI. The SDK is well-behaved about unrecognized or non-interactive input: a bogus command comes back as a synthetic assistant reply ("Unknown command: /x"), and a command that's genuinely TUI-only (`/help`, `/status`, `/permissions`, `/mcp`, …) comes back as a synthetic "`/x` isn't available in this environment." — never a crash, never silence. (This is also why `manifest.slashCommands` never lists these TUI-only commands: the SDK's own `init` event only advertises the subset that can do something useful headlessly.)

`/mcp` is the one exception worth a real implementation, since Claude Code's own `/mcp` is genuinely useful (the connected/failed/needs-auth server list with tool counts) but the non-interactive stub throws that away. `isMcpCommand(text)` (`core/src/chat.ts`) matches a bare `/mcp` (no arguments) and, instead of forwarding it, `answerMcpCommand` calls `Query.mcpServerStatus()` directly — the same control-plane call `emitInitManifest` already uses for the header's connected/total count — and renders the result with `formatMcpStatus` (pure, unit-tested in `core/test/chat.test.ts`) as a normal `assistant-text` reply, followed by a synthetic `result`/`done` pair so the client's turn-end handling (including the mid-turn queued-message dispatch) needs no special case. It never touches the real input queue or session transcript: this is introspection of already-live session state, not a conversational turn, so it costs nothing, can't fail against the model, and simply won't appear if that session's history is ever replayed (like the synthetic init-time manifest itself).

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

## Interactive questions (AskUserQuestion)

Claude Code's **AskUserQuestion** tool (interactive multiple-choice questions) works in the visual chat: the assistant asks 1–4 questions with 2–4 options each, the user picks, and the assistant continues with the answer.

**The channel is `canUseTool`, not `onUserDialog`.** AskUserQuestion is a permission-shaped tool: when the model calls it, the SDK delivers a `can_use_tool` control request for it (verified live — the SDK's `onUserDialog`/`request_user_dialog` path, which the interactive TUI uses for the `permission_ask_user_question` dialog, does **not** fire for a programmatic `query()` that supplies a `canUseTool` callback). The driver therefore intercepts the tool inside `canUseTool` (branch on `toolName === ASK_USER_QUESTION_TOOL`) rather than surfacing an "Allow AskUserQuestion?" prompt:

- It normalizes the tool input's `questions` (`extractAskUserQuestions`, pure + tolerant) and emits a `{type:"question", id, questions}` frame, then **parks** the `canUseTool` promise in `session.pendingDialogs` (keyed by the tool-use id).
- The client renders an interactive `QuestionCard`: each question shows its `header` chip, the question text, its options as buttons (with descriptions), an **Other…** free-text input, and **SUBMIT** / **SKIP**. A lone single-select question submits on option click; multi-select shows checkboxes and stages selections behind SUBMIT.
- The client answers with `{type:"question_response", id, answers}` (or `{…, cancelled:true}` to skip). `answers` maps each question's **text** → the chosen answer string; a multi-select is comma-joined, and free-text "Other" rides in as its own answer.
- `respondQuestion()` resolves the parked promise via `buildAskUserQuestionAnswer(toolInput, answers)` (pure + unit-tested): an answer resolves to `{behavior:"allow", updatedInput:{...input, answers}}` — the AskUserQuestion tool reads `answers` off its updated input to build the result the model sees. A **skip** (null answers) resolves to `{behavior:"allow", updatedInput:input}` **unchanged**, so the tool emits its own "no answer selected" result and the turn continues gracefully rather than erroring.

A pending question naturally **blocks the turn from ending** (the `canUseTool` promise is unresolved, so no `result`/`done` arrives): a follow-up message the user sends meanwhile is staged (dimmed bubble) and dispatched on `done`, exactly like the mid-turn queue. **Stop** (or teardown) cancels every parked question with a deny so no promise dangles, and the card renders a muted "Skipped". Answers clicked while the socket is down queue in `pendingQuestionResponses` and flush on reconnect (the backend's parked promise survives the grace window), mirroring `pendingPermissions`.

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

In the header `ViewBar`, `ChatView` shows the model (a live picker once the `models` frame arrives, read-only before), an optional reasoning-**Effort** picker (shown only when the selected model reports >1 `effortLevels`; FEATURE #63), a tools count (`Wrench N`), a connected/total MCP count (`Server X/Y`, where "connected" matches `/connect|ready|ok/i` on each server's status), a context-usage pill (`Gauge N%`, danger-tinted past 80%), and a permission-mode `Select` (Default / Plan / Accept edits / Bypass — the fixed protocol values). The manifest's `slashCommands` drives the composer's `/`-prefix autocomplete: type `/` and the popover filters `manifest().slashCommands` by prefix (single-token only; a space turns it into an argument). Picking a command inserts `"/cmd "` into the draft so the user can add arguments before pressing Enter to send.

> The model is switchable live from the header: the `models` frame (from `Query.supportedModels()`) populates a `Select` that sends `{type:"set_model"}`; before the list arrives (or for a single-model login) the active model shows read-only.

> Reasoning effort is switchable the same way (FEATURE #63): the Effort `Select`'s options are the selected model's `effortLevels` (carried on the `models` frame — never hardcoded), labeled Low / Medium / High / Extra high / Max. Picking a level sends `{type:"set_effort"}` → `Query.applyFlagSettings({ effortLevel })`, and the choice persists (a transient `bismuth.chat.lastEffort` localStorage key, like the last model) so it's re-pushed to each new/resumed session on its first manifest and sticks across turns. The pure option/label/guard rules live in `app/src/chatEffort.ts` (unit-tested); the picker hides for a model that exposes no effort levels.

## Session history picker

The header's **Past conversations** button (a `MessagesSquare` icon) opens a popover (`HistoryPanel`) listing the user's existing Claude Code sessions for the vault — terminal *and* in-app, newest-first — fetched via `api.chatSessions()`. The vault daemon's own cron sessions are excluded (see [Unification with terminal sessions](#unification-with-terminal-sessions)): the chat page is the user's surface, so it lists only chats the user started. Each row shows the session summary (ellipsized, falling back to "Untitled session") plus a relative time ("just now", "5m ago", "2h ago", "3d ago", then a short date). Picking a row calls `resumeSession(sessionId)`, which:

1. clears the transcript (`resetTranscript`),
2. rehydrates the past turns by fetching `api.chatSessionMessages(sessionId)` and feeding every replayed frame through the **same** `onFrame` that handles live frames, then
3. binds the live socket to resume that session (`{type:"resume", sessionId}`), or stashes it as `pendingResume` if the socket isn't open yet.

The next message continues that conversation. The **Plus** button (`startNewChat`) swaps to a fresh chat id (`crypto.randomUUID()`) — a brand-new Claude Code session on the next message — and clears the view, without touching the tab. Both reconnect via `reconnectOn(id)`, which detaches the old socket's handlers before closing it so a deliberate switch never leaks a duplicate socket.

## Editor context injection

Every non-slash-command turn is prefixed with a compact `<editor-context>` preamble describing what the user is looking at — grounding for Claude, never something the user typed. Two pieces cooperate:

- **`app/src/chatContext.ts`** is a tiny module-level **singleton** mirroring `editorRegistry`, but for "which files is the user looking at": `publishEditorTabs(t: EditorTabsSnapshot)` (`{ openFiles: {path,label}[], activeFile: string | null }`) and `getEditorTabs()`. Plain module state, not reactive — consumers only ever want the freshest value at send time. `App.tsx` calls `publishEditorTabs` from a `createEffect` that re-derives `openContents()`/`focusedContent()` on every tab/pane open/close/focus change, filtering out sentinel content ids (`::graph`, `::chat:…`, terminals, …) via `isSentinel()` so only real note paths count as "open" or "active". The same module also tracks **per-chat file references** (Row 79) — `addChatReference(chatId, path)` / `getChatReferences(chatId)` / `clearChatReferences(chatId)` — the files the user explicitly `@`-mentioned in the composer or dragged onto the chat pane, keyed by chat tab id (capped at 50), folded into the preamble at send time and cleared once the turn is sent.
- **`app/src/chatEditorContext.ts`** `buildEditorContextText(input)` is the **pure**, unit-tested core of the preamble builder (split out of `ChatView` so it's testable headlessly). It takes `{ activeFile, openFiles, selection, selectionPath?, hiddenPaths, referencedFiles? }` and renders the `<editor-context>…</editor-context>` block: an `Active file:` line, an `Open tabs:` line (comma-joined paths), a `Referenced files:` line (Row 79), and, only when there's a live selection, a `Current selection (from <path>):` line with the selected text fenced in a code block. It **drops any path whose resolved AI visibility is "hidden"** (`hiddenPaths`) — active file, open tabs, selection, and references alike — so a hidden note's path/content never reaches the model through this channel (chat-only files stay in; see `docs/vault/visibility.md`). Returns `""` when there's no visible active file, selection, or reference. `ChatView.buildEditorContext()` gathers the live inputs (`getEditorTabs()`, the focused CodeMirror selection via `getFocusedSelection()`, `getChatReferences()`) and delegates the string-building here.

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

`[[wikilinks]]` in a rendered bubble (emitted as `a.bismuth-wikilink` with a `data-href`) open in-app via a delegated click that dispatches the global `bismuth-open` event. An assistant turn is an ordered list of **parts** — prose (`TextBubble`), collapsible thinking (`ThinkingBlock`, raw `<pre>`, not markdown), tool chips (`ToolChip`, with input/result detail and a pending spinner), permission cards (`PermissionCard`), and interactive question cards (`QuestionCard`, for AskUserQuestion) — plus an optional muted footer with the turn count and (only on API-key billing) the cost. A streaming turn with no parts yet shows a three-dot thinking indicator.

## The composer (`app/src/ChatComposer.tsx`)

The message input is **not a plain textarea** — it's a single-purpose **CodeMirror** editor (`app/src/ChatComposer.tsx`) that reuses the *same* shared markdown stack the note editor and table cells run (`markdownEditingExtensions` — live preview, markdown, math, `[[wikilink]]`/`#tag`/`:emoji:` autocomplete, bold/italic toggles), so the draft live-previews exactly like the note body while still round-tripping raw **markdown source** to the backend (never rendered HTML). It behaves as a plain input: **Enter** sends, **Shift+Enter** inserts a newline, paste/drop intake keeps working. Beyond the shared stack the composer adds only a highest-precedence keydown handler (delegated back to `ChatView` so slash-command nav / stop-on-Escape / prompt-history stay owned there — but *deferred* to CodeMirror while the vault autocomplete popup is open so it owns Arrow/Enter/Escape/Tab), two-way `value`/`onInput` binding, an imperative `{ focus, scrollIntoView }` handle, and a composer-only **`@file` mention** switcher (Row 79a) over every vault file whose pick calls `onFileMention(path)` → `addChatReference`. It computes the caret's first/last-visual-line **boundary** via CodeMirror's wrap-aware `moveVertically` so prompt-history recall only fires at the composer's top/bottom edge. Staged image attachments render as removable thumbnail chips above it.

## Client-side slash commands

Three slash commands are **intercepted client-side** by `ChatView` before a turn is sent — they act on the chat tab or app settings and never reach the model. `app/src/chatSlashCommands.ts` (pure, unit-tested) parses them:

- **`/rename <name>`** — set a custom title on this chat tab (empty arg reverts to the auto label).
- **`/color <swatch|hex|clear>`** — tint this chat's pane. The raw token is resolved by `resolveChatColorArg` in `app/src/chatColors.ts` (a named swatch like `blue`, a `#rgb`/`#rrggbb` hex, or a clear keyword `none`/`clear`/`off`/`default`/`reset` → revert); an unknown token surfaces an error rather than silently doing nothing.
- **`/chrome`** — toggle `settings.chat.computerUse` (the `--chrome` browser/computer-use capability; BUG #87).

`withClientSlashCommands(commands)` splices these names into the composer's `/`-autocomplete list (appended after the backend manifest's own, deduped) so they're offered from the moment the chat opens — the client analogue of `core/src/chat.ts`'s `LOCAL_SLASH_COMMANDS`/`withLocalSlashCommands` (which is for backend-answered commands like `/mcp`).

## Supporting frontend modules (pure, unit-tested)

`ChatView.tsx` is a large component; its rules are factored into small pure modules so they're testable without a live session, CodeMirror, localStorage, or a Solid signal:

- **`app/src/chatComposerKeys.ts`** — `classifyComposerKey(event, state)` decides what a composer keystroke *means* from the key + composer state, encoding the precedence: the slash popover owns nav first (`slash-nav`/`slash-select`), then a streaming-turn **Escape** interrupts (`stop`), then plain **Enter** sends (`send`), then ArrowUp/ArrowDown at the composer's top/bottom boundary recall prompt history (`history-up`/`history-down`), else `pass` (Shift+Enter newline, ordinary typing) falls through to CodeMirror.
- **`app/src/chatHistory.ts`** — shell-style prompt-history cursor: `buildHistoryEntries(sentTexts)` (oldest→newest, collapsing consecutive duplicates) plus `historyUp`/`historyDown` state-machine moves that stash the in-progress draft on first arrow-up and restore it on arrow-down past the newest entry (`HISTORY_BOTTOM` = resting state).
- **`app/src/chatQueueRestore.ts`** — `restoreQueuedComposerState(queued, current)`: when **Stop** is pressed mid-turn, still-queued follow-up messages (and their staged images) are restored *into the composer* — prepended above the current draft, blank-line separated — instead of discarded (Row 83).
- **`app/src/chatModelResolution.ts`** — `resolveInitialModel(persisted, reported)` keeps a session's spawn-default model from clobbering the user's persisted per-chat choice on the first manifest (Bug #89): `{adopt}` when nothing is persisted, `null` when already in sync, `{enforce}` to re-push the user's real choice.
- **`app/src/chatPermissionMode.ts`** — the permission modes (`default`/`plan`/`acceptEdits`/`bypassPermissions`), the app-level default (`bypassPermissions` — every chat starts in Bypass, BUG #14), `sanitizePermissionMode` (guard a persisted value), and `reconcilePermissionMode(desired, reported)` which stops a re-reported spawn default from reverting the user's chosen mode while still honoring a genuine server transition out of plan mode (FEATURE #35).
- **`app/src/chatEffort.ts`** — the reasoning-effort picker's data (FEATURE #63): `EFFORT_LABELS` (Low/Medium/High/Extra high/Max), `effortLabel`, `sanitizeEffort(raw, allowed)` (coerce a persisted level against what the selected model actually allows), and `effortOptionsForModel(modelValue, models)` (the picker's options are exactly that model's `effortLevels` from the `models` frame — never hardcoded; `[]` hides the picker).
- **`app/src/chatSessionStore.ts`** — `rememberChatSession`/`recallChatSession` persist each chat **tab** id → its SDK `session_id` in localStorage (`upsertSession`/`lookupSession` pure, capped 50), so **Reopen closed tab** (Cmd+Shift+T) resumes the *same* conversation instead of a blank one.
- **`app/src/chatColors.ts`** — per-chat pane tint keyed by tab id, persisted in localStorage and signal-backed for live re-tint: `CHAT_COLOR_SWATCHES` (8 preset hues), `upsertColor`/`lookupColor` (pure, capped 200), `resolveChatColorArg` (for `/color`), and reactive `chatColor(chatId)`/`setChatColor(chatId, color)`. The value is washed into the pane's `--bg` via `color-mix`.
- **`app/src/chatTitles.ts`** — a signal-backed per-tab title registry (`chatTitle`/`publishChatTitle`, keyed by tab id) populated from the backend's `title` frames, plus `resolveChatHeaderTitle(rename, title, fallback)` which matches the tab-label precedence (an explicit `/rename` override wins, else the backend session summary, else the daemon-persona / "Chat" fallback) so the header crumb and the tab agree.

## Tab routing, command, and keybinding

A chat tab is a sentinel pane content id: `CHAT_PREFIX + "<chat id>"`, where `CHAT_PREFIX = "::chat:"` (`app/src/tabIds.ts`). It labels as **"Chat"** with a `MessageSquare` icon (`contentLabel` / `contentIcon`). `PaneContent.tsx` routes `path.startsWith(CHAT_PREFIX)` to a lazily-loaded `<ChatView chatId={path.slice(CHAT_PREFIX.length)} />`.

The **`new-claude-chat`** command (catalog entry in `core/src/commands.ts`, label "New Claude Chat", icon `MessageSquare`; bound in `app/src/commands.ts`) runs `newClaudeChat` in `App.tsx`, which opens a fresh tab with a new uuid each time:

```ts
const newClaudeChat = () => openInNewTab(CHAT_PREFIX + crypto.randomUUID());
```

Its default keybinding is **`Mod+Shift+C`** (`core/src/keybindings.ts`, id `new-claude-chat`: "Open a new Claude Code chat session in its own tab."), dispatched in `App.tsx` via `matchesKeybinding(e, kb["new-claude-chat"])`.

---

Source: `core/src/chat.ts`, `core/src/server.ts` (`/chat` WS + `GET /chat/sessions` + `GET /chat/session-messages`), `core/src/schema/settingsSchema.ts` (`chat.computerUse`), `app/src/ChatView.tsx`, `app/src/ChatComposer.tsx`, `app/src/chatContext.ts`, `app/src/chatEditorContext.ts`, `app/src/chatComposerKeys.ts`, `app/src/chatHistory.ts`, `app/src/chatQueueRestore.ts`, `app/src/chatSlashCommands.ts`, `app/src/chatModelResolution.ts`, `app/src/chatPermissionMode.ts`, `app/src/chatEffort.ts`, `app/src/chatSessionStore.ts`, `app/src/chatColors.ts`, `app/src/chatTitles.ts`, `app/src/tabIds.ts`, `app/src/PaneContent.tsx`, `app/src/api.ts`, `app/src/App.tsx`, `app/src/commands.ts`, `core/src/commands.ts`, `core/src/keybindings.ts`.
