# OpenClaw offline coverage — final report

Branch `offline2/openclaw`, worktree `/Users/michaelslain/Documents/dev/bismuth-o2-openclaw`.

## Bottom line

**Full end-to-end coverage achieved.** A real `openclaw` binary, driven through Bismuth's own
unmodified production `CHAT_BACKENDS.openclaw` (chatProviders/acp/driver.ts), against a real
`openclaw gateway run` process, against the local mock LLM server — zero account API calls, zero
logins. Two genuine, pre-existing production bugs in Bismuth's openclaw integration were found and
fixed along the way (see below); without both fixes, no real user's openclaw chat in Bismuth could
ever complete a turn, mock or not.

## What openclaw's own source/docs actually say (with citations)

All citations below are from the installed package at `/opt/homebrew/lib/node_modules/openclaw`
(v2026.3.23-2, `openclaw --version`), read directly (`dist/*.js` is bundled/minified but readable,
`dist/plugin-sdk/src/**/*.d.ts` carries full TypeScript declarations) plus its bundled `docs/`.

1. **`openclaw acp` does NOT auto-start a Gateway.** `dist/acp-cli-BQ740PFm.js`'s `serveAcpGateway`
   only ever *connects* as a WebSocket client (`new GatewayClient({...}); gateway.start(); await
   gatewayReady`) and fails (`gatewayReady` rejects) if nothing answers. Confirmed by reading the
   function directly — no spawn/exec of a gateway process anywhere in that file.
2. **Gateway URL resolution** (`dist/call-CQbSO4Fr.js`'s `buildGatewayConnectionDetails`): CLI
   `--url` > `OPENCLAW_GATEWAY_URL` env > config `gateway.remote.url` (remote mode only) > a
   hardcoded local-loopback default `ws://127.0.0.1:<gateway.port ?? 18789>`. Default port 18789
   confirmed via multiple independent references (`dist/channel-Bvdwakg3.js:615`,
   `dist/onboard-remote-CeStL9YQ.js`'s `DEFAULT_GATEWAY_URL`, several `--help` texts).
3. **Model/provider routing config shape** — read directly from
   `dist/plugin-sdk/src/config/types.models.d.ts`: `ModelsConfig = { mode, providers:
   Record<string, ModelProviderConfig> }`, `ModelProviderConfig = { baseUrl, apiKey, auth, api,
   models: ModelDefinitionConfig[] }`, `MODEL_APIS` includes `"openai-completions"` literally.
   Cross-checked against `docs/gateway/local-models.md`'s own worked LM Studio/vLLM examples (same
   shape) and `openclaw config validate` accepting the file live.
4. **`agents.defaults.workspace` is required** — `docs/concepts/agent.md`: "OpenClaw uses a single
   agent workspace directory (`agents.defaults.workspace`) as the agent's **only** working
   directory... for tools and context." `agents.defaults.skipBootstrap: true` (same doc) skips
   BOOTSTRAP.md/AGENTS.md template seeding.
5. **Gateway requires `gateway.mode: "local"`** (or `--allow-unconfigured`) to start locally —
   `openclaw gateway run --help`; confirmed live that setting `gateway.mode: "local"` in config
   makes `--allow-unconfigured` unnecessary.
6. **A genuinely unrelated feature reserves the `acp:` session-name prefix.** OpenClaw has its OWN
   outbound multi-agent orchestration ("spawn an external ACP-speaking sub-agent",
   `docs/tools/acp-agents.md`, driven by `/acp spawn`) that is completely separate from the `openclaw
   acp` bridge command. `dist/session-key-DAhnzjyr.js`'s `isAcpSessionKey` treats ANY session name
   starting with `acp:` as belonging to that other feature; `dist/manager-Bw8JrihM.js`'s
   `AcpSessionManager.resolveSession` then requires such a session to already be spawn-bound, or it
   returns `{kind:"stale", error: "ACP metadata is missing... Recreate with /acp spawn"}`. The ACP
   bridge's OWN default session naming (`acp-cli.js`'s `newSession`: `fallbackKey:
   "acp:${sessionId}"`) collides with this — see "Bug #1" below.
