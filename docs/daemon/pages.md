# Daemon Pages — the inbox

A **page** is how the daemon asks the user to approve or dismiss something it did the groundwork for — drafted replies, a proposed change, anything worth a human's eyes before it becomes real. Pages are ordinary markdown notes the daemon authors under `<vault>/.daemon/pages/`, surfaced together as the **daemon inbox** (the `::inbox` tab, plus a per-page action bar when a page is opened as a note).

This page covers the file format, the dynamic-state sidecar, delivery timing, the button-press → execution → completion lifecycle, failure handling, the frontend surfaces, and cleanup. It complements [overview.md](overview.md) and [crons-and-processes.md](crons-and-processes.md) — a page is neither a cron nor a process; it's a one-shot, user-gated action.

---

## File format — `<vault>/.daemon/pages/<slug>.md`

A page is a `type: daemon-page` markdown note, parsed with core's full-YAML frontmatter (`core/src/frontmatter.ts`), daemon-authored but user-editable like any note:

```yaml
---
type: daemon-page
title: "Reply drafts ready for review"
createdAt: 2026-07-06T08:00:03.000Z
deliverAt: 2026-07-06T17:00:00.000Z   # ISO instant; OMIT/null = deliver ASAP / next-open
source: "cron:answer-emails"          # provenance, display-only
actions:
  - id: send
    label: "Send replies"
    kind: primary                     # primary | default | danger — cosmetic only
    model: sonnet                     # optional; falls back to sendMessage's haiku default
    timeout: 300                      # optional session-timeout secs (default 300)
    prompt: |                         # PRESENT => "approve" action (daemon acts). ABSENT => pure dismiss.
      The user approved these replies; the body below reflects their edits. Send each
      "## Reply to ..." section (To/Subject/Body) exactly as written using the configured
      mail tool. Do not alter wording. Report which were sent.
  - id: discard
    label: "Discard all"
    kind: danger                      # no prompt => resolved entirely by core, no daemon round-trip
---

## Reply to Jane: Re: Q3 budget
**To:** jane@co.com **Subject:** Re: Q3 budget

Hi Jane, ...
```

- **Approve vs. dismiss is derived from the presence of `prompt:`** on the pressed action — one less field to desync. An action with a `prompt` re-invokes the daemon (an isolated session) once pressed; one without resolves instantly, no daemon round-trip at all.
- **The body is the editable draft** and is the source of truth for exact wording — the user can edit it in the normal editor before pressing an action.
- A short authoring guide, `<vault>/.daemon/PAGES.md`, is seeded non-clobbering (like `identity.md`) alongside every vault's brain (`daemon/src/daemon/pagesGuide.ts` + `seeds.ts`) so any page-authoring session — a cron, the persistent vault thread — can `Read` it; there is no hardcoded page-format knowledge anywhere else.

### Creating a page via CLI / MCP

A page can also be authored programmatically — from a Claude session (the bismuth MCP's `bismuth_cli` tool) or the shell — through a **validated helper**, so the intricate nested `actions[]` frontmatter that `resolvePage` depends on is never hand-assembled:

```bash
bismuth page create reply-drafts \
  --title "Reply drafts ready" --source "cron:answer-emails" \
  --body "## Reply to Jane\n…" \
  --actions '[{"id":"send","label":"Send","kind":"primary","prompt":"Send each reply exactly as written."},{"id":"discard","label":"Discard","kind":"danger"}]'
```

`bismuth page create` calls `core/src/daemonPages.ts` `createDaemonPage` (also reachable at `POST /daemon/pages`), which validates the slug, stamps `type: daemon-page` + `createdAt`, serializes the `actions[]` via the `yaml` library, and writes atomically (temp+rename) — refusing to clobber an existing page. `bismuth page list|resolve|mark-failed` cover the rest of the inbox lifecycle headlessly. This is part of the [app-control surface](../mcp/app-control.md) and adds **no new MCP tool** (it rides `bismuth_cli`).

## Dynamic state — the `.state` sidecar

A page's execution state (`status`, the resolved prompt, model/timeout, the daemon's completion note) lives in a **separate JSON sidecar**, never the page's own frontmatter:

```
<vault>/.daemon/pages/.state/<slug>.json
```

```json
{ "status": "working", "pressedAction": "send", "pressedAt": "...",
  "prompt": "<resolved action prompt>", "model": "sonnet", "timeoutSecs": 300,
  "daemonNote": "", "completedAt": null }
```

