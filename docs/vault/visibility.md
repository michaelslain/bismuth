# Visibility Controls: Per-File/Folder AI Restrictions

Visibility lets you mark a note or folder off-limits to Bismuth's own AI surfaces — the daemon and the in-app chat — without touching your own access to it. This document covers the storage format, the inheritance model, the per-channel enforcement mechanism (including what was empirically verified and what wasn't), the UI, and the honest limits of what this feature does and does not protect.

---

## Threat model

Visibility is an HONESTY boundary, not a security boundary. It stops Bismuth's own daemon and in-app chat Claude sessions from reading a marked file through their normal tool calls, using the Claude Agent SDK's restrictive-only `managedSettings` policy tier (a deny list the app cannot use to widen access, only narrow it) plus same-process context filters. It does NOT restrict: your own interactive terminal Claude sessions (they run as you, with full OS filesystem access — out of scope); you yourself using Bismuth's editor, file tree, graph, or the `bismuth` CLI; or content already copied into a memory note before a file was hidden. On an enterprise-managed machine whose admin managed-settings tier does not opt into `parentSettingsBehavior:'merge'`, the app's policy tier is dropped by the SDK — irrelevant to personal vaults. The daemon runs `bypassPermissions`; whether the SDK's deny list survives that mode is confirmed by an implementation spike (Step 0) — if it does not, the daemon degrades to a hard tool-subset denial plus an advisory system-prompt boundary, and we say so rather than pretend.

**What this means day to day:** marking a note "Hidden from both" keeps it out of the daemon's crons, its memory recall, and the in-app chat's tool calls and editor-context preamble. It does NOT stop you from opening it in the editor, seeing it in the file tree or graph, or reading/editing it via `bismuth` CLI commands or your own terminal Claude session. A residual gap also exists for content captured into a memory note *before* the file was marked hidden — visibility is resolved at read/gate time from current settings, not retroactively scrubbed from history.

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

Pure, unit-tested module: `core/src/visibility.ts` (mirrors `core/src/daemonViz.ts`'s pure-mapper shape).

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

**Why nearest-wins over a "folder is a hard floor" policy:** the deny list is built by resolving each file individually and emitting per-file denies — since `buildDenyPaths` walks every note and computes its own effective visibility, a file's explicit `visibility: "all"` inside an otherwise-hidden folder is honored by simply NOT emitting a deny for it. Because the tree badge (`GET /tree`'s resolved `visibility` field) and the enforcement gate (`buildDenyPaths`) both call the exact same resolver, the UI can never disagree with what's actually enforced. The tradeoff: a stray `visibility: "all"` (e.g. copy-pasted from a template) re-exposes a file dropped into a hidden folder. If fail-safe matters more than flexibility, `resolveVisibility` could be changed to `max(fileVisibility, deepestFolderVisibility)` (a one-line change) — not done here because the "menu never lies" property depends on file-level override being real and honored, and the FileTree context menu's "Effective: … — inherited from '…'" row already surfaces the ambiguity to the user before it becomes a surprise.

**"Files already in the folder" and "future files" are covered for free, with no migration**: resolution is computed from a file's CURRENT path at read/gate time and never stamped onto the file. Move a note into or out of a restricted folder and its effective visibility changes on the very next resolve — no batch job, no per-file frontmatter rewrite. This is also why the daemon and chat both recompute the deny list **fresh on every session/message** rather than caching it.

---

## Per-channel enforcement