7. **`session/new` rejects a non-empty `mcpServers` array outright.**
   `dist/acp-cli-BQ740PFm.js`'s `AcpGatewayAgent.assertSupportedSessionSetup`: `if
   (mcpServers.length === 0) return; throw new Error("ACP bridge mode does not support per-session
   MCP servers. Configure MCP on the OpenClaw gateway or agent instead.")`. Documented too
   (`docs/cli/acp.md`'s compatibility matrix: "Per-session MCP servers (mcpServers) | Unsupported").

Nothing above was guessed — every config field, default, and error path was either read from the
package's own `.d.ts` declarations / bundled source, or reproduced live and cross-checked against
the bundled docs.

## What was stood up

- A real `openclaw gateway run` process (`core/test/support/openclawGateway.ts`), isolated via
  `OPENCLAW_CONFIG_PATH`/`OPENCLAW_STATE_DIR` pointed at throwaway temp dirs — never reads or writes
  the real `~/.openclaw` (confirmed: `find ~/.openclaw -newer <repo file>` showed zero touched files
  after the whole session's testing).
- `core/test/support/backendEnv.ts`'s `openclaw` case writes the full config both the Gateway and
  the ACP bridge share: `gateway.mode/port/bind/auth`, `canvasHost.enabled: false`,
  `browser.enabled: false` (both otherwise auto-start their own HTTP/CDP listeners on boot — a real
  hygiene finding, confirmed live via extra ports appearing in the startup log), `update.checkOnStart:
  false` (a bare config performs a REAL outbound update-check HTTP request on startup — confirmed
  live, `"[gateway] update available (latest): v2026.7.1-2..."` — not an account call, but real
  unwanted egress; suppressed), `agents.defaults.workspace`/`skipBootstrap`, and
  `models.providers.mock` pointed at the mock LLM.
- A free TCP port picked via `core/test/support/openclawGateway.ts`'s `getFreePort()` (openclaw
  rejects `--port 0`: "Too small: expected number to be >0", unlike llmock's own `-p 0`).
- `core/test/chatProviders/openclawMocked.test.ts`: gated on `whichBinary("openclaw") !== null`
  (missing-binary skip, never missing-account), drives `CHAT_BACKENDS.openclaw.sendMessage` and
  asserts the fixture's `"Hello!"` arrives as `assistant-text`, then `result:{isError:false}`, then
  `done`, PLUS a path-specific `/metrics` counter delta on `POST /v1/chat/completions` (never the
  mere presence of a metric name — see `chatCompletionsHitCount`'s doc comment, matching
  `geminiMocked.test.ts`'s own established pattern for this exact failure mode).

## Two real bugs found and fixed (not test artifacts — these affect every real user)

**Bug #1 — default ACP-bridge session never completes a turn.** Bismuth's old `ACP_AGENTS` entry
(`args: ["acp"]`, no `--session`) let openclaw pick its own default `acp:<uuid>` session name, which
collides with the unrelated reserved-prefix feature above (source item #6). Every fresh
`session/prompt` failed with `ACP_SESSION_INIT_FAILED`, mock or real, for any user. **Fixed**: added
`--session agent:main:bismuth` to the openclaw entry in `core/src/chatProviders/acp/agents.ts`
(documented pattern per `docs/cli/acp.md`'s own usage examples). **Known limitation, not fixed**:
this session key is static per-backend, not per-chat, so concurrent Bismuth chats through openclaw
currently share one Gateway session/transcript — a real per-chat fix needs driver.ts's
`spawnAcpProcess` to inject a chat-id-derived session key dynamically; flagged inline as follow-up
work, not attempted here (higher-risk surgery to shared driver code, out of this task's scope).

**Bug #2 — non-empty `mcpServers` crashes every session on a machine with Bismuth's MCP tools
installed.** `driver.ts`'s `createSession` always builds a non-empty `mcpServers` array when
`~/.bismuth/bin/bismuth-mcp` exists (true for any user of the bundled app). OpenClaw's bridge
outright rejects this (source item #7) — reproduced live via a raw JSON-RPC `session/new` carrying
one `mcpServers` entry, which returned `{code:-32603, message:"Internal error",
data:{details:"ACP bridge mode does not support per-session MCP servers..."}}` (the "Internal error"
wrapper is openclaw's own transport flattening any thrown exception to -32603; the real reason only
survives in `error.data.details`, which `driver.ts`'s `AcpRpcError` does not currently surface —
noted inline, not fixed, since it's a diagnostics-only gap not blocking this task). **Fixed**: added
`AcpAgentSpec.supportsSessionMcpServers: false` on the openclaw entry; `driver.ts`'s `createSession`
now sends `[]` for any agent with that flag. **Consequence, stated plainly**: openclaw chats get NO
Bismuth MCP tools (bismuth_cli/docs/memory) — openclaw's own docs point at a different mechanism
("Configure MCP on the OpenClaw gateway or agent instead", the user's own openclaw config) that
Bismuth cannot drive per-session and does not attempt to.

**Secondary accuracy fix**: `core/src/agentBackends/catalog.ts`'s `OPENCLAW` descriptor inherited
`mcp: "cli"` from the shared ACP capabilities object — now false for openclaw specifically per Bug
#2. Overridden to `mcp: "none"` with a comment explaining why `memory: "mcpOnly"` is also effectively
moot for it (no "none" variant exists in `MemoryInjectionMode` to override to; neither field is read
anywhere outside `catalog.ts` today, confirmed live, so this is a documentation-accuracy fix, not a
behavior change).

Both bugs were found by driving the REAL production driver (not a hand-rolled test-only client) and
comparing against a hand-rolled raw-JSON-RPC script that (initially, misleadingly) succeeded — the
raw script always passed `mcpServers: []`, which is what exposed that the driver's own default
differs from what a minimal manual reproduction uses. This is exactly the kind of gap "test through
the real driver, not a synthetic proxy" is meant to catch.

## Every new assertion, and its sabotage result

All three were sabotaged (broken), confirmed to fail, then reverted to the correct form. `git diff`
on the test file is clean (no sabotage markers remain).

1. **Fixture text** (`expect(assistantText.text).toBe("Hello!")`) — sabotaged to `.toBe("hello")`
   (the lowercase prompt text, not the fixture's reply). Result: `Expected: "hello" / Received:
   "Hello!"` — failed as expected.
2. **Path-specific `/metrics` counter delta** (`expect(after).toBeGreaterThan(before)`, where
   `chatCompletionsHitCount` filters on `path="/v1/chat/completions"`) — sabotaged by changing the
   filter to a path that's never hit (`/v1/does-not-exist`). Result: `Expected: > 0 / Received: 0` —
   failed as expected (proves the counter is reading the real hit, not vacuously true).
3. **`isError`** (`expect(resultFrame.isError).toBe(false)`) — sabotaged to `.toBe(true)`. Result:
   `Expected: true / Received: false` — failed as expected.

Every sabotage was run via `bun test core -- openclawMocked`, confirmed to produce exactly one
failing assertion (not a hang, not an unrelated error), then reverted and re-confirmed green before
moving to the next.

## Hygiene confirmed

- `git status --short`: exactly the 6 modified + 2 new files below — no stray temp/scratch files.
- No process leak: `ps aux | grep -iE "openclaw|aimock"` empty after every test run (including a
  belt-and-suspenders `pgrep`-based check inside the test's own `afterEach`, which throws loudly on
  a match rather than silently passing).
- `~/.openclaw` untouched (see above) — all state/config routed through
  `OPENCLAW_CONFIG_PATH`/`OPENCLAW_STATE_DIR` into `mkdtemp` temp dirs, cleaned up in `afterEach`.
- Env save/restore snapshotted before any call that can throw (`OPENCLAW_CONFIG_PATH`/
  `OPENCLAW_STATE_DIR`), restored in `afterAll`.
- No `--record`/`--proxy-only`/`--provider-*` flags anywhere; `llmock` started via the existing
  `startMockLlm()` (never a bare `bunx llmock`).

## Files touched

- `core/src/chatProviders/acp/agents.ts` — Bug #1 + #2 fixes (openclaw entry: `--session`,
  `supportsSessionMcpServers: false`), new `AcpAgentSpec.supportsSessionMcpServers` field.
- `core/src/chatProviders/acp/driver.ts` — one-line consumer of the new flag in `createSession`.
- `core/src/agentBackends/catalog.ts` — `OPENCLAW` descriptor's `mcp: "none"` override + comment.
- `core/test/support/backendEnv.ts` — `openclaw` case rewritten to write the full, live-verified
  config (was previously model-routing-only, unrun); vocabulary header updated.
- `core/test/support/openclawGateway.ts` — new: Gateway process lifecycle (spawn/banner-wait/kill),
  `getFreePort()`.
- `core/test/chatProviders/openclawMocked.test.ts` — new: the end-to-end test.
- `core/test/support/mockLlm.test.ts` — updated the two existing drift-guard tests for the new
  required 4th `openclawGatewayPort` argument.
- `docs/contributing/testing.md` — table row + paragraph updated to match what's now proven.

## Done-means checklist

- `bun test core`: **2011 pass, 16 skip, 0 fail** (13324 expect() calls, 133 files) — clean, includes
  the new openclaw test running for real (binary present on this machine) plus 6 skips for
  codex/gemini/cline (not installed here).
- `bunx tsc --noEmit` clean in `core/`, `app/`, `mcp/`, `relay/` (all four checked).
- No orphan processes after any run.