`status` is one of `pending | working | done | failed | dismissed`. A page with no sidecar yet reads as `pending` (synthesized by `listDaemonPages`). This split exists because `Editor.tsx`'s external-reload reconcile blocks while the user has un-flushed local edits, and the pending autosave writes the buffer — so a daemon write into the page's *own* frontmatter while the user edits the body would be clobbered. It mirrors the existing `.last-fired.json`/`.running.json` split for crons.

Both the sidecar dir (`.state/`) and the trigger dir (`.triggers/`, below) are dot-prefixed, so `listTree`'s hidden-entry skip keeps them out of the sidebar for free, and core's file-watcher noise classifier (`isDaemonRuntimeNoise` in `server.ts`) keeps their churn from ever bumping the tree/graph version — only the page `.md` itself is watcher-visible (`DAEMON_PAGE_RE`, `core/src/daemonPages.ts`).

## Delivery — a stateless predicate, no ticker

```
due = status === "pending" && now >= (deliverAt ?? createdAt)
```

There is **no** delivery write, no `queued`/`delivered` state, and no backend delivery ticker — `due` is re-evaluated fresh every time the frontend reads `GET /daemon/pages` (`app/src/daemonInboxLogic.ts` `isDue`).

- **"Deliver on next open"** = omit `deliverAt` → due immediately.
- **"Deliver at a time"** = a future `deliverAt` → not due until then, even if the app never closed.

