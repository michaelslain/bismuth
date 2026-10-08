# Chat

A chat tab is a conversation with an AI coding agent that runs against your vault and renders as a live transcript inside Bismuth: streamed markdown, collapsible thinking, tool calls with their results, and inline permission prompts.
The agent is your own installed CLI (Claude Code by default) running under your own login, so there is no API key to enter.

A chat needs an agent CLI installed; [connect an agent](connect-an-agent.md) walks through first-time setup, compares chat with a terminal tab, MCP and the daemon's session, and covers restricting what an agent can read.

```text
Mod+Shift+C     open a new chat in its own tab
Enter           send            Shift+Enter    newline
Escape          stop the reply  Up / Down      recall earlier messages
/               commands        @              mention a note
```

## How do I open a chat?

Press `Mod+Shift+C` or run **New Claude Chat** from the command palette. The chat opens in its own tab, or in the focused pane when the tab is already split. Each press opens a new conversation.
The daemon page also hosts an inline chat with the same composer and controls ([daemon](../daemon/overview.md)).

A reply keeps streaming when you switch tabs or panes: the connection and transcript live in a session that outlasts the view. Closing the tab ends the session.

## What do I need installed?

A chat runs a CLI you have installed. Claude Code is the default; any other backend in the catalog works too ([backends](backends.md)). The CLI uses your own login, so Bismuth stores no API key. Because of that, a turn's cost appears in the footer only when Claude Code bills an API key.

If the chat's agent is not installed, the transcript is replaced by a three-line setup screen: a heading (`<agent> isn't installed`, or `no agent installed` for an `auto` chat with nothing installed), a row of one-click switches to every other installed agent plus `[free agent]`, and a footnote.
`[free agent]` downloads opencode and runs it on free models with no account (about 45 MB, and prompts may be kept); see [opencode providers](opencode-providers.md).
A vault that restricts notes shows a different screen when the chosen backend cannot enforce the restriction ([visibility](../vault/visibility.md#per-backendper-channel-enforcement)).

The default for new chats is the `chat.provider` key in `.settings`: `auto` (the default) uses the first installed backend, Claude first, or you can name one. A named backend is never swapped for another.

## What does the controls row do?

The controls row sits under the composer as one line of quiet text. At narrow widths the `history` and `new chat` words drop and only their icons remain.

| Control | What it does |
|---------|--------------|
| Model word | A lowercase word for what is answering, such as `opus (1m)`, or `default model`. Click it to open the model dialog |
| Permission mode | Default, Plan, Accept edits or Bypass. Shown only for backends with a mode picker |
| `history` | Opens past conversations. Shown only for backends that can list sessions |
| `new chat` | Starts a fresh conversation in this tab |

### The model dialog

The model dialog (titled `model // <connector>`) is the one panel for connector, model, effort and presets. Every pick applies at once and keeps the dialog open; close it with `[x]`, Escape or the backdrop.

- Left column. Your saved presets above the connectors (every backend not hidden from the picker). Clicking a connector switches backend and acts like **new chat**, because a conversation cannot change drivers mid-stream.
- Right column. The connector's models, `▸` on the active one, with a `free` or `paid` badge when the backend reports one. opencode models are grouped under their provider's name. With no models reported it shows `no models reported`.
- Effort. A toggle (low, medium, high, extra high, max) listing exactly the levels the selected model offers; it is hidden when the model offers one or none.
- opencode providers. With the opencode connector selected, the right column also hosts provider sign-in ([opencode providers](opencode-providers.md)).

A **preset** saves a connector, model and effort under a name. `[+ save]` names and saves the current combination (a same-named preset is replaced), and `[x]` on a row deletes it.
Picking a preset on the same connector switches model and effort in place; on another connector it switches connector and starts a new conversation. Presets live in `.settings` as `chat.presets`, so they belong to the vault.

### Permission modes

Every chat starts in **Bypass**, which lets the agent run tools, including writes to your vault, without asking. The Bypass label is tinted as the only warning that the agent is unconfirmed. Switch to Default to get an inline prompt for each tool not already allowed by your Claude Code config:

