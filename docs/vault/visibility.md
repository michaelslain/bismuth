# Visibility Controls: Per-File/Folder AI Restrictions

Visibility lets you mark a note or folder off-limits to Bismuth's own AI surfaces — the daemon and the in-app chat, across every backend Bismuth can drive — without touching your own access to it. This document covers the storage format, the discovery walk, the per-backend/per-channel enforcement mechanism (including what was empirically verified and what wasn't), the ambient surfaces that had to be closed before any per-backend mechanism could mean anything, the UI, and the honest limits of what this feature does and does not protect.

This page is unusually candid about what is proven and what isn't, on purpose — see "The recurring failure mode" in [../chat/backends.md](../chat/backends.md). That stays true here: a row below claiming "enforced" is a claim that a mechanism is wired **and** was verified live, not that it *should* work because it is "the same primitive" as a verified one.

---

## Threat model

Visibility is an HONESTY boundary, not a security boundary. It stops Bismuth's own agent sessions — the daemon, and the in-app chat on whichever backend it's driving — from reading a marked file through their normal tool calls or through Bismuth's own local surfaces (the HTTP API, the `bismuth` CLI). It does NOT restrict: your own interactive terminal sessions, however you invoke them (a bare `claude`/`opencode`/… in a shell, or a Bismuth terminal tab) — they run as you, with full OS filesystem access, and are deliberately never signalled as an agent channel; you yourself using Bismuth's editor, file tree, graph, or the `bismuth` CLI **run as yourself**; or content already copied into a memory note before a file was hidden.