| Channel | Class | Mechanism | Verified? |
|---|---|---|---|
| Chat native Read/Edit/Grep/Glob of a restricted file | MECHANICAL | `managedSettings.permissions.deny` in `chat.ts`'s `createSession`, built via `buildDenyPaths(cwd, "chat")` — recomputed fresh per session — PLUS a path-aware `canUseTool` auto-deny as a same-process second layer | **Yes** — live spike + `core/test/chat.test.ts`'s "visibility" test |
| Chat Bash `cat`/`grep` of the same paths | MECHANICAL | `sandbox: { enabled: true, failIfUnavailable: false, filesystem: { denyRead } }` | **Yes** — verified on this macOS machine (see Step-0 spike below) |
| Chat `<editor-context>` filename leak | MECHANICAL | `buildEditorContextText` (`app/src/chatEditorContext.ts`) drops any file whose resolved visibility is `hidden` before the preamble is built; `chat-only` files stay IN (that tier's whole point) | Yes — pure, unit-tested |
| Chat → memory capture | MECHANICAL (coarse) | `captureToMemory` (`core/src/chat.ts`) skips the WHOLE capture if any file referenced in the session's own `<editor-context>` preambles is daemon-restricted (`chat-only` OR `hidden`) — load-bearing for the chat-only tier | Yes — logic covers both tiers; whole-session granularity by design |
| Chat `bismuth_cli` escape hatch | MECHANICAL (blunt) | `disallowedTools: ["mcp__bismuth__bismuth_cli"]`, unconditional (the tool can target ANY vault via its own `--vault`/`--dir` flags, not just this one) | Yes — a fixed tool-name block |
| Daemon native Read/Edit/Grep/Glob | MECHANICAL | Same `managedSettings.permissions.deny`, recomputed per `sendMessage` call from `ctx.root` (`daemon/src/lib/visibility.ts`, a ported copy — the daemon workspace has no dependency on `@bismuth/core`) | **Yes** — Step-0 spike confirms deny survives `permissionMode: "bypassPermissions"` |
| Daemon Bash | MECHANICAL | `sandbox.filesystem.denyRead` on the same paths | **Yes** — Step-0 spike confirms on macOS |
| Daemon system prompt | ADVISORY (defense-in-depth ONLY) | An off-limits-paths appendix in `buildSystemPrompt` (`daemon/src/daemon/session.ts`) — same posture as the `dream` cron's unenforced boundary; NEVER the actual gate | n/a — never sold as enforcement |
| Daemon memory recall | MECHANICAL (file-level) | `searchMemory`/`executeQuery` (`memory/src/search.ts`/`query.ts`) drop any memory note whose OWN `visibility` is `chat-only` OR `hidden` — folder-level cascade doesn't apply (memory notes are flat) | Yes — unit-tested |
| Relay-hooked interactive terminal (recall/collect hooks) | OUT OF SCOPE | Your own OS session; a residual leak (pasting hidden content into a terminal → shared memory → daemon recall) is possible and documented, not fixed | n/a |
| You, via editor/FileTree/graph/CLI | OUT OF SCOPE BY DESIGN | Visibility restricts AI sessions, never the vault owner | n/a |

**Belt-and-suspenders rationale**: `managedSettings.deny` is the one mechanism that gates BOTH chat (surviving a session where the tool would otherwise be silently pre-approved) AND the daemon (under `bypassPermissions`). The path-aware `canUseTool` auto-deny is a same-process second layer for chat; the daemon's system-prompt appendix is advisory prose, never the gate.

---

## Step 0 spike: what was actually verified

Before writing any enforcement code, two throwaway probe scripts (run against the installed `@anthropic-ai/claude-agent-sdk`, using the user's own `claude` login, haiku model, minimal prompts) checked the two load-bearing claims in the table above:

1. **Does `managedSettings.permissions.deny` survive `permissionMode: "bypassPermissions"` (the daemon's exact mode)?** — **Yes.** A session with `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions: true`, and `managedSettings.permissions.deny: ["Read(<path>)", …]` attempted a Read tool call against the denied file; the SDK returned a `tool_use_error` ("File is in a directory that is denied by your permission settings") and the model never saw the file's contents.
2. **Does `sandbox.filesystem.denyRead` block a Bash `cat`/`grep` of a denied file on this Darwin machine?** — **Yes**, confirmed at the OS level: `sandbox: { enabled: true, failIfUnavailable: false, filesystem: { denyRead: [path] } }` made an explicit `Bash: cat <path>` tool call fail with `cat: <path>: Operation not permitted` (exit code 1) — a real sandboxed filesystem denial, not just the model declining.

Since **both** mechanisms were confirmed working, the daemon does **not** need the plan's fallback degradation path (`disallowedTools: ["Read","Edit","Grep","Glob","Bash"]`, all-or-nothing) — the full per-file mechanical gate is implemented for both chat and the daemon.

**A real bug the spike process caught, fixed, and is worth knowing about:** an absolute-path-only deny rule is fragile in two ways that only showed up once the mechanism was wired into the real `chat.ts`/`session.ts` code paths (not the isolated spike scripts) and exercised live:

- **Symlinks.** On macOS, `/tmp` and `/var` are symlinks to `/private/tmp`/`/private/var`. The SDK's own tools report the CANONICAL (symlink-resolved) path in their `file_path` — e.g. `/private/var/folders/…/secret.md` — even when the session's `cwd` was given the non-canonical `/var/folders/…` form. A deny path built by naively joining a non-canonical root silently never matches. Fix: `buildDenyPaths` canonicalizes its root via `realpath` before constructing absolute deny paths.
- **Relative vs. absolute tool-call paths.** Claude Code's Read tool does **not** consistently resolve a relative `file_path` against an absolute-only deny pattern. A model asked to read "secret.md in the current directory" reported `file_path: "secret.md"` (bare relative) roughly as often as the fully-resolved absolute path, and a deny rule keyed on only one form silently failed to match the other — the read would succeed with no denial at all. Fix: `buildManagedSettingsDeny` (`core/src/visibility.ts` / `daemon/src/lib/visibility.ts`) emits **both** the relative-to-cwd and the canonical-absolute form of every denied path, for each of `Read`/`Edit`/`Grep`/`Glob`. `core/test/chat.test.ts`'s live "visibility" test exercises this end to end (spawns a real `claude` session, asks it to read a hidden note, asserts the secret never appears anywhere in the frame stream) and is what caught both bugs during implementation.

The lesson generalizes: a deny list built from a single, half-considered path representation is an easy way to *believe* a gate works (it compiles, the isolated spike passes) while it silently doesn't in the exact shape production code will hit it. Both fixes are covered by tests (`core/test/visibility.test.ts`, `daemon/src/lib/visibility.test.ts`, `core/test/chat.test.ts`) so a regression here fails loudly.

---

## UI

**Context menu** (`FileTree.tsx`, right-click a file or folder → "Visibility" submenu, next to "Set Icon…"):

- **Visible to Daemon + Chat** — clears any override (file: `deleteProperty`; folder: `setFolderVisibility(path, null)`). This does NOT write an explicit `visibility: all` — it just removes the node's own setting, so a node under a still-restricted ancestor folder stays restricted (see the disabled row below).
- **Chat only** — sets `visibility: "chat-only"`.
- **Hidden from both** — sets `visibility: "hidden"`.

The currently-active row is checkmarked (`✓`). When a node's own setting is absent but an ancestor folder forces a stricter effective value, a disabled row is prepended: `Effective: Hidden — inherited from 'Private/'` — computed client-side from the resolved `GET /tree` values, so the menu can never claim an action will do something it won't.

**Tree badge**: a small glyph beside a row's icon — eye-off for hidden, message-square-off for chat-only — driven by the RESOLVED visibility (`TreeEntry.visibility`), so a plain file deep inside a hidden folder shows the badge without its own frontmatter. Native `title` tooltip names which tier it's in.

No settings-page UI beyond the schema doc string — `.settings`'s existing autocomplete/lint pick up `folderVisibility` automatically, same as every other schema-backed section.

---

## Memory recall

`@bismuth/memory`'s `NoteFrontmatter` gained an optional `visibility?: "chat-only" | "hidden"` field (`memory/src/graph.ts`), parsed/serialized alongside `type`/`tags`/`created`/`updated`. Both note-listing entry points used by recall filter it out:

- `searchMemory` (`memory/src/search.ts`, the relay-facing keyword search)
- `executeQuery`/`query` (`memory/src/query.ts`, the MCP `recall` tool's structured query)

Both exclude a note when its own `visibility` is EITHER `"chat-only"` OR `"hidden"` — stricter than the vault's `isVisibleToDaemon` semantics might suggest is required by a literal reading of "hidden only," but consistent with them: recall is fundamentally a daemon/3rd-brain-facing operation (CLAUDE.md: "3rd Brain (memory): the daemon's memory graph"), so a `chat-only` memory note — explicitly meant to stay out of the daemon's view — is excluded here too, the same way `isVisibleToDaemon` treats `chat-only` and `hidden` identically. Memory notes are flat under `.daemon/memory` (no subfolders in practice), so there is no folder-cascade tier for them, only this per-note check — a documented simplification versus the vault's file+folder cascade.

---

## Cross-References

- [Frontmatter & properties](frontmatter.md) — the generic `set-property`/`delete-property` routes visibility reuses verbatim
- [Structure](structure.md) — `folderIcons`'s structural precedent for `folderVisibility`
- Daemon Integration (main `CLAUDE.md`) — the daemon's `bypassPermissions` session mode and per-vault `sendMessage`

Source: `core/src/visibility.ts`, `core/src/schema/settingsSchema.ts`, `core/src/settings.ts`, `core/src/server.ts` (`POST /folder-visibility`, `GET /tree`), `core/src/graph.ts` (`TreeEntry`), `core/src/files.ts` (`listTree`), `core/src/changeClassifier.ts`, `core/src/chat.ts`, `app/src/api.ts`, `app/src/fileTreeModel.ts`, `app/src/FileTree.tsx`, `app/src/chatEditorContext.ts`, `app/src/ChatView.tsx`, `daemon/src/lib/visibility.ts`, `daemon/src/daemon/session.ts`, `daemon/src/daemon/defaultCrons.ts`, `memory/src/graph.ts`, `memory/src/search.ts`, `memory/src/query.ts`, `core/test/visibility.test.ts`, `core/test/chat.test.ts`, `core/test/server.test.ts`, `daemon/src/lib/visibility.test.ts`, `memory/test/{graph,search,query}.test.ts`
