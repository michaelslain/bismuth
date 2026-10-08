# Daemon pages

A daemon page is how the daemon asks you to approve or dismiss something it prepared: drafted replies, a proposed change, anything worth a look before it becomes real. A page is an ordinary markdown note under `<vault>/.daemon/pages/`, and the inbox section of the daemon page lists them. Read this page to write pages from a cron or the CLI, or to learn what happens when you press a button. [Set up the daemon](setup.md) walks through approving your first page.

A page the daemon wrote, as `bismuth page create` produces it:

```markdown
---
type: daemon-page
title: Reply drafts ready
createdAt: 2026-10-08T03:24:10.943Z
source: cron:answer-emails
actions:
  - id: send
    label: Send replies
    kind: primary
    prompt: Send each reply exactly as written.
  - id: discard
    label: Discard
    kind: danger
---

Reply to Jane: Q3 budget looks fine.
```

Pressing **send** makes the daemon run the action's `prompt` followed by the page body, in a fresh session. Pressing **discard** has no `prompt`, so it closes the page without involving the daemon.

## Page frontmatter

| Key | Type | Effect |
|---|---|---|
| `type` | `daemon-page` | Marks the note as a page, so it opens with an action bar |
| `title` | text | The inbox row and the page heading; defaults to the file name |
| `createdAt` | ISO instant | When the page was written |
| `deliverAt` | ISO instant | Hold the page until then; omit it to show the page at once |
| `source` | text | Where it came from, shown as `from <name>`. A `cron:` prefix is dropped |
| `actions` | list | The buttons, below |

Each entry in `actions` has these keys.

| Key | Type | Default | Effect |
|---|---|---|---|
| `id` | text | none | Required. Identifies the button |
| `label` | text | none | Required. Shown lowercase on the button |
| `kind` | `primary`, `default`, `danger` | `default` | Styling only. The primary button sits last |
| `prompt` | text | none | Present: an approve button that makes the daemon act. Absent: a dismiss button |
| `model` | model name | `haiku` | Model for the approved session. Set a stronger one for consequential actions |
| `timeout` | seconds | 300 | Session limit for the approved action |

An action missing `id` or `label` is skipped, and the page keeps its other buttons. The body is the editable draft and the source of truth: write `prompt` so it says to act on the body as edited. The daemon seeds `.daemon/PAGES.md`, a short authoring guide that any session can read to learn this format.

## Create a page from the CLI

`bismuth page create` validates the slug, stamps `type` and `createdAt`, serializes `actions` correctly, and refuses to overwrite an existing page. Use it instead of hand-writing the nested YAML.

```bash
bismuth page create reply-drafts --vault ~/vault \
  --title "Reply drafts ready" --source "cron:answer-emails" \
  --body "Reply to Jane: Q3 budget looks fine." \
  --actions '[{"id":"send","label":"Send replies","kind":"primary","prompt":"Send each reply exactly as written."},{"id":"discard","label":"Discard","kind":"danger"}]'
```

It prints `{"path":".daemon/pages/reply-drafts.md","slug":"reply-drafts"}`. The slug becomes the file name, so it cannot start with a dot or contain a slash. `--deliver-at <iso>` sets `deliverAt`. The rest of the inbox is headless too:

| Command | Effect |
|---|---|
| `bismuth page list --vault <vault>` | Every page with its status |
| `bismuth page resolve <path> <actionId> --vault <vault>` | Press a button |
| `bismuth page mark-failed <path> --vault <vault>` | Force a stuck page to `failed` |

The same operations are the `page_list`, `page_create` and `page_resolve` tools in [the MCP daemon tools](../mcp/daemon-tools.md).

## When a page is due

A page is due when its status is `pending` and the current time is at or after `deliverAt`, or at or after `createdAt` when `deliverAt` is absent. The app works this out each time it reads the inbox; there is no delivery step. A page with a future `deliverAt` is listed as scheduled, with no urgency, until its time comes, even if the app never closed.

While `daemon.enabled` is on, the app reads the inbox at launch, every 30 seconds (every 5 seconds while a page is running), and whenever the vault's file tree changes.

## How you are told a page exists

