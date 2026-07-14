# Chat providers (Claude Code / opencode)

Each chat tab runs on a **provider** — the CLI that actually drives the conversation. Two are supported:

| Provider | Binary | Driver | Session model |
| --- | --- | --- | --- |
| `claude` (default) | the user's `claude` | `core/src/chat.ts` — one long-lived Agent-SDK `query()` per chat | SDK session store (unified with terminal sessions) |
| `opencode` | the user's `opencode` (resolved like `claude`, via the augmented `claudeLookupPath`) | `core/src/chatProviders/opencode.ts` — one `opencode run --format json` subprocess **per turn**, continued with `-s <sessionID>` | opencode's own store (`ses_…` ids; history via `opencode export`) |

Both speak the **same `ChatFrame` wire protocol** over the `/chat` WebSocket, so `ChatView` renders either without provider-specific rendering code. The seam is `core/src/chatProviders/index.ts` (the router) + `core/src/chatProviders/opencodeTranslate.ts` (the pure event translation, unit-tested in `core/test/chatProviders/`).

## Picking a provider

- **Per chat**: the header's provider `Select` (next to the model picker). Switching acts like **"New chat" on the other provider** — a conversation can't hop drivers mid-stream, so the transcript clears and a fresh session spawns. The choice is persisted per tab (`bismuth.chat.provider.<tabId>`, a transient localStorage key like the per-chat model) and latched the moment a session spawns, so a later settings edit can't flip a live tab's header away from its backend.
- **Default for new tabs**: the `chat.provider` key in `.settings` (`"claude" | "opencode"`, schema-validated — `core/src/schema/settingsSchema.ts`).

On the wire, the client's `open` / `user` / `resume` frames carry `provider`; the server resolves it with `resolveChatProvider(requested, settingsDefault)` and routes through the router. **Routing rule**: a chatId with a live session anywhere stays on that backend (conversation continuity beats a stale field); only session-creating verbs honor the requested provider.

## How the opencode driver works

Verified live against opencode **1.17.15**:

- Each turn spawns `opencode run --format json --auto [-s ses_…] [-m provider/model] <text>` with `cwd` = the vault (so the model works against the user's notes, same as Claude). stdout is NDJSON — one event per line:
  - `text` parts arrive **complete per part** (opencode run does not stream deltas). The translator (`translateOpencodeEvent`) tracks per-part emitted length and emits only the unseen suffix, so it also tolerates a future cumulative-streaming shape.
  - `tool_use` events arrive with `state.status: "completed" | "error"` already resolved → one `tool-use` frame + its `tool-result` together.
  - `reasoning` parts → `thinking` frames; `step_finish` accumulates `cost` (surfaced on the `result` frame only when > 0 — free/subscription models report 0).
- `--auto` auto-approves tool permissions not explicitly denied by the user's own opencode config — the same effective posture as the app's Claude default (Bypass). Non-interactive `run` mode has no way to park on a prompt.
- The session id (`ses_…`) is captured off the first event and emitted as a `session` frame; the client persists it per tab (`chatSessionStore`), and a reopened tab **resumes** the conversation: history replays via `GET /chat/session-messages?id=ses_…&provider=opencode` (backed by `opencode export`, translated by `translateOpencodeExport`) and the next turn runs with `-s`.
- The model picker is populated from `opencode models --verbose` (fetched once per core process; falls back to the plain id list on an older opencode). The verbose metadata yields each model's **display name** (label; name collisions across providers get ` (providerID)` appended) and its **cost** — `cost.input === 0 && cost.output === 0` classifies it **Free** vs **Paid**, rendered as a right-side badge on each row of the header model picker (`parseOpencodeModelsVerbose`, `modelPriceBadge`). Claude models carry no `free` field → no badge. `set_model` validates the `provider/model` shape so a stale Claude model id can never ride `-m`. Model persistence is **provider-scoped** client-side (`app/src/chatProvider.ts` `modelStorageKeys`): claude keeps the original localStorage keys, opencode gets its own (`bismuth.chat.model.oc.*`), so the two never cross-contaminate a spawn.
- Error events nest their real message under `error.data.message` (verified live: a Zen 401) — `opencodeErrorMessage` digs it out shallowest-first. And a run that streamed an error event still **exits 0**, so the `result` frame reports `isError` when either the exit code was non-zero **or** an error frame went out.
- Missing binary → a `{ type: "error", code: "no-opencode" }` frame; `ChatView` renders a provider-specific setup screen (install hint + a one-click "Use Claude Code instead" switch). The same screen exists in reverse for a missing `claude` — the provider picker stays usable either way.

## opencode-native surfaces (commands, auth, Zen free rotation)

Three opencode-specific affordances (all pure parts unit-tested in `core/test/chatProviders/opencodeTranslate.test.ts` + `app/src/chatProvider.test.ts`):

- **Command autocomplete** — opencode's command registry rides the manifest, so typing `/` in the composer autocompletes opencode commands exactly like Claude's. The registry is `opencode debug config`'s resolved `command` key (config-dir commands + `opencode.json(c)` `command` entries + **plugin-registered** commands) merged with the built-ins `/init` and `/review` (`parseOpencodeDebugConfigCommands` + `withOpencodeBuiltinCommands`; fetched once per core process, sequential with the models fetch — opencode's sqlite rejects concurrent cold-start openers). Descriptions ride the manifest's `commandDetails` and show in the "/" popover. A sent turn whose text leads with a **known** `/command` runs as `opencode run --command <name> <args>` (`parseOpencodeRunCommand`); an unknown `/word` flows through as prose. TUI-only actions (`/undo`, `/redo`, `/share`, `/models`, `/connect`…) are deliberately not offered — they aren't registry commands and can't run through `opencode run`.
- **Auth pill** — the header shows the opencode credential state (`opencode auth list`, parsed by `parseOpencodeAuthList`, emitted as an `auth` frame per session open). The popover lists stored providers (name + kind) and gives the login path: `opencode auth login` is an interactive CLI wizard (providers, API keys, **opencode Zen**), so the popover offers **Open terminal** (opens a Bismuth terminal tab via the `bismuth-open-terminal` event) and **Copy command**. After logging in, a new chat / reopen refreshes the pill (`auth` is re-fetched per session open). Not signed in renders in the danger tint.
- **Zen Free (rotating)** — opencode Zen's free roster is promotional and rotates over time. When Zen currently offers free models (`cost.input === 0 && cost.output === 0` on `opencode/…` ids), the model picker gains a virtual **"Zen Free (rotating)"** entry (`withZenFreeRotate`, id `bismuth/zen-free-rotate`) pinned to the top with a Free badge. Selecting it makes each turn round-robin a REAL free Zen model (`pickZenFreeModel` — turn N runs free model N mod roster size); the virtual id is resolved in `runTurn` and never reaches the CLI. An empty roster hides the entry (and, if somehow selected, falls back to opencode's own default model).

## Graceful degradation (what opencode sessions don't have)

Claude-specific surfaces are **hidden, not broken**, for opencode sessions (`providerSupportsClaudeControls`, `app/src/chatProvider.ts`):

- **Permission mode picker** — `opencode run` is non-interactive (`--auto`); there are no live permission frames to answer.
- **Effort picker** — hides itself: opencode models carry `effortLevels: []` on the `models` frame.
- **`--chrome` (browser/computer-use) toggle** and the `/chrome` slash suggestion.
- **Session history picker** — it lists the Claude Code SDK store; opencode conversations still resume per tab (see above), they just don't appear in the cross-session picker.
- **Claude's own slash commands** — the manifest instead carries **opencode's** command registry (see above); the provider-agnostic client-side commands (`/rename`, `/color`) are offered on both.
- **Image attachments** — `opencode run` has no attachment flag; sending one returns a friendly error frame suggesting the Claude provider.
- **Memory auto-recall / capture** (daemon 3rd-brain) and the **agents-graph chat node** are Claude-session features today; opencode sessions don't participate.

Everything else — streamed markdown prose, tool chips with results, thinking sections, editor-context preambles (`<editor-context>`), queued mid-turn messages, Stop, reconnect buffering with the 30s grace window, per-tab titles — works identically on both providers.
