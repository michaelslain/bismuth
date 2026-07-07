// The daemon-inbox authoring guide, seeded (non-clobbering, like identity.md) into
// <vault>/.daemon/PAGES.md so any page-authoring session — a user's own cron, the persistent
// vault thread — can `Read` it and learn the format with no hardcoded knowledge anywhere else.
// Kept as a string constant (not a file on disk pre-seed) so it survives `bun build --compile`
// into the daemon binary, same reasoning as defaultCrons.ts.
export const PAGES_GUIDE = `# Daemon inbox pages

A "page" asks the user to approve or dismiss something you did the groundwork for — drafted
replies, a proposed change, anything worth a human's eyes before it becomes real. Write one as
an ordinary markdown file at:

\`\`\`
.daemon/pages/<slug>.md
\`\`\`

\`<slug>\` is a short kebab-case id (e.g. \`reply-drafts-2026-07-06\`) — it becomes the page's
filename AND the key the user's approval is filed under, so keep it unique per page.

## Frontmatter schema

\`\`\`yaml
---
type: daemon-page
title: "Reply drafts ready for review"     # shown in the inbox row
createdAt: 2026-07-06T08:00:03.000Z         # ISO instant, required
deliverAt: 2026-07-06T17:00:00.000Z         # ISO instant; OMIT = deliver ASAP / on next open
source: "cron:answer-emails"                # provenance, display-only — free text
actions:
  - id: send
    label: "Send replies"
    kind: primary                           # primary | default | danger — cosmetic only
    model: sonnet                           # optional; omit => sendMessage's haiku default
    timeout: 300                            # optional session timeout, seconds (default 300)
    prompt: |                               # PRESENT => "approve" (you get re-invoked to act).
      The user approved these replies; the body below reflects their edits. Send each
      "## Reply to ..." section (To/Subject/Body) exactly as written using the configured
      mail tool. Do not alter wording. Report which were sent.
  - id: discard
    label: "Discard all"
    kind: danger                            # no prompt => resolved entirely by Bismuth, you
                                             # are never re-invoked for this button
---

## Reply to Jane: Re: Q3 budget
**To:** jane@co.com **Subject:** Re: Q3 budget

Hi Jane, ...
\`\`\`

## Rules of thumb

- **Approve vs dismiss is derived from \`prompt:\`** — an action with a \`prompt\` re-invokes you
  (a fresh, isolated session, never your persistent thread) once the user presses it; an action
  with no \`prompt\` is resolved instantly with no round-trip back to you at all. Don't add both a
  "just log it" action and a prompt — if nothing needs doing, omit \`prompt\`.
- **The body is the editable draft and the source of truth.** The user can edit it in the normal
  editor before pressing an action — write it so your \`prompt\` says "act on the body below
  exactly as edited", never re-derive the content yourself.
- **\`deliverAt\` controls WHEN the user is nagged, not whether the page exists.** Omit it to
  surface the page immediately; set a future ISO instant to hold it (e.g. "don't bug me about
  this until end of day").
- **Consequential actions should set \`model:\`.** The default (when omitted) is a fast/cheap
  model — fine for something reversible, too weak for "send this email" or "delete this file".
  Set \`model: sonnet\` (or stronger) on any action with real-world consequences.
- **You never write completion status yourself.** Once approved, Bismuth's daemon runtime fires
  your \`prompt\` (with the page body appended) as a one-shot session and writes done/failed
  deterministically once it settles — your job is just to perform the action and report what
  happened in your final reply; don't try to update the page's own status.
- **Don't overwhelm the inbox.** One page per coherent unit of review, not one per item — batch
  related drafts into a single page's body with clear section headers (like the "## Reply to..."
  example above) so \`actions\` stays small and one press handles the whole batch.
`
