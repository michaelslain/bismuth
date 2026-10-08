# Visibility acceptance

Visibility acceptance is the record of what the [visibility controls](visibility.md) are verified to do, how each claim is checked, and what is explicitly not verified.
It is for engineers who change the controls, add an agent backend, or need to know how far to trust a "hidden" note.
A claim counts as verified only when a test or a recorded live run exercises that exact route or backend.
A mechanism that should work because it resembles a verified one is listed as not verified.

| Area | Verified | How |
|---|---|---|
| Resolving a note's level and building the deny list | Yes | Unit tests |
| `bismuth` CLI as an AI session, both entry paths | Yes | Tests that spawn the real CLI |
| HTTP content routes without the owner token | Yes | Server tests |
| Claude Code in-app chat, a direct read of a hidden note | Yes | Live test, opt-in |
| Claude Code sandbox options | Yes, as option shape | Unit tests |
| OS read-deny (Seatbelt) against real reads | Partly | One macOS-only test reads the token file under a real profile; the rest are hand-run probes |
| Any backend other than Claude Code enforcing the gate | No | Refusal is verified; enforcement is not |
| Linux and Windows | No | Not exercised |

## How is a claim verified?

Four kinds of evidence back the claims below.

- Unit tests call the pure resolvers and builders directly. They run in the normal suite.
- Spawned-CLI leak tests (`cli/test/visibilityLeak*.test.ts`) start the real `bismuth` binary the two ways an agent reaches it, with `BISMUTH_AGENT_CHANNEL` set (the CLI's own gate) and with only `BISMUTH_MCP_CHANNEL` set (the MCP path).
  Each case has an owner counterpart with neither set, proving the owner is not restricted.
- Server tests start a core server with an owner token and call routes with and without it.
- Live tests spawn a real `claude` and spend model calls. They run only when `BISMUTH_LIVE_TESTS=1` and the `claude` binary is present (`core/test/liveGate.ts`).

Everything else on this page that is not one of these is a hand-run probe, and the page says so.

### What fixture do the leak tests use?

`makeLeakVault` in `cli/test/visibilityLeak.ts` builds a vault with a hidden folder (`Private/`, set through `folderVisibility`), a second hidden folder (`Vault Hidden/`), a `chat-only` note at the root, a hidden template, a hidden calendar base, an ordinary visible note, and a git history.
Every note carries a unique token string.
A probe is a leak if a token or a hidden note's name appears in its output where the channel may not see it.
`expectVisibleFor` asserts that per channel: the owner sees every token, chat sees the visible and `chat-only` ones, and the daemon sees only the visible one.
A separate test pins the exact deny list per channel, so the fixture itself cannot drift.

## Deny-list resolution

Verified by `core/test/visibility.test.ts`, with the daemon's ported copy held to the same behaviour by `daemon/test/visibilityParity.test.ts` and `daemon/src/lib/visibility.test.ts`.

| Case | Verified |
|---|---|
| Own value beats ancestors; nearest ancestor wins; no rule gives `all` | Yes |
| A moved note re-resolves from its new path | Yes |
| `hidden` denies both channels; `chat-only` denies the daemon only | Yes |
| A folder rule covers every extension inside it | Yes |
| An explicit `visibility: all` inside a hidden folder exempts that file | Yes |
| Dot-directories are walked; `.git` and `.settings` are not | Yes |
| A hidden note's frontmatter is honoured on a non-`.md` copy, including a hard link | Yes |
| Frontmatter whose closing fence is past 512 bytes still parses; past 64 KiB it reads as `hidden` | Yes |
| A drawing's `.draw.png` and `.draw.pdf` exports inherit the drawing's level; an explicit `all` still wins for itself | Yes |
| A symlinked directory is walked; both absolute spellings are denied; a cycle ends; a symlink to a file is enforced | Yes |
| An unreadable subtree, a missing vault, a corrupt `.settings` or an exhausted entry budget is undetermined, not empty | Yes |
| An absent `.settings` is determined, with nothing restricted | Yes |
| Malformed rules read as `hidden`: unparseable closed YAML, a non-literal value | Yes |
| An empty `visibility:` inherits; an unclosed opening fence is not frontmatter | Yes |
| `.trash` is restricted whenever the channel restricts anything, including after a hidden folder is deleted | Yes |
| A `.base.jsonl` base takes its own value from line 1; an unparseable line 1 reads as `hidden`. The daemon's copy matches core on hidden, `chat-only`, unparseable and whitespace-padded line-1 fixtures | Yes, as core-and-daemon agreement |
| A memory note is gated by its own frontmatter and never by folder rules | Yes |
| Path comparison folds case, Unicode form, `.` and `..`; a `..` that cannot reach a hidden file stays allowed | Yes |
| The deny list also names the caller's own spelling of the vault root when it differs from the canonical one | Yes |

## The `bismuth` CLI as an AI session

Every case below runs through both entry paths. Each is refused or filtered for the daemon and the right subset for chat, and unrestricted for the owner.

| Route | Verified | Evidence |
|---|---|---|
| `read`, `write`, `move`, `delete` of a hidden path | Yes | `visibilityLeak.test.ts`, `visibilityLeakBypass.test.ts` |
| A second root (`--dir`) cannot swap the checked vault | Yes | `visibilityLeakBypass.test.ts` |
| A vault addressed by a subfolder | Yes | `visibilityLeakBypass.test.ts` |
| Rewriting the rules (`folder-visibility`, settings writes) | Yes | `visibilityLeakBypass.test.ts` |
| Folder tokens, respelled paths, doubled slashes, `--memory` used as a decoy | Yes | `visibilityLeakBypass.test.ts` |
| An extensionless path given to `base create` or `calendar create` is refused when its `.md` twin is hidden | Yes | `visibilityLeakBypass.test.ts` |
| An extensionless path whose `.base.jsonl` twin is hidden | No | The gate checks the twin; no spawned-CLI test covers it |
| `.daemon/processes` and the `.daemon` folder itself, even in an unrestricted vault | Yes | `visibilityLeakBypass.test.ts` |
| `api` as GET only, every running core's vault gated, percent-encoded paths | Yes | `visibilityLeakBypass.test.ts` |
| `api` cannot approve a status-bar command or reach doctor routes | Yes | `apiTrustRefusal.test.ts` |
| `search` and `replace` | Yes | `visibilityLeakSearch.test.ts` |
| `tree`, `templates`, `graph`, `note new`, `daily` | Yes | `visibilityLeakNotes.test.ts` |
| `task` and `card` commands, including archive and migrate | Yes | `visibilityLeakTasks.test.ts` |
| `calendar`, `gcal`, `relay` | Yes | `visibilityLeakCalendar.test.ts` |
| `base` and `rows` | Yes | `visibilityLeakBases.test.ts` |
| `memory` remember, forget and recall | Yes | `visibilityLeakMemory.test.ts` |
| `settings deny-list` returns a count, never a path, to an AI session | Yes | `visibilityDenyList.test.ts` |
| A vault whose visibility cannot be determined fails closed | Yes | `visibilityLeakWalk.test.ts`, `visibilityLeakTasks.test.ts` |
| `checkpoint diff`, `api`, `export`, `serve`, `chat`, `update` refuse in a restricted vault | Yes | `core/test/visibilityCliGate.test.ts` |
| An empty `BISMUTH_AGENT_CHANNEL` is the owner, not an agent | Yes | `core/test/visibilityCliGate.test.ts` |
| A command name with no tier refuses in a restricted vault | Yes | `core/test/visibilityCliGate.test.ts` |
| `app tabs` listing hidden note titles | No | Not tested; `app` is in the always-safe tier |

## The local HTTP API

`core/test/ownerToken.test.ts` and `core/test/server.test.ts` start a server and call each route without the token and with it. Without the token, a hidden note's content is absent or refused with 403; with the token, it is returned.

| Route | Verified without token | Verified with token |
|---|---|---|
| `GET /file`, `GET /meta`, `GET /base` | 403 | 200 |
| `POST /search`, `POST /rows`, `GET /vault-data` | Hidden hits and rows omitted | Included |
| `GET /graph` | Hidden nodes and edges dropped; no community label names a hidden note | Full graph |
| `GET /tasks`, `GET /tasks/migration` | Hidden tasks omitted | Included |
| `GET /abs-path`, `GET /cards/note` | 403 | 200 |
| `GET /asset` | Hidden bytes refused | Served |
| `GET /relay/snapshot` | Redacted | Full |
| `GET /chat/sessions`, `GET /chat/session-messages`, `POST /chat/search` | Refused | Served |
| Daemon cron, process and page deletes | Refused | Served |
| A request with no channel header | Filtered as `daemon`, the stricter channel | n/a |
| A mismatched or empty token | Not owner | n/a |
| Harmless routes such as `/version` | Stay open | Open |
| `GET /tree`, `GET /templates`, `GET /graph/views`, `POST /daily-note`, `GET /settings` | Not filtered | Not filtered |

The last row is not verified as safe. These routes take no per-channel filter, and an agent reaches them only through `bismuth api`, which is refused.

## Claude Code

Claude Code is the only backend whose chat and daemon enforcement is verified.

| Claim | Verified | Evidence |
|---|---|---|
| A chat asked to read a hidden note never surfaces its contents in any frame | Yes, live | `core/test/chat.test.ts` (needs `BISMUTH_LIVE_TESTS=1` and `claude`) |
| Both relative and absolute deny rules are emitted for each tool | Yes | `core/test/visibility.test.ts` |
| The sandbox block is omitted when nothing is restricted, and sets `failIfUnavailable: true` and `allowUnsandboxedCommands: false` when something is | Yes, as option shape | `core/test/chat.test.ts`, `daemon/test/session.test.ts` |
| The deny list carries the vault's `.git` and the owner-token file | Yes | `core/test/visibility.test.ts`, `core/test/ownerToken.test.ts` |
| A direct `canUseTool` check denies a restricted path in any case spelling | Yes | `core/test/visibility.test.ts` (`isDeniedPath`) |
| The chat and daemon disable Grep, Glob and `bismuth_cli` in a restricted vault | No | Wired in `core/src/chat.ts` and `daemon/src/daemon/session.ts`; no test asserts the list |
| A visibility change respawns the chat with a fresh deny list | No | Wired through `invalidateChatVisibility` and `respawnSession`; no test asserts it |
| The OS sandbox blocks a Bash `cat`, `python3 -c` or `bismuth read` of a hidden file | Observed by hand | An `EPERM` from the kernel in a live probe; the suite tests the same primitive only for the token file |
| `sandbox.failIfUnavailable: true` refuses a session whose sandbox cannot start | No | The condition could not be forced; the claim rests on the SDK's documented default for `Options.sandbox` and on the option-shape tests |
| `allowUnsandboxedCommands: false` ignores a model's `dangerouslyDisableSandbox` request | No | No live run has shown a model attempting it; the claim rests on the SDK field's documented semantics and the option-shape tests |

The SDK declares `failIfUnavailable` on two unrelated types with contradictory documented defaults. The type that governs `query()` documents `true`. Bismuth always passes an explicit boolean, so the default never decides behaviour.

## The OS read-deny wrapper

`core/src/agentBackends/sandboxWrapper.ts` is unit-tested for profile text (deterministic ordering, quote and non-ASCII handling), argument wrapping, the availability preconditions (platform, `sandbox-exec` present, backend does not sandbox itself) and the 0600 content-addressed profile file.
Those tests do not start `sandbox-exec`.

One test does.
`core/test/ownerToken.test.ts` spawns `/usr/bin/sandbox-exec` with a profile shaped like Claude Code's own read-deny profile, built from the real deny list.
Under it, `cat` of the owner-token run record fails and `cat` of a visible note succeeds, so the deny is selective and the token never reaches a Bash read.
The test is skipped off macOS.

Hand-run probes under a generated profile blocked `cat` of a hidden file, `grep -r` across the vault, `git show HEAD:<hidden>` and `git log -p`. These probes are not part of the suite.

## Other backends

| Backend | Chat | Daemon | Verified |
|---|---|---|---|
| opencode | Refused | Cannot run the daemon | Refusal: yes. Enforcement: no |
| Codex | Refused | Falls back to Claude Code | Refusal and fallback: yes. Enforcement: no |
| Cline, Gemini CLI, Goose, OpenClaw, Hermes Agent | Refused | Cannot run the daemon | Refusal: yes. Enforcement: no |
| Claude Code (ACP) and Codex (ACP) adapters | Refused | Cannot run the daemon | Refusal: yes. They sandbox themselves, so the wrapper cannot apply |

`core/test/agentBackends/visibilityGate.test.ts` verifies the refusals.
An unrestricted vault allows every backend, and Claude is allowed.
Every non-enforcing backend is refused for a restricted vault, an unknown backend id is refused, and an unreadable vault is refused.
`chat-only` restricts the daemon channel but not chat.
`daemon/test/session.test.ts` verifies the daemon fallback to Claude and that the refusal reason is carried onto the run's response.

Enforcement on these backends is not verified because no mechanism is verified:

- opencode.
  A wrapped `opencode run` turn showed its structured read tool and a Bash `cat` both denied.
  The dedicated Bash-`cat` probe and the probe that greps the whole project without naming the file did not complete, so the catalog holds opencode at `none`.
  A `launchctl submit` route that would start `cat` outside the wrapped process tree is an unexercised escape shape.
- Codex. It applies its own Seatbelt profile, which profiles cannot nest inside. Its own permissions layer is beta, and whether headless `codex exec` honours a project profile is unverified.
- Cline, Gemini CLI, Goose, OpenClaw, Hermes Agent. None has had a recorded live run under the wrapper. Gemini CLI's shipped search and shell tools bypass the ACP file-system capability; Cline's documented hooks do not cover its command and search tools.

## What is explicitly not verified

- Enforcement on any backend other than Claude Code.
- Linux and Windows. The wrapper is macOS-only, and Landlock and bubblewrap were never tried, so non-Claude backends are refused there.
- A sandbox that cannot start. `failIfUnavailable: true` is unit-tested but not observed.
- A model that asks to disable its sandbox (`dangerouslyDisableSandbox`).
- The owner's own browser embeds of a hidden binary. `GET /asset` filters by channel, and native `<img>` elements send no token header; how the app handles that for its own embeds is not tested here.
- The installed `bismuth-mcp` binary. It is a compiled copy that updates only when the app reinstalls it, so a machine installed before a gate change runs the older gate until `bismuth install` runs.
- Existence signals. A hidden path's name, size and modified time are visible, and the gate answers differently for hidden and missing paths. Both are accepted.

## How do I re-run the checks?

```bash
bun test core/test/visibility.test.ts core/test/visibilityCliGate.test.ts core/test/ownerToken.test.ts core/test/agentBackends
bun test cli/test/visibilityLeak.test.ts cli/test/visibilityLeakBypass.test.ts cli/test/visibilityDenyList.test.ts
BISMUTH_LIVE_TESTS=1 bun test core/test/chat.test.ts
```

Pass exact file paths; a bare directory argument matches substrings and can run more than you intend. The live run needs a working `claude` login and spends model calls.

Source: `core/test/visibility.test.ts`, `core/test/visibilityCliGate.test.ts`, `core/test/visibilityFilter.test.ts`, `core/test/ownerToken.test.ts`, `core/test/chat.test.ts`, `core/test/liveGate.ts`, `core/test/agentBackends/visibilityGate.test.ts`, `core/test/agentBackends/sandboxWrapper.test.ts`, `cli/test/visibilityLeak.ts`, `cli/test/visibilityLeak*.test.ts`, `cli/test/visibilityDenyList.test.ts`, `cli/test/apiTrustRefusal.test.ts`, `daemon/test/session.test.ts`, `daemon/test/visibilityParity.test.ts`, `daemon/src/lib/visibility.test.ts`