- **allow** approves this one call.
- **allow always** approves that tool for the rest of the session.
- **deny** refuses it, and the agent sees "Denied by the user".

Plan and Accept edits follow Claude Code's own meanings. Your last pick carries over to new chats. Closing a chat denies any prompt still open.

## How do I write a message?

The composer is a small markdown editor: live preview, `[[wikilink]]`, `#tag` and `:emoji:` autocomplete, and bold and italic toggles, the same as a note. What you send is the raw markdown source.

- Send and stop: `Enter` (or `Mod+Enter`) sends, `Shift+Enter` adds a newline, and `Escape` stops a streaming reply. `Up` and `Down` at the draft's first or last line recall earlier messages, like a shell.
  The keys are rebindable as `chat-send`, `chat-stop`, `chat-history-prev` and `chat-history-next` in [keybindings](../settings/keybindings.md).
- Slash commands. Type `/` for the commands the backend reports; the agent runs them as it would in its own TUI. `/mcp` is answered by Bismuth itself and lists connected, failed and needs-auth MCP servers.
  `/rename <name>` titles the tab (empty reverts to the automatic title), and `/color <swatch|hex|clear>` tints the pane; both stay in the app and never reach the model.
- Mention a note. Type `@` to search vault files, or drag a note from the file tree onto the chat pane. A referenced file is listed in the message's context for that one send.
- Attach images. Drop or paste an image. PNG, JPEG, GIF and WebP up to 10 MB each, about 12 MB per message, are sent to the model as images. A slash command cannot carry an image; if one is staged, the send is refused with an inline error.
- Queue a follow-up. A message sent while a reply streams is staged as a dimmed bubble and sent when the reply finishes. **Stop** restores staged messages and their images into the composer instead of discarding them.

### What does the agent know about my open notes?

Every message that is not a slash command is prefixed, invisibly, with an `<editor-context>` block: the active file, the open tabs, any mentioned files, and your current selection. When the focused pane is not a note (the knowledge graph, the daemon page, a terminal, export options) the block names that pane too. The transcript shows only what you typed.

The selection can come from anywhere in the app: a note, a PDF preview, rendered markdown, or text in the graph. It is capped at 8,000 characters. A chat split beside a note keeps reporting that note as the active file, and selecting text inside a chat does not replace or clear your selection.
Notes whose visibility is `hidden` are left out of this block entirely ([visibility](../vault/visibility.md)); `chat-only` notes stay in.

## How do I ask a quick question?

Press `Mod+K` (the `quick-ask` keybinding, rebindable in `.settings`) to open the chat in a popover beside what you are writing. In a note it opens at the caret; in any other pane it opens at the top of that pane. Press `Mod+K` again while it is open to focus its composer.

The popover is the chat itself, in a smaller box. The header shows the daemon's face and name (`chat` when the daemon is off), then `[ apply ]`, `[ open in chat ]` and `[ esc ]`. Under it are the chat tab's transcript, composer and controls row:

- **Pick the model** from the controls row under the composer (`model // mode // history // new chat`), exactly as in a chat tab.
- **Watch the agent work.** Tool calls (commands, searches, reads, edits), thinking and permission or question cards appear in the transcript as they happen.
- **Drag things in.** A file from the sidebar, a tab or a pane mentions it in the chat; a file, image or link from outside the app attaches it. The popover shows the dashed drop cue while a drag is over it. Paste, `@` mentions, `[[` links and `/` commands work in the composer.
- **Pick up where you left off.** Each note keeps its own quick-ask conversation: press `Mod+K` again in the same note (or over the same file in another pane) and the popover reopens on that conversation. A popover you close without sending anything is not kept.
- **Start over** with `[ new chat ]` in the controls row; `[ history ]` opens an older conversation in the same popover.

The popover never covers the caret line, so the text you asked about stays visible, and it grows up to a fixed height before its transcript scrolls. A click elsewhere in the app closes it; a drag that starts elsewhere does not. `Esc` closes it too, unless the composer is using `Esc` to stop a reply.