The frontend evaluates this at two points: a cold-launch check (`App.tsx`'s `onMount`, catching anything that became due while closed) and a live poll while the app runs — 30s normally, tightened to ~5s while any page is `working`, plus an immediate refresh on any structural vault change (`serverVersion.ts` `lastChange()`). Both are gated on `settings.daemon.enabled`. The frontend diffs the previous due-id snapshot to toast only newly-due pages (`app/src/daemonInbox.ts`).

## Button-press protocol

1. The user edits the page body/frontmatter in the normal editor (ordinary autosave).
2. Pressing an action button first **flushes the exact on-screen buffer to disk** (`flushFocusedEditor()`, same mechanism the rename flow uses) — the daemon acts on precisely what's on screen, not a stale debounced save. (This only covers the CodeMirror editor surface; Milkdown/visual mode has the same pre-existing gap as the rename flow — see `editorRegistry.ts`.)
3. The frontend calls `POST /daemon/pages/resolve { path, actionId }` — a **read-table** route (no vault-cache invalidation; the frontend just re-polls `GET /daemon/pages`), alongside the other `/daemon/*` routes in `core/src/server.ts`.
4. **Core** (`resolvePage`, `core/src/daemonPages.ts`) re-reads the page fresh, parses its frontmatter, and looks up the pressed action:
   - Already terminal → an **idempotent** "already resolved" result (guards a double-click or a race between two open windows).
   - **Dismiss** (no `prompt`) → sidecar `{status:"dismissed", pressedAction, pressedAt}`. Done.
   - **Approve** (has `prompt`) → sidecar `{status:"working", pressedAction, pressedAt, prompt, model, timeoutSecs}` — core resolves the prompt HERE, because the daemon's own frontmatter reader (`daemon/src/lib/frontmatter.ts`) is single-line-only and can't parse nested `actions[]` YAML — then drops a trigger file at `.daemon/pages/.triggers/<slug>` (the same `writeTrigger` port crons/processes use).
5. **The daemon** (`processPageTriggers`, `daemon/src/daemon/pages.ts`) polls `.triggers/` on the same 5s cadence as `processTriggers` (called right after it in `processAllTriggers`, `daemon/src/daemon/cron.ts`): readdir, dotfilter, **owner-gate** (a non-owner device consumes the trigger without firing — same as crons), unlink-before-process, skip if the sidecar isn't `status: "working"`. It reads the sidecar's `prompt`/`model`/`timeoutSecs` plus the page's frontmatter-stripped body, builds `finalPrompt = prompt + "\n\n---\n" + body`, and fires `sendMessage(finalPrompt, ctx, { newSession: true, model, timeoutSecs })` — an **isolated one-shot session**, never the persistent vault thread, never resumed.
6. **Completion is deterministic, written by the daemon runtime — never the LLM.** On success, the sidecar becomes `{status:"done", daemonNote:<summary>, completedAt}`; on throw/timeout/abort, `{status:"failed", daemonNote:<error>, completedAt}`.
7. The page `.md` is never moved or deleted out from under an open tab — its action bar reads the live sidecar status via the poll and downgrades in place to a status chip ("Done — …" / "Failed: …").

## Failure states

- **Authoritative:** the daemon writes `failed` on any timeout/throw. The UI is never the source of truth for completion.
- **Client-side escape hatch:** if a page reads `working` for longer than ~10 minutes (the daemon process itself may have died mid-run, with no writer left to ever settle it), the action bar offers **Mark failed** → `POST /daemon/pages/mark-failed { path }`, which force-writes `{status:"failed"}` with no daemon involvement.
- **Retry:** a `failed` page keeps its action buttons live — pressing again re-runs the round-trip (flush → resolve → trigger).
- **Owner-device gate:** on a non-owner device, the trigger is consumed without firing (same semantics as cron/process triggers). The action bar surfaces this via `GET /daemon/status`'s owner data.

## Frontend surfaces

- **`InboxPageView`** (`app/src/InboxPageView.tsx`) — a `type: daemon-page` note routes here instead of the plain editor (`FileView.tsx`'s `isDaemonPage()` check, mirroring `isBase()`). It renders a chrome action-bar header (buttons from `actions[]`, a status chip once terminal, or an owner-device warning) above the **standard** `Editor`/`BlockEditor` body — chrome, not inline markdown, so daemon-authored controls stay physically separate from the user's editable prose, and it renders regardless of `editor.defaultMode`.
- **`::inbox` tab** (`InboxView.tsx`, `INBOX_TAB` in `tabIds.ts`) — three sections: **Needs review** (due pending, oldest-first), **Scheduled** (future `deliverAt`, transparency-only), **Recently resolved** (terminal, collapsed, newest-first). An **Approve-all** button appears only when every due page shares one identical primary action id (`app/src/daemonInboxLogic.ts` `sharedPrimaryAction`); presses run **sequentially**, never in parallel.
- **Toolbar inbox button** — `open-inbox` ships in the DEFAULT sidebar toolbar (`toolbar:` in `.settings` — removable/movable like any button), hidden entirely while the daemon is off; a badge overlays the due count (special-cased in App.tsx's toolbar render). It's also a palette command. Clicking opens/focuses `::inbox`. A toast fires on newly-due pages (batched to "N pages ready for review"). The inbox is **never** auto-opened on cold launch.
- **`open-inbox` command** (`core/src/commands.ts` + `app/src/commands.ts`) — palette + optional toolbar access.

## Cleanup — no cron, no ticker

Garbage collection runs **in the read path**: `listDaemonPages` (`core/src/daemonPages.ts`) deletes a page's `.md` + its `.state` sidecar, best-effort, whenever it's about to list a page that is BOTH terminal (`done`/`failed`/`dismissed`) AND whose `completedAt`/`pressedAt` is older than `daemon.inboxRetentionDays` (default 7, `core/src/schema/settingsSchema.ts`). Since the frontend polls `GET /daemon/pages` regularly while the daemon is enabled, GC happens on its own with no extra machinery. A resolved page could in principle be GC'd while open in a stale tab — the same accepted risk as any externally-deleted-while-open file.

## Execution is runtime code, not a cron

Unlike `dream`/`vault-review`, page execution is NOT a seeded, user-deletable cron — it's runtime code (`processPageTriggers`) that always runs, so a user who deletes/disables a cron by mistake can never silently break the whole inbox feature.

---

## Cross-links

- [overview.md](overview.md) — the daemon model + Bismuth's daemon controls.
- [crons-and-processes.md](crons-and-processes.md) — the trigger-file port pages reuse, and how it differs (one-shot isolated session vs. a recurring job).
- [storage.md](storage.md) — on-disk file shapes under `<vault>/.daemon`.
- [../README.md](../README.md) — the docs root.

Source: core/src/daemonPages.ts, core/src/server.ts, core/src/daemon.ts (`writeTrigger`), core/src/schema/settingsSchema.ts, daemon/src/daemon/{pages,pagesGuide,cron,seeds}.ts, daemon/src/lib/config.ts, app/src/{daemonInbox,daemonInboxLogic,InboxView,InboxPageView,the toolbar inbox button,FileView,tabIds,PaneContent,commands,App}.tsx