**What changed since the first pass (Claude-only):** the original implementation gated exactly one backend (Claude Code) through one mechanism (the Claude Agent SDK's `managedSettings`/`sandbox`/`disallowedTools` triple), and a red-team pass found that the gate was weaker than it looked — not because the Claude-specific mechanism was wrong, but because of surfaces that had nothing to do with Claude at all: an unauthenticated local HTTP API that could be `curl`'d from inside a correctly-gated session, the `bismuth` CLI itself reachable as a plain subprocess, the vault's own git history holding a hidden note's plaintext from before it was hidden, a case-insensitivity bug in the path comparison, and an MCP tool gate with real coverage gaps. **Those are fixed first** (see "Ambient surfaces" below) — a per-backend mechanism is a lock on a door beside an open window until they are, and closing them is what makes it honest to say Claude's own gate was ever real. On top of that, Bismuth now drives nine backends, so `capabilities.visibilityGate` became a **per-channel, per-backend, mechanism-naming value** instead of a single boolean — see "Per-backend/per-channel enforcement" below for exactly which backend+channel pairs are enforced, wrapped, or refused, and how each was verified.

**What this means day to day:** marking a note "Hidden from both" keeps it out of the daemon's crons, its memory recall, and the in-app chat's tool calls and editor-context preamble — **when the chosen backend can enforce that at all**; a backend that can't is refused outright rather than run unprotected (see below). It does NOT stop you from opening it in the editor, seeing it in the file tree or graph, or reading/editing it via `bismuth` CLI commands or your own terminal session. A residual gap also exists for content captured into a memory note *before* the file was marked hidden — visibility is resolved at read/gate time from current settings, not retroactively scrubbed from history.

---

## Storage format

**File level** — a frontmatter key on the note itself:

```yaml
---
visibility: hidden      # or "chat-only"
---
```

- **Absent = INHERIT**, not "visible" — this is the semantic choice that makes folder inheritance work (see below).
- An explicit `visibility: all` is also accepted (rare — see "explicit override" below) and means "always visible, regardless of any ancestor folder's setting."
- Written via the **existing generic property routes**, no new file-side plumbing: `POST /set-property {path, key:"visibility", value}` / `POST /delete-property {path, key:"visibility"}` (`core/src/server.ts`), calling `setFrontmatterKey`/`deleteFrontmatterKey` (`core/src/frontmatter.ts`); client `api.setProperty`/`api.deleteProperty` (`app/src/api.ts`).

**Folder level** — folders have no frontmatter, so their setting lives in `.settings`, a structural clone of `folderIcons`:

```yaml
folderVisibility:
  Private: hidden
  drafts/wip: chat-only
```

- Schema entry beside `folderIcons` (`core/src/schema/settingsSchema.ts`).
- `readFolderVisibility`/`setFolderVisibility` in `core/src/settings.ts` (same `withSettingsMutex`, corrupt-file bail, YAMLMap get-or-create pattern as the folderIcons trio).
- `POST /folder-visibility` (`core/src/server.ts`) — a structural copy of `POST /folder-icon`: same vault-relative traversal guard, same synchronous `appConfig` patch (avoids a stale-flash on the client's immediate `GET /tree` refetch), same `() => SETTINGS_FILE` cache invalidation. Client: `api.setFolderVisibility(path, visibility)`.

**No third store**: `.daemon/memory/*.md` notes are ordinary vault files when read through the vault's own frontmatter path, but the shared `@bismuth/memory` package has its OWN note model (a fixed `NoteFrontmatter` struct, not raw YAML passthrough) — so memory notes carry their own `visibility?: "chat-only"|"hidden"` field, parsed/serialized by `memory/src/graph.ts` alongside `type`/`tags`/`created`/`updated`. Memory notes are flat under `.daemon/memory` (no subfolders in practice), so there is no folder-cascade tier for them — just the note's own explicit value. See "Memory recall" below.

---

## Inheritance semantics: nearest-ancestor-wins + explicit-file-override

Pure, unit-tested module: `core/src/visibility.ts` (mirrors `core/src/daemonViz.ts`'s pure-mapper shape), ported byte-for-byte into `daemon/src/lib/visibility.ts` (the daemon workspace has no dependency on `@bismuth/core`).

```typescript
type Visibility = "all" | "chat-only" | "hidden";

resolveVisibility(path, fileVisibility, folderVisibility): Visibility
// explicit file value wins; else walk ancestor folders DEEPEST → shallowest,
// first entry wins; else "all"

resolveFolderVisibility(path, folderVisibility): Visibility
// same walk, but the folder's OWN entry counts as the deepest ancestor

isVisibleToChat(v)   = v !== "hidden"
isVisibleToDaemon(v) = v === "all"

buildDenyPaths(root, channel): Promise<DenyEntry[]>
// resolves EVERY note's effective visibility and returns the RESTRICTED subset for
// `channel` as { rel, abs } pairs — per-file paths, not folder globs
```

**Worked example:**

| Path | Own frontmatter | Nearest ancestor rule | Effective visibility |
|---|---|---|---|
| `Private/a.md` | (absent) | `Private` → `hidden` | `hidden` (inherited) |
| `Private/exposed.md` | `visibility: all` | `Private` → `hidden` | `all` (explicit override wins) |
| `Private/Drafts/b.md` | (absent) | `Private/Drafts` has no entry → falls back to `Private` → `hidden` | `hidden` (nearest ancestor that HAS a rule, not necessarily the immediate parent) |
| `notes/c.md` | `visibility: chat-only` | (none) | `chat-only` (explicit, no folder involved) |
| `d.md` | (absent) | (none) | `all` (nothing restricts it) |

**Why nearest-wins over a "folder is a hard floor" policy:** the deny list is built by resolving each file individually and emitting per-file denies — since `buildDenyPaths` walks every note and computes its own effective visibility, a file's explicit `visibility: "all"` inside an otherwise-hidden folder is honored by simply NOT emitting a deny for it. Because the tree badge (`GET /tree`'s resolved `visibility` field) and the enforcement gate (`buildDenyPaths`) both call the exact same resolver, the UI can never disagree with what's actually enforced. The tradeoff: a stray `visibility: "all"` (e.g. copy-pasted from a template) re-exposes a file dropped into a hidden folder — the FileTree context menu's "Effective: … — inherited from '…'" row surfaces the ambiguity before it becomes a surprise.

### The discovery walk — every extension, every directory, plus stem inheritance

An earlier version of `buildDenyPaths` only opened files on a fixed extension allowlist (`.md`/`.draw`/`.sheet`/`.yaml`/a few image/PDF types) and skipped dot-directories. That was a real, verified hole: a `.txt`/`.csv`/`.json` file living in a folder marked `hidden` was invisible to the walk and therefore **unenforced on every channel**, even though the sidebar badged its folder as hidden — and a note stashed under `.stash/` was skipped entirely. The current walk (`listVisibilityFiles` in `core/src/visibility.ts`) fixes this:

1. **Every file, every directory, including dot-directories.** Only two names are skipped: `.git` (handled as its own subtree deny — see "Ambient surfaces" below, not walked as vault content) and `.settings` (Bismuth's own config, never vault content).
2. **The folder cascade is resolved first, with zero I/O** (memoized per directory) — this alone covers any extension inside a restricted folder, with no file open at all.
3. **A file's own frontmatter is then checked on EVERY file the walk finds, not just `.md`** — a cheap 512-byte head read, re-read up to 64 KiB only when that head is truncated and doesn't already contain a closing `---` fence. A file that doesn't start with `---` costs exactly one small read no matter how large it is. This closes the "hidden note copied/renamed/hard-linked to an untracked extension" hole: the copy carries the identical frontmatter bytes, and the old `.md`-only assumption never saw them.
4. **Stem inheritance**: a file with no explicit visibility of its own, whose pre-first-dot stem matches a restricted sibling's stem in the *same directory*, inherits the strictest such sibling's resolved visibility. This is what closes the export-sidecar gap — `sketch.draw.png`/`sketch.draw.pdf` share the stem `sketch` with a hidden `sketch.draw`, so the rendered exports of a hidden drawing are restricted too, rather than reachable under a name the old walk explicitly excluded as an "export artifact." It's deliberately over-inclusive (an unrelated `note.png` beside a hidden `note.md` becomes restricted too) because a non-markdown file has no frontmatter of its own with which to opt back out — over-restricting is the safe direction, and it's the only one available.

So the doc's older claim — "a hidden folder of non-`.md` files is enforced, not merely badged" — is now **actually true**, where before it wasn't (the red-team pass that found this hole is what's behind the "Ambient surfaces" note below on how these things tend to be found: by attacking the shipped code, not by reading it).

`buildDenyPaths` is **not cached**: visibility is resolved fresh from the file's current path on every call, so a note moved into or out of a restricted folder re-resolves instantly with no migration step. The daemon rebuilds its deny list fresh on every message (a separate process per turn). A chat session is long-lived, so its deny list is built at spawn and rebuilt whenever the vault's visibility settings change (`invalidateChatVisibility()` flags every open Claude session; the next turn respawns `query()`, resuming the same conversation, with a fresh gate — `managedSettings`/`sandbox` are fixed at spawn and can't be updated on a running session).

---

## Ambient surfaces (closed before any per-backend mechanism could mean anything)

These leak for **every** backend, including Claude, and none of them are about which agent CLI is running — they're about surfaces Bismuth itself exposes locally. A per-backend gate is a lock on a door beside an open window until these are shut. Each was found by a red-team pass **attacking the shipped code**, not by auditing it in the abstract — that distinction matters enough that it's recorded per row below.

| Surface | The hole | The fix | How it was found |
|---|---|---|---|
| **The local HTTP API** | `GET /file`, `POST /search`, `POST /rows`, `GET /graph`, `GET /base`, `GET /tasks`, `GET /cards/*`, `POST /search-prompt`, `GET /vault-data`, `GET /abs-path`, `GET /meta` served vault content with **no auth at all** — reachable with `curl` from inside a Bash tool call in an otherwise correctly-gated session. | A per-boot random **owner token** (`core/src/ownerToken.ts`, `mintOwnerToken`/`resolveRequestChannel`), presented via `X-Bismuth-Token`. A request presenting it is the vault's own app/CLI, unfiltered — exactly today's behavior. Every other request resolves to a channel (`X-Bismuth-Channel: chat`, or the fail-safe default `daemon`) and gets the SAME per-path visibility filter that gates Claude's own tools — content routes drop restricted rows/nodes before serialization (`core/src/server.ts`'s `denyEntriesForRequest`). Three session-transcript routes (`GET /chat/sessions`, `GET /chat/session-messages`, `POST /chat/search`) have no per-path filter available (a transcript can quote any note, hidden or not) and are refused outright for a non-owner request instead. The token itself is folded into every channel's deny plan by `buildSandboxDenyPaths` (`core/src/visibility.ts`) — the single point all three agent spawns compose their read-deny list from (`chat.ts`'s `buildChatSandboxOption`, the daemon's `buildQueryOptions` via that workspace's ported mirror, and the Seatbelt wrapper for non-Claude backends) — so an agent process that's already gated can't read the token file to defeat the gate. Both absolute spellings of the record are emitted (`ownerTokenDenyPaths`): Seatbelt resolves symlinks before matching, so a deny naming the file through a linked directory is a silent no-op. | Live: a `python3 -c "urllib.request.urlopen(...)"` inside a Bash tool call, from a session whose OWN file-read tools were already correctly denied, returned a hidden note's contents. |
| **The `bismuth` CLI as a subprocess** | `disallowedTools: ["mcp__bismuth__bismuth_cli"]` blocks the MCP *tool* calling convention, but the exact same binary invoked as a plain subprocess (`bismuth read Private/secret.md`, or `bismuth api GET '/file?path=...'`) isn't a tool at all — it's just a Bash command, and Bash is deliberately never disallowed (the daemon needs `bismuth checkpoint`). | The gate moved down to `core/src/visibilityCliGate.ts`, hooked at **two** chokepoints: `mcp/src/cli.ts` (the MCP path, keyed on `BISMUTH_MCP_CHANNEL`) and `cli/src/index.ts`'s single dispatch point (the CLI's own, keyed on `BISMUTH_AGENT_CHANNEL` — every place Bismuth spawns an agent stamps this; **absent means the OWNER's own hand**, the one place in this file where "unset" is deliberately the *permissive* default, not the fail-safe one, because the same binary is also the owner's interactive tool). Command classification flipped from a **denylist** ("content-scanning commands") to an **allowlist with a refuse-by-default tail** — a denylist only ever covers what its author thought of. | Live: `bismuth api GET '/file?path=secret.md'` from a Bash tool inside a fully sandboxed Claude session returned the hidden note. The denylist's gaps (`rows`, `card`, `task`, `calendar`, `graph`, and — sharpest — `checkpoint diff`, a `git diff` i.e. the full plaintext of every changed hidden note) were found the same way: trying commands the original list hadn't enumerated. |
| **Git history** | `core/src/backup.ts` git-snapshots the vault on essentially every save, so a note hidden *today* was very likely committed in plaintext *yesterday* — `git show HEAD:Private/secret.md` or `git log -p -- Private/secret.md` reads it back out with no reference to the working-tree path any deny list covers. | `<vault>/.git` goes into every channel's deny plan (`sandboxDenyRead` in `core/src/visibility.ts`, reached through `buildSandboxDenyPaths` in the same file) — a **subtree** deny (`subpath`, not `literal`), verified to block `git show`/`git log -p` while `cat public.md` keeps working. Deliberately NOT solved by rewriting history: the owner's backups are theirs, and scrubbing them would destroy the reason they exist. The agent's *view* is restricted, not the owner's backup. | Live, from inside a sandboxed session: `git show HEAD:secret.md` and `git log -p -- secret.md` both returned the secret before the `.git` subtree deny existed. |
| **Case-insensitive path comparison** | The shipped `canUseTool` checked `deniedPathSet.has(p)` — an exact byte comparison against a path a MODEL supplied. macOS filesystems are case-insensitive by default, so `Private/SECRET.md` opens exactly the same file as `Private/secret.md` while comparing unequal as a string, and walked straight through the gate. | `isDeniedPath()` (`core/src/visibility.ts`) replaces the exact-match `Set`: it normalizes (leading `./`, duplicate slashes, trailing slash) and **case-folds** before comparing, and also matches a path that lies *under* a restricted entry. It is now the only membership check in the codebase — the exact-match `Set` (`denyPathSet`) is kept only for building `managedSettings` deny-rule strings, never for a live comparison. Also backs `captureToMemory`'s Bash-command scan. | Found by red-teaming the shipped `denyPathSet(...).has(p)` check directly — not by reading it; a case-variant path was tried as one of several path-mangling probes. |
| **`bismuth_cli` MCP tool coverage** | `mcp/src/visibilityGate.ts`'s original `CONTENT_SCANNING_COMMANDS` denylist missed `rows`, `card`, `task`, `calendar`, `graph`, and `checkpoint diff` — and `BISMUTH_MCP_CHANNEL` was never set by any spawner, so every session got the `"daemon"` default (fail-safe *by accident*, not by design). | Moved to `core/src/visibilityCliGate.ts` (re-exported from `mcp/src/visibilityGate.ts` unchanged, so `mcp/src/cli.ts` needed no edit) and rebuilt as the allowlist described above. Every spawner (`chat.ts`, `daemon/src/daemon/session.ts`, the codex/ACP drivers) now stamps `BISMUTH_MCP_CHANNEL` explicitly. | Same red-team pass as the CLI-subprocess row above — the MCP tool and the raw CLI subprocess share one gate now, so the same missed-command list applied to both. |

> **Operational note, easy to miss:** `~/.bismuth/bin/bismuth-mcp` is a **compiled, installed copy** of the MCP server (`core/src/bismuthInstall.ts`), reinstalled only when a content hash of the bundled binaries changes. If you have an existing Bismuth install from before this gate existed, the binary on disk predates it — **install/relaunch the app (or run `bismuth install`) to pick up the fix**; until then, the MCP `bismuth_cli` tool on that machine is running the old, weaker gate regardless of what this source tree says. `bismuth install --status` reports the installed version.

---

## Per-backend/per-channel enforcement

`capabilities.visibilityGate` (`core/src/agentBackends/catalog.ts`) is no longer a boolean — a single flag can't say "enforced for chat but not the daemon," "only on macOS," or "only because we wrap it, not because the CLI itself enforces anything." It's now `{ chat: VisibilityEnforcement, daemon: VisibilityEnforcement }`, where `VisibilityEnforcement` is `"native" | "wrapper-macos" | "none"`:

- **`native`** — the CLI's own policy/sandbox layer enforces it. Claude Code only, today.
- **`wrapper-macos`** — Bismuth wraps the spawned process in an OS-level read-deny sandbox (`core/src/agentBackends/sandboxWrapper.ts`, Seatbelt/`sandbox-exec`). The suffix is the precondition: off Darwin, or without `sandbox-exec`, or against a backend that self-sandboxes (below), this resolves to a **refusal at runtime**, never "probably fine anyway."
- **`none`** — nothing enforces it. A vault with any restricted note MUST refuse that backend on that channel rather than run it unprotected.

The catalog's own doc comment states the honesty rule in these words: *"a value here is a claim that a mechanism is wired AND was verified live on that specific backend. 'It should work, it's the same OS primitive' is not sufficient."* That is the same failure mode `../chat/backends.md` tracks under "a signal claiming more than it knows" — see that page's closing section.

| Backend | Chat | Daemon | `selfSandboxes` | Verified? |
|---|---|---|---|---|
| `claude` | **native** — `managedSettings.permissions.deny` + `sandbox.filesystem.denyRead` + `disallowedTools`, together, plus a live path-aware `canUseTool` auto-deny; `sandbox.failIfUnavailable` follows the deny list (see "Sandbox availability" below) so a restricted vault fails closed rather than silently running unsandboxed | **native** — the identical triple, rebuilt fresh every message | `true` (own Seatbelt — never a wrap target) | **Yes** — Step-0 spike (below) + `core/test/chat.test.ts`'s live "visibility" test, re-attacked by a red-team pass across absolute/relative paths, symlinks, hardlinks, case variants, `../` traversal, Grep/Glob, and Task-subagent delegation. All blocked. |
| `opencode` | **none** — downgraded from `wrapper-macos`; a restricted vault refuses opencode for chat outright rather than run the per-turn `opencode run` subprocess (`chatProviders/opencode.ts`) wrapped or not | **none** — no opencode daemon integration exists in this codebase at all (`capabilities.daemon: false`); moot regardless of the visibility question | `false` (wrappable) | **No** — the third dated section of [visibility-acceptance.md](visibility-acceptance.md) recorded a real `opencode run --format json --auto` turn, wrapped, against `opencode/deepseek-v4-flash-free` ($0 cost): the structured read tool AND the Bash `cat` fallback both denied, but the turn never concluded and the two follow-up probes it was supposed to measure never dispatched before the run was killed. Two of three probes incomplete does not meet the catalog's live-acceptance bar, so this cannot stand at `wrapper-macos`; a `launchctl submit` bypass attempt also surfaced a real, unexercised escape shape (spawning outside the wrapped process tree) worth a dedicated rerun. |
| `codex` | **none** | **none** | `true` (own Seatbelt, `codex-rs/sandboxing/src/seatbelt.rs` — confirmed from source; per-nesting rule below, can never be a wrap target) | **No.** Codex's own `[permissions.*].filesystem` layer is self-described *beta* and has had one upstream deny-read bypass already fixed (PR #23943); whether headless `codex exec` — Bismuth's actual invocation — honours a project `.codex/config.toml` profile at all is **unverified**, and codex was not installed on the machine this catalog was authored on. `daemon/src/daemon/session.ts`'s `resolveDaemonBackend` refuses codex for the daemon the moment any note is hidden, degrading to Claude with a logged reason. |
| `cline` | **none** | **none** (`capabilities.daemon: false`) | `false` | **No.** Not installed on the machine this catalog was authored on; Cline's own docs say its `beforeTool` plugin pattern does not cover `execute_command`/`search_files`/`list_files`, and no OS sandbox exists in Cline itself. First graduation would require a recorded live wrapper run. |
| `gemini` | **none** | **none** | `false` | **No.** Not installed here. Gemini CLI's shipped source (`grep.ts`/`ripGrep.ts`/`ls.ts`/`shell.ts`) bypasses the ACP `fs/*` capability entirely — confirmed by reading it, not guessed. |
| `goose` | **none** | **none** | `false` | **No.** Not installed here; no mechanism confirmed either way. |
| `openclaw` | **none** | **none** | `false` | **No** — installed on this machine, but never exercised under the OS wrapper. **The first graduation candidate**, should that live acceptance run ever happen and get recorded. |
| `claude-code-acp` * | **none** | **none** (`capabilities.daemon: false`) | `true` (bridges Claude Code, which self-sandboxes) | **No** — and can never be `wrapper-macos` regardless of testing (R1 below forbids wrapping a self-sandboxing process). |
| `codex-acp` * | **none** | **none** (`capabilities.daemon: false`) | `true` (bridges Codex, which self-sandboxes) | **No** — same reasoning as `claude-code-acp`. |

\* Hidden from the provider picker (`hidden: true`); a native driver supersedes each. Still selectable by id.

### The wrapper mechanism (`wrapper-macos`)

`core/src/agentBackends/sandboxWrapper.ts` wraps a backend's spawn argv in `/usr/bin/sandbox-exec` with a generated Seatbelt profile — a kernel-level VFS read-deny that needs zero cooperation from the wrapped CLI, so it protects the structured tool call AND any Bash-equivalent fallback identically. Four preconditions, all asserted rather than assumed (`checkSandboxWrapperAvailability`):

- **P1** `process.platform === "darwin"` and `sandbox-exec` exists on disk.
- **P2** the backend must not apply its own Seatbelt profile (`selfSandboxes` in the catalog). Verified live: Seatbelt profiles do **not** nest — an inner profile that isn't byte-identical to the outer one fails the whole spawn with `sandbox_apply: Operation not permitted`, exit 71. Claude Code (`sandbox.enabled: true`) and Codex both self-sandbox, so wrapping either is a bug, not a stronger gate.
- **P3** the wrapped process must be a dedicated per-session-or-per-turn process for ONE vault. opencode's shared `serve` process multiplexes every vault a core process hosts, so it can never carry a profile scoped to one vault — a restricted vault is forced onto the per-turn `run` path instead (`chatProviders/opencodeServer.ts`/`opencode.ts`); this is also why the daemon (one process, every enabled vault) can never use this mechanism at all.
- **P4** exit code 71 from a wrapped spawn means Seatbelt itself failed to apply — treated as a refusal, never retried unwrapped.

The profile denies `file-read*` by `subpath` (not `literal`) for every restricted file/folder, `.git`, and the owner-token file (`buildSandboxDenyPaths`) — `subpath` is required for `.git` and any restricted folder (a `literal` deny only blocks a directory's own listing/stat, not the files inside it — verified live). A 3000-rule / 530 KB profile was verified to work with no practical size limit.

### What stays refused, and why that's the honest answer

Beyond the table above: **every non-macOS host** stays refused for every non-Claude backend, for both channels — Landlock (Linux) is allowlist-only with no negation and needs a bundled syscall helper on kernel ≥5.13; bubblewrap needs unprivileged user namespaces and masks with a 0-byte file rather than a real permission error. **Neither was tested — there is no Linux machine in any spike.** Claiming Linux parity here would be inventing a result, so the wrapper's `checkSandboxWrapperAvailability` resolves to unavailable on any non-Darwin platform, full stop.

### Things that stay uncovered even where a channel IS enforced

- **Existence and metadata leak.** A read-deny (Seatbelt or Claude's own) still lets `ls -la` show a hidden file's name, size, permissions, and mtime; `grep -r` prints `./secret.md: Operation not permitted`, which names it; `GET /tree` badges it. "Hidden" means the *content* is unreachable, not that the note's existence is secret.
- **A stripped copy.** If the exact bytes are written to a new path with no `visibility:` key and no restricted stem or folder — by a human, or by an agent before a note was hidden — no path-based deny list can know. The widened walk and stem inheritance close the *organic* cases (export sidecars, hidden folders, copies that keep frontmatter); a deliberate strip of the frontmatter is out of reach of this design, and of any deny-list design.
- **The within-turn window.** A note marked hidden *during* a turn is not covered until that turn ends, on every backend including Claude — a mid-turn rename was verified to defeat an already-built deny list. A `subpath` deny on an already-restricted *folder* closes the common case (a new file added to a folder that was already hidden is covered immediately), but a file restricted mid-turn for the first time is not retroactively gated within that same turn.
- **A model-requested sandbox opt-out — addressed, not live-verified (Task 9).** See "Sandbox availability: fail closed, not open" below — `dangerouslyDisableSandbox` lets a Bash tool call skip the OS sandbox entirely; it used to be honored by default (`sandbox.allowUnsandboxedCommands` was never set to `false`). `chat.ts`'s `spawnChatQuery` (via the extracted `buildChatSandboxOption`) and `daemon/session.ts`'s `buildQueryOptions` now both set `allowUnsandboxedCommands: false` whenever anything is restricted (the same `denyEntries.length > 0` guard as every other gate here; an unrestricted vault is unaffected — `sandbox` stays omitted entirely, exactly as before). See "Sandbox availability" below for the exact SDK citation and for what the live re-verification did and did not establish — in short, five live haiku probes against a temp vault could not reproduce a model invoking `dangerouslyDisableSandbox: true` on its own initiative (nor even when explicitly instructed to), so this fix could not be exercised through a reproduced live leak-then-fixed round trip; it rests on unit tests (`core/test/chat.test.ts`, `daemon/test/session.test.ts`) plus the SDK's documented semantics for the field.

### The chokepoint, and why it lives in the router

The wire and UI for a graceful refusal exist end to end (see "UI" below): a `"visibility-refused"`
`ChatFrame` error code, and a dedicated ChatView panel. The decision that emits it lives in **one
place** — `resolveVisibilityGate` (`core/src/agentBackends/visibilityGate.ts`), called from the chat
router's session-creating verbs (`core/src/chatProviders/index.ts`).

That location is the whole point. An earlier revision of this page had to record a genuine gap: the
seven non-Claude drivers were written independently and **not one of them checked visibility**, so
the catalog said `"none"` (honest data) while picking one of those backends against a restricted
vault was silently permissive (dishonest behaviour). Seven drivers cannot be kept in agreement by
review. One chokepoint can — and a **new** backend is refused by default, because its catalog entry
starts at `"none"` and the router reads the catalog rather than trusting the driver.

- `claude` never reaches a refusal (native, both channels).
- `opencode`, `codex`, and every ACP backend (`cline`/`gemini`/`goose`/`openclaw`/the two hidden
  adapters) are refused by the router before their driver is ever spawned — none carries a verified
  mechanism for chat today (see the table above). `chatProviders/opencode.ts` still carries its own
  precondition-refusal path (`opencodePreconditionRefusal`, checking platform/`sandbox-exec`/shared-
  server binding) from when its catalog entry was `wrapper-macos`; it stays dormant behind the
  router's earlier refusal unless a future acceptance run restores that capability.

Verified by `core/test/agentBackends/visibilityGate.test.ts`, which asserts all seven are refused,
that an unknown backend id refuses rather than inheriting the default backend's answer, that an
unreadable vault refuses, and that `chat-only` restricts the daemon channel but not chat. The
end-to-end behaviour is recorded in [visibility-acceptance.md](visibility-acceptance.md).

---

## Step 0 spike: what was actually verified (Claude, original pass)

Before writing any enforcement code, two throwaway probe scripts (run against the installed `@anthropic-ai/claude-agent-sdk`, using the user's own `claude` login, haiku model, minimal prompts) checked the two load-bearing claims behind Claude's `native` row above:

1. **Does `managedSettings.permissions.deny` survive `permissionMode: "bypassPermissions"` (the daemon's exact mode)?** — **Yes.** A session with `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions: true`, and `managedSettings.permissions.deny: ["Read(<path>)", …]` attempted a Read tool call against the denied file; the SDK returned a `tool_use_error` and the model never saw the file's contents.
2. **Does `sandbox.filesystem.denyRead` block a Bash `cat`/`grep` of a denied file on this Darwin machine?** — **Yes**, confirmed at the OS level: an explicit `Bash: cat <path>` tool call failed with `cat: <path>: Operation not permitted` (exit code 1) — a real sandboxed filesystem denial, not just the model declining.

**A real bug the spike process caught, fixed, and is worth knowing about:** an absolute-path-only deny rule is fragile in two ways that only showed up once the mechanism was wired into the real `chat.ts`/`session.ts` code paths and exercised live:

- **Symlinks.** On macOS, `/tmp` and `/var` are symlinks to `/private/tmp`/`/private/var`. The SDK's own tools report the CANONICAL (symlink-resolved) path in their `file_path`. Fix: `buildDenyPaths` canonicalizes its root via `realpath` before constructing absolute deny paths.
- **Relative vs. absolute tool-call paths.** Claude Code's Read tool does not consistently resolve a relative `file_path` against an absolute-only deny pattern. Fix: `buildManagedSettingsDeny` emits **both** the relative-to-cwd and the canonical-absolute form of every denied path, for each of `Read`/`Edit`/`Grep`/`Glob`.

The lesson generalizes, and it's the same lesson the "Ambient surfaces" table above and the wrapper's seatbelt spike both re-learned independently: a deny list (or a claim about one) built from a single, half-considered representation is an easy way to *believe* a gate works while it silently doesn't in the exact shape production code hits it. `core/test/visibility.test.ts`, `daemon/src/lib/visibility.test.ts`, and `core/test/chat.test.ts` cover both fixes so a regression fails loudly.

---

## Sandbox availability: fail closed, not open (2026-07-30 measurement)

An earlier pass reasoned (without measuring) that `BISMUTH_AGENT_CHANNEL` — the env var
`core/src/visibilityCliGate.ts` reads to gate the `bismuth` CLI/MCP subprocess path — was "the"
enforcement mechanism, defeatable by unsetting it. That conclusion was wrong to reach by reasoning
alone, and a live measurement corrects it:

**What was actually measured**, against a real `claude` turn (haiku, the installed CLI, a temp
vault, `BISMUTH_AGENT_CHANNEL=chat` set exactly as `chat.ts` sets it, `managedSettings.deny` +
`sandbox.filesystem.denyRead` wired exactly as `spawnChatQuery` wires them):

- A Bash `bismuth read <hidden-note>` failed at the **OS level** — `EPERM: operation not
  permitted, open '<path>'` — before the CLI's own `visibilityCliGate.ts` ever got a chance to run.
  That error comes from `sandbox.filesystem.denyRead`, not from `managedSettings`: the Bash tool
  itself is never in the `managedSettings`/`disallowedTools` deny list (the daemon needs Bash for
  `bismuth checkpoint`), so nothing about the tool-level deny would have stopped this call — the OS
  sandbox is what actually did.
- The model then retried the SAME command with the SDK's own `dangerouslyDisableSandbox: true`
  Bash-tool parameter (honored by default — `sandbox.allowUnsandboxedCommands` defaults to `true`
  and neither `chat.ts` nor `daemon/session.ts` overrides it). With the OS sandbox deliberately
  skipped for that one call, the ONLY thing that still caught it was `visibilityCliGate.ts`'s
  `BISMUTH_AGENT_CHANNEL` check refusing the `bismuth` subcommand itself.

**So the corrected model is**: the OS sandbox (`sandbox.filesystem.denyRead`) is the layer that
actually stops an arbitrary Bash read (`cat`, `python3 -c`, anything) — `managedSettings` cannot,
because it is scoped to the Read/Edit/Grep/Glob tool *calling convention*, never to Bash's argv.
`BISMUTH_AGENT_CHANNEL` is real, additional, defense-in-depth **specifically for the `bismuth`
CLI/MCP subprocess path** — the one measured case above where it was the last thing standing
between a Bash call and a hidden note. And the router chokepoint (`resolveVisibilityGate`,
"The chokepoint, and why it lives in the router" above) is what covers every backend that has no
sandbox mechanism at all, by refusing it outright before a session ever opens.

**The hole this measurement found and closed**: `chat.ts` and `daemon/session.ts` both passed
`sandbox: { enabled: true, failIfUnavailable: false, … }`. The SDK's own bundled type declarations
(`@anthropic-ai/claude-agent-sdk`'s `sdk.d.ts`, checked directly in both versions the monorepo
resolved at the time of this measurement — 0.3.186 for core, 0.2.141 for the daemon; the two have
since been unified on `^0.3.186`, and the text below was word-for-word identical in both) actually contain **two different `sandbox.failIfUnavailable`
fields on two unrelated types, with contradicting doc comments about the default**:

- `Options.sandbox: SandboxSettings` — the type that governs `query({ prompt, options })`, i.e. the
  ACTUAL call chat.ts's `spawnChatQuery` and session.ts's `sendMessage` make — says: *"When
  `enabled: true` is passed via this option, `failIfUnavailable` defaults to `true` — if sandbox
  dependencies are missing … or the platform is unsupported, `query()` will emit an error result and
  exit rather than silently running commands unsandboxed. Set `failIfUnavailable: false` to allow
  graceful degradation."*
- `Settings.sandbox` — an unrelated, on-disk `settings.json`/managed-settings schema type, never
  touched by either call site — says: *"Exit with an error at startup if sandbox.enabled is true but
  the sandbox cannot start … When false (default), a warning is shown and commands run unsandboxed."*

These disagree with each other on which way is the default. The type that actually governs this
code path is `Options.sandbox`, whose documented default is **fail-closed (`true`)** — meaning the
pre-fix code's explicit `failIfUnavailable: false` was not merely accepting a permissive default, it
was **actively overriding a documented-safe one**. Practically, this contradiction is moot for
correctness either way: both call sites always pass an explicit boolean and never rely on either
type's default, so which "default" is right never mattered for what actually ran — only for how
severe a fixed `false` reads. Under either type's semantics, a sandbox that cannot start at all
(missing OS dependencies, an unsupported platform) with `failIfUnavailable: false` in force makes
the CLI show a warning and **run the session anyway, fully unsandboxed** — for its entire lifetime,
not just one command. In that state, `managedSettings.permissions.deny` is *all* that's left, and —
as measured above — that layer does nothing to a raw Bash `cat`/`bismuth read`/`python3 -c`.
`BISMUTH_AGENT_CHANNEL` still covers the `bismuth`-subprocess case, but a plain `cat` would go
completely unguarded.

**The fix** (`core/src/visibility.ts` + `daemon/src/lib/visibility.ts`'s ported twin,
`sandboxFailIfUnavailable(denyEntries)`): `failIfUnavailable` is now `denyEntries.length > 0`
instead of a fixed `false`. A restricted vault would rather refuse to open the session than open it
silently unprotected; an unrestricted vault is unaffected — the whole `sandbox`/`managedSettings`
block is still omitted entirely when nothing is restricted (as it always was), so a machine where
sandboxing can't start at all keeps serving every vault that hides nothing exactly as before.
Covered by `core/test/visibility.test.ts`, `daemon/src/lib/visibility.test.ts`,
`core/test/chat.test.ts`, and `daemon/test/session.test.ts`.

**What this measurement did NOT verify, stated plainly**: an actual "sandbox unavailable at
startup" condition could not be forced on this machine without touching the host itself (macOS's
`/usr/bin/sandbox-exec` is a fixed, no-override system path, present and working here, and there is
no non-Darwin machine available in this pass) — genuinely attempted (env-var probes, and wrapping
the harness in an outer Seatbelt jail, which produced a *different*, per-command failure — exit 71,
`sandbox_apply: Operation not permitted` — not the session-wide graceful-degrade `failIfUnavailable`
governs). So the corrected `failIfUnavailable: true` behavior (the session refusing to open at all)
rests on `Options.sandbox`'s documented semantics (the type this code actually calls — see above)
plus the code-level fact that `managedSettings` cannot cover Bash, not on a reproduced live
leak-then-fixed round trip. That distinction is recorded here rather than glossed over, per this
page's own standard.

**A residual gap found by this same measurement, FIXED by Task 9 (2026-07-30)**:
`dangerouslyDisableSandbox` is a documented, model-controlled Bash-tool parameter, honored whenever
`sandbox.allowUnsandboxedCommands` isn't explicitly set to `false` (its default is `true`) — and
neither `chat.ts` nor `daemon/session.ts` set it. The live probe above shows the model invoking it
*on its own initiative* after a denied Read attempt. For the one command shape measured (`bismuth
read`), `visibilityCliGate.ts` still caught the retry — but for a command with no equivalent second
gate (a plain `cat`, `python3 -c`, `head`, …), asking the model to disable the sandbox for that one
call would remove the ONLY layer that stops it, regardless of `failIfUnavailable` or whether the
sandbox is otherwise fully available and working.

**The fix**: both call sites now pass `allowUnsandboxedCommands: false` inside the same
`sandbox: {…}` object, under the same `denyEntries.length > 0` guard as everything else in this
section — `core/src/chat.ts`'s `spawnChatQuery` (via a small extracted pure helper,
`buildChatSandboxOption`, so the shape is unit-testable without a real `query()`) and
`daemon/src/daemon/session.ts`'s `buildQueryOptions`. An unrestricted vault is unaffected: `sandbox`
is still omitted entirely when nothing is restricted, exactly as before this change.

**The SDK citation, read directly rather than assumed** (learning from this same page's own
`failIfUnavailable` miscitation above — quoting the wrong one of two structurally-similar types is
exactly the mistake to avoid here too): `allowUnsandboxedCommands` is a field of the zod-derived
`SandboxSettings` type that backs `Options.sandbox` — confirmed present at
`sdk.d.ts` line 2596 (0.3.186, core) / line 2411 (0.2.141, the daemon's version at the time; both
workspaces now resolve 0.3.186, and the line citations below are kept as the record of what was
actually read) — but neither declaration site
carries a doc comment of its own (the zod-schema-derived type has no per-field JSDoc at all). The
**only** prose anywhere in either bundled `sdk.d.ts` describing what this field does or defaults to
lives on the structurally-identical, same-named field of the separate, on-disk `Settings.sandbox`
type (`export declare interface Settings`, line 4469 core / 3928 daemon) — the identical 3-line
JSDoc block (open/text/close) sits at `sdk.d.ts` lines 5656–5659 (0.3.186 core, field on 5659) and
lines 5008–5011 (0.2.141 daemon, field on 5011), word-for-word the same text in both versions:

> Allow commands to run outside the sandbox via the dangerouslyDisableSandbox parameter. When false,
> the dangerouslyDisableSandbox parameter is completely ignored and all commands must run sandboxed.
> Default: true.

Unlike the `failIfUnavailable` case above, this is **not** a contradiction between the two types —
there is no competing statement anywhere else about `allowUnsandboxedCommands`'s behavior or
default, on either type. The confidence that this prose describes `Options.sandbox`'s field (not
just `Settings.sandbox`'s) rests on the two schemas being field-for-field, order-for-order identical
(`SandboxSettingsSchema`, `sdk.d.ts` lines 2592–2630 core / 2407–2444 daemon, vs. the `Settings.sandbox`
literal object starting at line 5649 core / 5001 daemon) across BOTH independently-resolved SDK
versions — strong evidence they describe the same underlying sandbox-runtime field, not two
unrelated ones that happen to share a name. That inference is recorded here explicitly rather than
presented as a verbatim `Options`-side doc comment, which is the exact miscitation this page's
`failIfUnavailable` section above had to correct.

**What Step 5's live re-verification did and did not establish, stated plainly**: five live `claude`
turns (haiku, the installed CLI 2.1.220, a fresh temp vault under `/private/tmp/…`, never the real
vault) were run against a hidden `secret.md`, varying the prompt (instructed to `cat` it; left to
choose its own tool; explicitly told to pass `dangerouslyDisableSandbox: true`) and the config (with
and without `settingSources: []` to strip this machine's own ambient `~/.claude` config out of the
picture). **In every one of the five, under the PRE-fix (`vulnerable`) sandbox shape, the model
declined to invoke Bash with `dangerouslyDisableSandbox: true` at all** — even when directly
instructed to — reasoning in its own words that the file was "explicitly in the sandbox's deny
list" and that bypassing "would defeat that protection." **I could not verify this**: the original
live escape (the model reaching for `dangerouslyDisableSandbox` unprompted, twice, that motivated
this task) could not be reproduced on this CLI version/model combination, so there is no reproduced
live leak-then-fixed round trip to report for this fix — unlike the Step-0 spike's `cat`/`grep`
OS-level denial above, which WAS reproduced live. The fix therefore rests on: (1) the unit tests
(`core/test/chat.test.ts`, `daemon/test/session.test.ts`) asserting the exact option shape reaches
the SDK call, and (2) the SDK's own documented semantics for the field quoted above — not on a
live-observed behavior change. A future model or CLI version that reintroduces the original
willingness to bypass would now hit `allowUnsandboxedCommands: false` and have the parameter ignored
outright, per that documented semantics — but that causal chain is asserted from the type's
documentation, not demonstrated end-to-end live.

---

## UI

**Context menu** (`FileTree.tsx`, right-click a file or folder → "Visibility" submenu, next to "Set Icon…"):

- **Visible to Daemon + Chat** — clears any override (file: `deleteProperty`; folder: `setFolderVisibility(path, null)`). This does NOT write an explicit `visibility: all` — it just removes the node's own setting, so a node under a still-restricted ancestor folder stays restricted (see the disabled row below).
- **Chat only** — sets `visibility: "chat-only"`.
- **Hidden from both** — sets `visibility: "hidden"`.

The currently-active row is checkmarked (`✓`). When a node's own setting is absent but an ancestor folder forces a stricter effective value, a disabled row is prepended: `Effective: Hidden — inherited from 'Private/'` — computed client-side from the resolved `GET /tree` values, so the menu can never claim an action will do something it won't.

**Tree badge**: a small glyph beside a row's icon — `EyeOff` for hidden, `MessageSquareOff` for chat-only — driven by the RESOLVED visibility (`TreeEntry.visibility`), so a plain file deep inside a hidden folder shows the badge without its own frontmatter. Native `title` tooltip names which tier it's in.

**Chat refusal**: when a chat's backend+channel can't honour this vault's hidden notes, `core/src/chat.ts`'s `ChatFrame` error union carries a dedicated code, `"visibility-refused"`, alongside the existing `no-claude`/`no-opencode`/`no-binary` setup-failure codes. It carries `binary` (the refused backend's id) and a `message` built by `visibilityRefusalMessage(backendLabel, restrictedCount)` — **a COUNT of restricted notes/folders only, never their names or paths**, since naming a hidden note in an error message would defeat the point of hiding it. `app/src/ChatView.tsx` renders it as its own panel (a `gateRefusal` signal, distinct from the existing `setupError` panel — a refused backend IS installed, it just can't be trusted with hidden notes, so the panel never tells the user to install anything), with a one-click "USE CLAUDE CODE INSTEAD" button reusing the existing `switchProvider` escape hatch. The composer is disabled exactly as it is for `setupError`. See "The chokepoint, and why it lives in the router" above for which backends actually reach this frame today.

**Daemon refusal**: `resolveDaemonBackend` (`daemon/src/daemon/session.ts`) degrades to Claude rather than throwing — the daemon is always-on and its crons must keep firing — and logs the reason via `console.error`. As of this page **that refusal is log-only**: there is no daemon inbox page or other user-visible surface for it yet, unlike the chat-side frame above.

No settings-page UI beyond the schema doc string — `.settings`'s existing autocomplete/lint pick up `folderVisibility` automatically, same as every other schema-backed section.

---

## Memory recall

`@bismuth/memory`'s `NoteFrontmatter` gained an optional `visibility?: "chat-only" | "hidden"` field (`memory/src/graph.ts`), parsed/serialized alongside `type`/`tags`/`created`/`updated`. Both note-listing entry points used by recall filter it out:

- `searchMemory` (`memory/src/search.ts`, the relay-facing keyword search)
- `executeQuery`/`query` (`memory/src/query.ts`, the MCP `recall` tool's structured query)

Both exclude a note when its own `visibility` is EITHER `"chat-only"` OR `"hidden"` — stricter than the vault's `isVisibleToDaemon` semantics might suggest is required by a literal reading of "hidden only," but consistent with them: recall is fundamentally a daemon/3rd-brain-facing operation, so a `chat-only` memory note — explicitly meant to stay out of the daemon's view — is excluded here too. Memory notes are flat under `.daemon/memory` (no subfolders in practice), so there is no folder-cascade tier for them, only this per-note check — a documented simplification versus the vault's file+folder cascade.

---

## Cross-References

- [Frontmatter & properties](frontmatter.md) — the generic `set-property`/`delete-property` routes visibility reuses verbatim
- [Structure](structure.md) — `folderIcons`'s structural precedent for `folderVisibility`
- [Agent backends — the catalog, the capabilities, the six surfaces](../chat/backends.md) — how `visibilityGate` fits into the wider per-backend capability model, and the "signal claiming more than it knows" list this feature's own decorative-flag history joined
- Daemon Integration (main `CLAUDE.md`) — the daemon's `bypassPermissions` session mode and per-vault `sendMessage`

Source: `core/src/visibility.ts`, `core/src/ownerToken.ts`, `core/src/visibilityCliGate.ts`, `core/src/agentBackends/catalog.ts`, `core/src/agentBackends/sandboxWrapper.ts`, `core/src/schema/settingsSchema.ts`, `core/src/settings.ts`, `core/src/server.ts` (`POST /folder-visibility`, `GET /tree`, the owner-token gate + per-route filtering), `core/src/graph.ts` (`TreeEntry`), `core/src/files.ts` (`listTree`), `core/src/changeClassifier.ts`, `core/src/chat.ts`, `core/src/chatProviders/opencode.ts`, `core/src/chatProviders/opencodeServer.ts`, `core/src/runRegistry.ts`, `app/src/api.ts`, `app/src/fileTreeModel.ts`, `app/src/FileTree.tsx`, `app/src/chatEditorContext.ts`, `app/src/ChatView.tsx`, `daemon/src/lib/visibility.ts`, `daemon/src/daemon/session.ts`, `daemon/src/daemon/defaultCrons.ts`, `mcp/src/cli.ts`, `mcp/src/visibilityGate.ts`, `cli/src/index.ts`, `memory/src/graph.ts`, `memory/src/search.ts`, `memory/src/query.ts`, `core/test/visibility.test.ts`, `core/test/chat.test.ts`, `core/test/server.test.ts`, `core/test/ownerToken.test.ts`, `core/test/visibilityCliGate.test.ts`, `core/test/agentBackends/sandboxWrapper.test.ts`, `daemon/src/lib/visibility.test.ts`, `daemon/test/session.test.ts`, `memory/test/{graph,search,query}.test.ts`