- **Asking does not edit your note.** The agent is told to answer briefly and not to edit until you press apply. On Claude, an attempted edit raises the normal permission card instead of running. The other backends (opencode, codex, the ACP ones) have no permission modes, so on them the instruction alone holds the agent back.
- **`[ apply ]`** appears for a quick ask opened in a note once there is a reply, and is pressable when the reply has finished. It saves the note's unsaved text, then asks the daemon to make the change; the daemon edits the file itself and your open editor reloads it. Anything half-typed in the composer stays there. After the apply finishes, the agent goes back to asking before it edits.
- **`[ open in chat ]`** moves the conversation into a chat tab and keeps streaming; that note's next `Mod+K` starts a fresh quick ask. **`[ esc ]`** closes the popover.
- **Only you can open it.** Opening starts or resumes an agent session, so an agent cannot open the popover through app control.

## How do I resume a past conversation?

Click `history` to open a dialog over the chat. It lists existing Claude Code sessions for the vault, terminal and in-app, newest first, grouped under `today`, `yesterday`, `past 7 days`, `past 30 days` and `older`. Type to search message text and titles instead.
Enter or a click resumes the row, replaying the earlier turns; the next message continues that conversation.

A **you / daemon / all** toggle chooses whose chats to list; it resets to `you` each time the dialog opens. Chats the vault's daemon started carry a bot icon, and the same icon marks the tab once you resume one. `Mod+Shift+T` (reopen closed tab) on a closed chat resumes its same conversation.

`history` appears only for backends that can list sessions. opencode and Codex conversations still resume per tab but are not in this list. From a shell, `bismuth chat list`, `bismuth chat read <id>` and `bismuth chat search <query>` read the same history ([CLI reference](../cli/reference.md)).

## What does the header show?