- In the app. A toast reads "N pages ready for review" (or the page's title when there is one) with a **Review** action that opens the daemon page, and a badge on the inbox toolbar button counts due pages. The inbox never opens by itself at launch.
- From the OS. When a cron run ends and a page file exists that did not exist when it started, the daemon posts one notification titled `<daemon name>: <page title>` with the text `New in your inbox`. A cron with `notify: true` already sends its own notification and gets no per-page one. A page whose `source` names a different cron is left to that cron's run.

The notification comes from the daemon, not from the model, so a cron needs no instruction to send it.

## Approve, dismiss or retry

Open a page from the inbox. Its action bar is pinned under the editor. Edit the body if you want, then press a button.

1. The app saves the page's current text to disk first, so the daemon acts on what is on screen.
2. A dismiss button marks the page `dismissed`. Nothing else happens.
3. An approve button marks it `working`, and the daemon runs the action within 5 seconds in a fresh session with the model and timeout from the action. The prompt is the action's `prompt`, a blank line, `---`, then the page body.
4. When the session ends, the daemon writes `done` or `failed` with a note of up to 500 characters. The bar shows the status as `waiting on you`, `working…`, `done // <note>`, `failed // <note>` or `dismissed // 5m ago`.

Pressing a button on a page that is `working`, `done` or `dismissed` does nothing and shows "Already resolved". The daemon, never the model, writes the final status.

### Retry a failed page

A `failed` page keeps its buttons. Pressing one again runs the approval again from the start, with the page body as it is now.

### When a page is stuck on working

A page that has read `working` for more than 10 minutes means the daemon probably died mid-run. The bar then offers **mark failed**, which sets `failed` without the daemon, and a stuck page's buttons stay hidden until you use it. If this device is not the owner, the bar warns that approving here will not fire: only the owner device's daemon acts. See [communication](communication.md#which-device-runs-the-daemon).

If the daemon had already written `done` or `failed` by the time you mark it, the daemon's result stands.

## Archive and clean up

The `[ archive ]` control on an inbox row deletes the page and its status file, whatever its state, except while it is `working`. A page archived while pending is never answered; the vault's snapshots can restore it. Pages are also removed on their own: a page that is `done`, `failed` or `dismissed` is deleted when it is older than `daemon.inboxRetentionDays` (default 7, range 1 to 90), checked whenever the inbox is read.

## How it works

### Two files per page

A page's status lives in a JSON sidecar, `pages/.state/<slug>.json`, never in the page's own frontmatter. The editor's autosave writes the whole page, so a daemon write into the same file while you edit the body would be overwritten. The sidecar holds `status` (`pending`, `working`, `done`, `failed` or `dismissed`), `pressedAction`, `pressedAt`, the resolved `prompt`, `model`, `timeoutSecs`, `daemonNote` and `completedAt`. A page with no sidecar reads as `pending`. Both the `.state/` and `.triggers/` folders start with a dot, so they stay out of the file tree and their churn never marks the tree dirty. Only the page `.md` is visible to the watcher.

### The press protocol

1. The app calls `POST /daemon/pages/resolve` with the page path and action id.
2. `resolvePage` in `core/src/daemonPages.ts` re-reads the page and looks up the action. Core resolves the action here because the daemon's own frontmatter reader is single-line and cannot parse nested `actions`. A page already `done`, `dismissed` or `working` returns `alreadyResolved`.
3. With no `prompt`, core writes `dismissed` and stops. With a `prompt`, it writes `working` with the prompt, model and timeout (300 seconds if unset) and drops `pages/.triggers/<slug>`.
4. `processPageTriggers` in `daemon/src/daemon/pages.ts` runs in the same 5-second poll as cron triggers. It deletes the trigger, skips the page unless its sidecar says `working` with a prompt, and calls `sendMessage` with `newSession: true`. If the page file is missing, it writes `failed`.
5. On completion it writes `done` with the first 500 characters of the result, or `failed` with the error. When the backend was downgraded to Claude for this run, the note starts with the reason.

A non-owner device deletes the trigger without acting. Execution is runtime code, not a cron, so deleting a cron cannot break the inbox.

### Where the inbox shows

A `type: daemon-page` note opens in `InboxPageView` (`app/src/InboxPageView.tsx`), the standard editor with the action bar under it. The inbox box on the daemon page is `DaemonInbox`, a flat list of due pages, then failed, then scheduled. The sidebar toolbar button `open-inbox` is hidden while the daemon is off.

Source: `core/src/daemonPages.ts`, `core/src/routes/daemon.ts`, `daemon/src/daemon/{pages,pagesGuide,cron}.ts`, `cli/src/commands/page.ts`, `app/src/{InboxPageView,InboxActionBar,inboxPageMeta}.ts*`, `app/src/daemon/{DaemonInbox,InboxRow,daemonInboxApi,daemonInboxLogic}.ts*`