The chat header names the chat (a `/rename` title, else the conversation's summary) behind a glyph that marks daemon chats.
Two readouts appear on the right once data arrives: a `context [####......] 42%` meter, which turns danger-toned from 80%, and `N mcp servers down` when a configured MCP server is not connected. When all servers are connected the corner stays quiet.

## What goes wrong?

- `<agent> isn't installed`: Install the CLI, then reopen the chat, or switch with the row on the setup screen.
- A refusal screen about hidden notes. The vault restricts notes and the chosen backend cannot enforce that. Switch to Claude Code or lift the restriction ([visibility](../vault/visibility.md#per-backendper-channel-enforcement)).
- `No local model server answered at <url>`: `localModel` is on and the server is down or lists no models. Start it, or turn the setting off ([local models](local-models.md)).
- Every tool call prompts, or none do. The permission mode decides: chats start in Bypass. Pick Default for prompts.
- A reply stops after a reload. The session survives an abnormal disconnect for 30 seconds and the tab reconnects by itself. After that the session is closed; resume the conversation from `history`.

## How it works

### One session per chat

The Claude driver in `core/src/chat.ts` keeps a registry of sessions keyed by a client chat id, mirroring `core/src/terminal.ts`.
Each session holds one long-lived Agent SDK `query()`, an input mailbox that feeds it turns, the current output sink, the in-flight permission map and the always-allow set. A user turn pushes one `SDKUserMessage` onto the mailbox; `close()` ends the stream.
`query()` runs `claude` from `whichClaude()` as `pathToClaudeCodeExecutable`, with `cwd` set to the vault and the `claude_code` system-prompt preset, so relative paths and `CLAUDE.md` behave as in the TUI.

- No API. A missing `claude` sends `{type: "error", code: "no-claude"}` and returns. The driver never falls back to an API.
- Cost. With machine-login auth the SDK reports `apiKeySource: "none"` and a notional cost, so the `result` frame sets `costUsd` to `null` unless the source is something else.
- Permission mode: `permissionMode` is not set at spawn, so the SDK resolves the starting mode from your Claude Code config, and the client then enforces the app default (Bypass) or your last pick with `set_permission_mode`.
  `allowDangerouslySkipPermissions: true` is required for that: without it the CLI silently refuses to enter bypass and every tool call still prompts. The visibility deny rules are policy-tier, so they hold under Bypass.
- Effort is applied live with `Query.applyFlagSettings({ effortLevel })` and kept on the session so a visibility respawn re-applies it.
- Browser use: `--chrome` is passed (as `extraArgs: { chrome: null }`) whenever the catalog says the backend supports computer use, which today means Claude Code. There is no setting or toggle for it, and it needs a Chromium-based browser on the machine.
- The drain loop: `drain(session)` iterates the `query()` generator and translates each SDK message into frames. An error, including "Reached maximum number of turns", becomes an `error` frame rather than a crash, and a session that ended on its own is evicted so the next send respawns it.
- `sendMessage` and `resumeSession`: The first `sendMessage` for a chat id creates the session and starts the drain loop; later calls push a turn, cancel any pending teardown, refresh the sink and update `cwd`.
  `resumeSession` binds a chat id to an existing session with `options.resume`, pushing no turn, so the `init` manifest streams in; an existing session is closed first.

On the frontend, `app/src/chat/chatSessions.ts` retains one `ChatSession` (`chatSession.ts`) per open chat id, in its own reactive root, holding the WebSocket, transcript, draft, queue and picker state. `ChatView` is a disposable view over it.
Only a tab or pane close disposes a session, and its clean `ws.close(1000)` tears the backend session down. A chat tab is a pane content id `::chat:<chat id>` (`CHAT_PREFIX` in `tabIds.ts`) routed by `PaneContent.tsx`.

### The /chat WebSocket

`GET /chat?chatId=<id>[&rebind=1]` upgrades to a text-JSON protocol, behind the same origin allow-list as `/terminal`. The client sends commands discriminated by `type`.
The `open`, `user` and `resume` messages also carry an optional `provider`, which the server resolves with `resolveBackendId` before routing.

| Client message | Effect |
|----------------|--------|
| `{type: "open"}` | Spawn the session now, so the manifest, model list and permission mode stream before the first message. No-op when a session exists |
| `{type: "user", text, images?}` | Run a turn. `images` is `{media_type, data}[]`; entries with an unsupported MIME type or empty data are dropped |
| `{type: "resume", sessionId}` | Bind to an existing session |
| `{type: "permission_response", id, behavior, always?}` | Answer a `permission` frame |
| `{type: "question_response", id, answers?, cancelled?}` | Answer a `question` frame; `answers` maps each question's text to the chosen string, multi-select comma-joined |
| `{type: "set_permission_mode", mode}` | Switch permission mode live |
| `{type: "set_model", model}` | Switch model live |
| `{type: "set_effort", effort}` | Switch effort live |
| `{type: "stop"}` | Interrupt the in-flight turn, leaving the session resumable |

The server answers with `ChatFrame` messages, exported from `core/src/chat.ts`:

| Frame | Meaning |
|-------|---------|
| `manifest` | Per-turn `{model, permissionMode, slashCommands, tools, mcpServers}` from each SDK `init`; drives `/` autocomplete and the MCP-down readout |
| `assistant-text`, `thinking` | Streamed deltas |
| `user-message` | A past user turn, sent only during history replay; carries persisted images as `data:` URLs |
| `tool-use` | `{id, name, kind?, input}`; `name` labels the chip and the optional `kind` (`read`, `edit`, `search`, `execute`, from ACP) picks its icon |
| `tool-result` | `{id, content, isError}` |
| `permission` | `{id, toolName, input}`: asks the user to approve or deny |
| `question` | `{id, questions}`: 1 to 4 multiple-choice questions |
| `result`, `done` | A turn ended (`isError`, `numTurns`, `costUsd`), then fully drained |
| `models` | The models this login can run, each with `effortLevels` and an optional `free` flag; sent once per session |
| `title` | The conversation summary, which names the tab |
| `session` | `{sessionId, origin}`; the client stores it by tab id so reopening resumes the conversation |
| `context` | `{percentage, totalTokens, maxTokens}` after each turn |
| `auth` | opencode credential state; stored, not rendered |
| `error` | `{code, message, binary?, restrictedCount?}` with `code` one of `no-claude`, `no-opencode`, `no-binary`, `visibility-refused`, `local-model-unreachable`, `spawn`, `exit` or `error` |

`visibility-refused` carries a count of restricted notes and never their names. `no-binary` names a missing Codex or ACP CLI; the chat session maps all three missing-binary codes to the setup screen.

Assistant prose and thinking stream from `content_block_delta` events (`includePartialMessages: true`). When the final `assistant` message arrives, the loop skips blocks already streamed and emits only its `tool_use` blocks.
The single `translateSdkMessage(msg, { live })` function serves both the live loop (`live: true`) and history replay (`live: false`), so a replayed conversation renders like a live one.

### Messages, permissions and questions

`makeUserMessage` shapes the SDK message. With no images, the content is a plain string, which the CLI needs to run its own slash-command expansion; an array of blocks would reach the model as literal text and `/compact` would never run.
With images, content is an array: an optional text block, then one base64 image block per attachment. Bun silently drops a `/chat` frame over about 16 MB, which would leave a turn waiting forever, so the client caps one message's images at about 12 MB.

`canUseTool` fires only for tools your Claude Code settings do not already allow. A tool in the session's `alwaysAllow` set returns allow at once. Otherwise the driver emits a `permission` frame and parks the promise until `permission_response` arrives; teardown denies every parked prompt.

AskUserQuestion arrives through the same `canUseTool` channel, not `onUserDialog`, which does not fire for a programmatic `query()`. The driver intercepts the tool, normalizes its questions (`extractAskUserQuestions`), emits a `question` frame and parks the promise.
`buildAskUserQuestionAnswer` then returns `{behavior: "allow", updatedInput: {...input, answers}}`; a skip returns the input unchanged so the tool reports "no answer selected" and the turn continues.
A pending question blocks the turn from ending, so a follow-up sent meanwhile is staged and dispatched on `done`. Stop cancels every parked question.

`/mcp` is the one slash command answered locally. `isMcpCommand` matches a bare `/mcp`, and `answerMcpCommand` calls `Query.mcpServerStatus()`, formats it with `formatMcpStatus`, and emits an `assistant-text` reply followed by a synthetic `result` and `done`.
It never touches the input queue or the transcript, so it does not appear in replayed history.

### Editor context and memory recall

`app/src/chat/chatContext.ts` holds the freshest list of open files, the active file and per-chat `@` references; `App.tsx` publishes it on every tab change, filtering out non-note tabs.
`buildEditorContextText` (pure, in `chatEditorContext.ts`) renders the block and drops any path whose resolved visibility is `hidden`. Its input is `{ activeFile, activePane?, openFiles, selection, selectionPath?, hiddenPaths, referencedFiles?, instruction? }`. `Active pane:` names a pane that is not a file, labelled by `paneContextLabel.ts` (`knowledge graph (<mode>)`, `daemon page`, `terminal`, `export options for <path>`); only the export form names a path, which `extractEditorContextPaths` in `core/src/chat.ts` reads for the daemon gate. `Instruction:` is always the first line of the block, newlines collapsed: one line of guidance set per chat with `setChatInstruction(chatId, text)` in `chatContext.ts` and read back with `getChatInstruction`. The result is `""` when there is no visible active file, pane, selection, reference or instruction.

`App` publishes `activeFile`/`activePane` for the focused pane, or, when the focused pane is a chat, for the most recently focused non-chat pane of that tab. The selection comes from `app/src/chat/appSelection.ts`, which tracks document `selectionchange`: a CodeMirror selection (through `selectionInView`) carries its note path, and any other DOM selection carries the nearest `data-pane-content` path (null for sentinels). A collapsed selection outside a chat clears it; selections inside a chat surface (`[data-chat-surface]` or a `::chat:` pane) never replace or clear it, and selections in the export preview or outside any pane are never sent. `buildEditorContext()` in `chatSession.ts` gathers `getEditorTabs()`, `getAppSelection()` and `getChatReferences()` and delegates the string-building to `chatEditorContext.ts`. `send()` prepends it to the wire text only, and skips it for a slash command, since Claude Code recognizes a command only at the start of a message.
`stripEditorContext` removes the block again when a session is replayed, so a past bubble shows only what you typed.

When the vault's daemon is enabled, the driver passes two SDK hooks to `query()` that call the core recall service (`recallServiceFor`, `core/src/memoryRecall.ts`): `UserPromptSubmit` (mode `prompt`) and `PostToolBatch` (mode `tool`, once per batch of parallel tool calls).
The service dedups per session, so a note shown at the prompt is not injected again unless its content changed. The `daemon.recall.{enabled,midTurn,semantic}` settings are read live on every call. opencode's per-turn `system` recall uses the same service in mode `prompt`.

### Quick ask

`app/src/quickAsk/` holds the popover: `QuickAskHost` is mounted by `App.tsx`, `QuickAsk.tsx` renders it, `quickAskState.ts` owns its state and `quickAskLogic.ts` its pure placement and resume-list logic. The popover is anchored at the caret when focus is inside a CodeMirror note editor (the key fires while typing; CodeMirror binds no `Mod+K`), otherwise at the top of the focused pane. The `quick-ask` command (interactive, and in `UI_CONTROL_BLOCKLIST`) opens it the same way.

- **The body is `ChatSessionBody`.** `QuickAsk` hosts `chat/ChatSessionBody` in its `column` variant, the same body the daemon page uses, so the transcript, composer, attachments and `ChatControls` row are the chat tab's own components. The header row and placement are the popover's.
- **One chat per anchor key.** An anchor carries a `key`: the note path for a caret anchor, the focused leaf's content for a pane anchor. `openQuickAsk` looks the key up in the remembered list (`QuickChatEntry`, persisted under `bismuth-quick-ask-chats-v1`, capped at `QUICK_CHAT_CAP`; each window keeps its own copy as the source of truth and writes it through) and reuses that chat id, or mints `quick-<uuid>`. `App`'s retained-chat set (`chatContents`) includes `quickAskChatId()` while the popover is open, so the registry creates the `ChatSession`, which resumes the conversation from `chatSessionStore` like a reopened chat tab. `closeQuickAsk()` releases the session; `closeQuickAsk({ forget: true })`, used when no user turn was sent, also drops the list entry, the session-store entry and the provider key. An id that falls off the list is forgotten the same way.
- **Opening is a person's act.** The session starts or resumes when the popover opens, which is safe because `quick-ask` is refused to app control; the keybinding, the command palette and the toolbar are the only ways in. `[ apply ]` also requires a trusted click.
- **Asking is read-only on Claude.** Whenever the popover's session appears, the host sets the chat's instruction line (`setChatInstruction`: answer briefly, do not edit until the user presses apply) and puts the session in `default` permission mode with `ChatSession.setPermissionModeLocal(mode)`, so an edit attempt raises the permission card even though the app default is `bypassPermissions`. `setPermissionModeLocal` sets this session's mode, which the first-manifest push and every later manifest reconcile read, and sends `set_permission_mode`, but never writes the persisted last mode that `setPermissionMode` writes and every new chat reads. Backends with `permissionModes: false` in `core/src/agentBackends/catalog.ts` have no modes, so only the `Instruction:` line applies to them.
- **Apply.** `[ apply ]` flushes the note's unsaved buffer (`flushEditorByPath`), switches the session to `acceptEdits` locally and sends the apply message through the session's draft, restoring whatever was typed; the daemon edits the file and the open editor picks the change up through its normal external-change reload. When that turn's streaming ends, the host switches the session back to `default`.
- **Placement and dismissal.** `popoverPlacement` picks the side of the caret from the room alone (below when `PREFERRED_ROOM` fits or below is roomier), so growth never flips it, and returns a `maxHeight` of that room capped at `MAX_HEIGHT`. The panel is a portaled fixed layer with no backdrop. An outside press is a dismiss only when it lands in the app's own top-level layer and moves no more than `CLICK_SLOP` before release (`isClick`); presses in another portaled layer (the model menu, the history dialog) belong to that layer. `Esc` dismisses unless already `defaultPrevented` or focus sits in another layer.
- **Drops.** The panel uses `createChatDropTarget` with `capture: true`, so its native-drop listener claims a drop on the popover before the note editor underneath. It carries `data-chat-drop="<chatId>"`; `dnd/viewDrag.ts` resolves that to a `{ kind: 'chat' }` target ahead of panes, and `App` delivers a `mention` to that chat, lighting the popover's `DropCue` while the drag is over it.
- **Hand-off.** `[ open in chat ]` clears the instruction and adds a `::chat:<id>` tab to the active window, then `handOffQuickAsk()` clears the popover's hold on the id and drops its list entry; the session keeps its mode. The same `ChatSession` stays retained throughout, so the stream never reconnects.

### Connection lifecycle

A reconnect with the same `chatId` rebinds the session's sink (`chatRebindSink`), so frames from a turn in flight keep arriving. On socket close, code `1000` (an intentional tab close) tears the session down at once (`closeChat`).
An abnormal close (reload `1001`, drop `1006`) detaches the sink, so frames buffer, and schedules a teardown after a grace period (`BISMUTH_CHAT_GRACE_MS`, default 30 s).
The detach is identity-guarded: on a half-open drop the client's new socket may already have rebound the session, and the stale close must not kill it. The client reconnects with exponential backoff capped at 8 s and holds a `pendingResume` for a session picked before the socket opens.
Every session is closed on process exit, so headless `claude` children do not outlive a backend restart.

### Models and effort

Two namespaces matter. `Query.supportedModels()` returns short aliases (`default`, `sonnet`, `haiku`, `opus[1m]`), while each `init` manifest reports the fully resolved id the session runs.
`chatModelResolution.ts` (`modelsCorrespond`, `modelOptionFor`, `modelLabelFor`) maps between them, so the resolved id is never mistaken for drift and never replaces your saved alias.

A conversation owns its model. `chatSetModel()` stores the choice under the SDK `session_id` in `core/src/chatModelStore.ts` (`~/.bismuth/chat/models.json`, `BISMUTH_CHAT_DIR` overrides the directory, written atomically and capped), so it survives the packaged app's webview storage.
On resume, `createSession` preloads that model and the spawn-time manifest reports it, so the header is right before any turn.
On the client, a resumed session adopts its manifest's model; a fresh one enforces your last choice over the spawn default; a later genuine change, such as `/model`, is adopted per tab.
The `bismuth.chat.model.<id>` and `bismuth.chat.lastModel` localStorage keys are the instant warm-up and the default for new chats.

Effort works the same way: the toggle options are the selected model's `effortLevels` from the `models` frame (`chatEffort.ts`), and a pick sends `set_effort`. The last choice persists and is re-pushed to each new or resumed session on its first manifest.

### Unification with terminal sessions

The Agent SDK keeps one session store per `cwd`. The driver runs `claude` with `cwd` set to the vault, so terminal Claude Code sessions run from the vault and in-app chats share a store.
Three routes, defined in `core/src/routes/agents.ts`, expose it, and all three are owner-only: any caller whose `requestChannel(req)` is not `owner` gets 403. A past transcript can quote any number of notes, hidden or not, so there is no filtered subset to return.

- `GET /chat/sessions?scope=<user|daemon|all>` returns `{ sessionId, summary, lastModified, origin }[]`, newest first. `scope` defaults to `user`; `parseChatScope` coerces anything absent or unknown to it.
- `GET /chat/session-messages?id=<sessionId>&provider=<p>` replays a session as ordered `ChatFrame[]`. `sessionHistoryFrames` dispatches by provider to that backend's own store; the Claude path uses `translateSdkMessage` with `live: false`, and opencode replays from its store.
  An empty `id` returns an empty replay.
- `POST /chat/search {query, scope}` returns `{ hits }`, matching title and message text over the same store the list shows. It is a read despite the verb. An empty query returns no hits.

The daemon runs Claude sessions with the vault as `cwd`, so its sessions land in this store too. `scope=user` subtracts them and `scope=daemon` returns only them.
The daemon's ids come from the union of two files: `<vault>/.daemon/session-ids`, written by the daemon as it mints each session, and `<vault>/.daemon/session-ids-legacy`, written once by core (`core/src/chatDaemonLegacy.ts`) from a scan that recognizes sessions by the exact prompts the daemon composed.
A wrong match would hide your own conversation, so anything undecidable, such as an assistant-first transcript or a user merely discussing crons, counts as yours. The list paginates until it has `limit` sessions of the requested scope.

The CLI's `chat list`, `chat read` and `chat search` (`cli/src/commands/chat.ts`) wrap these routes. `cli/src/http.ts` attaches the per-boot owner token from `~/.bismuth/run/<vault>.json` when it can read it, which is what makes the CLI count as the owner.
The separation between your shell and an agent is `BISMUTH_AGENT_CHANNEL`, an environment variable Bismuth sets when it spawns an agent, not a cryptographic boundary. `chat` is left unclassified in `core/src/visibilityCliGate.ts`, so a restricted vault refuses it under an agent channel.
For a Bismuth-spawned agent, the real stop is the OS-sandbox deny-read on the run-record file.

### Frontend modules

The chat's rules sit in pure modules under `app/src/chat/`, each unit-tested, with the stateful half in `chatSession.ts` and the markup in components covered by stories.

| Module | Rule it owns |
|--------|--------------|
| `chatProvider.ts` | `CHAT_PROVIDER_OPTIONS`, `resolveChatProvider`, `providerCan`, per-backend model-key namespacing (a Claude model id must never seed an opencode `-m` flag) |
| `chatComposerKeys.ts` | `classifyComposerKey`: slash popover first, then Escape-to-stop, then send, then history recall, else pass to CodeMirror |
| `chatHistory.ts` | Prompt-history cursor that stashes the draft on the first Up |
| `chatQueueRestore.ts` | Stop restores queued messages into the composer |
| `chatPermissionMode.ts` | Mode values, the Bypass default, `reconcilePermissionMode` so a re-reported spawn default does not revert your pick |
| `chatSessionStore.ts` | Tab id to SDK session id, so Reopen closed tab resumes |
| `chatColors.ts`, `chatTitles.ts` | Per-tab tint and title precedence (rename, then summary, then fallback) |
| `chatImageIntake.ts` | The image MIME whitelist and size limits |
| `chatPresets.ts` | Preset list rules |

Messages render through `renderNoteBody`, the same markdown pipeline notes use, so math, code and wikilinks work; a `[[wikilink]]` in a bubble opens in the app. The daemon's face is the bot's avatar on the lowest assistant row, with a mood from `chatActivity.ts`.

Source: `core/src/chat.ts`, `core/src/chatModelStore.ts`, `core/src/chatDaemonLegacy.ts`, `core/src/memoryRecall.ts`, `core/src/routes/agents.ts`, `core/src/server.ts` (the `/chat` WebSocket), `core/src/chatProviders/index.ts`, `core/src/agentBackends/catalog.ts`, `core/src/commands.ts`, `core/src/keybindings.ts`, `cli/src/commands/chat.ts`, `cli/src/http.ts`, `app/src/quickAsk/`, `app/src/chat/` (`chatEditorContext.ts`, `appSelection.ts`, `paneContextLabel.ts`, `ChatView.tsx`, `ChatControls.tsx`, `ChatModelPicker.tsx`, `ChatSetupGate.tsx`, `ChatComposer.tsx`, `ChatHistoryModal.tsx`, `chatSession.ts`, `chatSessions.ts`), `app/src/tabIds.ts`, `app/src/PaneContent.tsx`, `app/src/api.ts`
