/**
 * app/scripts/devVaultContent.ts — the example vault + memory a bare `bun run dev` opens.
 *
 * WHY A FIXTURE VAULT IS THE DEFAULT. `bun run dev` used to exit unless BISMUTH_VAULT and
 * BISMUTH_MEMORY were both exported, which meant a fresh clone could not run the app at all and a
 * returning developer had to remember two paths that live nowhere in the repo. Pointing dev at a
 * REAL vault is also the wrong default: dev builds write to disk (autosave, task toggles, SRS
 * scheduling, gcal sync), so experimenting means mutating notes you actually care about.
 *
 * PURE DATA, NO I/O — the map below is a value, so the writer beside it (devVault.ts) is the only
 * thing that touches the filesystem and this file can be asserted on directly.
 *
 * The content is chosen to exercise the features that are invisible on an empty vault: wikilinks and
 * backlinks, tags, YAML frontmatter of several types, a `type: base` note with two views, a tasks
 * query, checkbox tasks with due dates, flashcards, and memory notes that link back to vault notes
 * (which is what makes "about" edges appear in the 3rd-brain graph). A vault of three empty notes
 * would boot but would show none of that.
 */

/** Vault files, keyed by path relative to the vault root. */
export const DEV_VAULT_FILES: Record<string, string> = {
    'Welcome.md': `---
tags: [start-here]
pinned: true
---
# Welcome

This is a **throwaway example vault**. \`bun run dev\` regenerates anything missing, so edit freely —
nothing here is precious, and your real notes are never touched.

Things to try:

- Open [[Knowledge Graph]] to see how notes link together
- [[Reading List]] is a *base* — a query over notes, not a folder
- [[Tasks]] pulls every unfinished checkbox in the vault into one view
- Press Cmd+O to search, or Cmd+P for the command palette

Tagged notes: #start-here #example
`,

    'Knowledge Graph.md': `---
tags: [concept]
---
# Knowledge Graph

Every \`[[wikilink]]\` becomes an edge. This note links to [[Welcome]] and [[Spaced Repetition]],
so all three appear connected in the graph view.

Links are matched by **file name**, not path — \`[[Reading List]]\` finds the note wherever it lives.

Backlinks are derived, never stored: open [[Welcome]] and this note shows up in its backlinks panel.
`,

    'Spaced Repetition.md': `---
tags: [concept, learning, flashcards]
---
# Spaced Repetition

Cards live inline in any note tagged \`flashcards\`. \`::\` is a one-way card, \`:::\` is reversible
(both directions get scheduled independently).

What SM-2 schedules::The next review date, from an ease factor and the current interval

hippocampus:::memory consolidation

Leitner box:::A physical precursor to SM-2, with fixed boxes instead of a computed interval

Related: [[Knowledge Graph]]
`,

    'reading/Reading List.md': `---
type: base
views:
  - type: cards
    name: Shelf
    groupBy:
      property: status
    order:
      - file.name
      - author
      - status
  - type: table
    name: All
    order:
      - file.name
      - author
      - status
      - rating
filters:
  and:
    - type == "book"
---
# Reading List

A **base**: frontmatter declares the query and the views. There is no \`.base\` extension — a base is
an ordinary markdown note with \`type: base\`.
`,

    'reading/The Book of Disquiet.md': `---
type: book
author: Fernando Pessoa
status: reading
rating: 5
started: 2026-07-02
tags: [portugal, fragments]
---
# The Book of Disquiet

Assembled from scraps found in a trunk. Relevant to [[Knowledge Graph]] — a text that is literally a
pile of linked fragments with no canonical order.
`,

    'reading/Godel Escher Bach.md': `---
type: book
author: Douglas Hofstadter
status: finished
rating: 5
started: 2026-03-11
finished: 2026-06-28
tags: [recursion, music]
---
# Gödel, Escher, Bach

Strange loops. See [[Spaced Repetition]] for why the dialogues are easier to recall than the chapters.
`,

    'reading/Pattern Recognition.md': `---
type: book
author: William Gibson
status: to-read
tags: [fiction]
---
# Pattern Recognition

Unread. Sits in the \`to-read\` column of [[Reading List]].
`,

    'Tasks.md': `---
type: base
---
# Tasks

\`\`\`query
tasks: not done
group: file.name
\`\`\`

The block above is live — it collects unfinished checkboxes from every note below.
`,

    'projects/Rewrite the parser.md': `---
type: project
status: in-progress
priority: 1
tags: [code]
---
# Rewrite the parser

- [x] Sketch the grammar
- [ ] Tokenizer 📅 2026-08-24
- [ ] Error recovery 📅 2026-09-01
- [ ] Benchmarks against the old one

Blocked on nothing. Related: [[Welcome]]
`,

    'projects/Plant the balcony.md': `---
type: project
status: someday
tags: [home]
---
# Plant the balcony

- [ ] Measure the railing 📅 2026-08-30
- [ ] Decide: herbs or tomatoes
- [x] Buy soil
`,

    'daily/2026-08-19.md': `---
type: daily
mood: 7
---
# 2026-08-19

Read more of [[The Book of Disquiet]]. Started [[Rewrite the parser]].

- [ ] Reply to the landlord 📅 2026-08-21
`,

    '.settings': `# The settings "page" IS this file — open it in the editor like any note.
# Schema-aware: autocomplete and lint come from core/src/schema/settingsSchema.ts.

appearance: ink

editor:
  defaultMode: source

graph:
  labels: true

# ON by default in the example vault so the 3rd brain is VISIBLE. The memory graph, the mem: nodes
# and their "about" edges, the daemon graph mode and the memory MCP tools are all gated on this one
# flag — with it off, .daemon/memory is read by nothing and the feature looks broken rather than
# disabled. Set false to see the 2nd-brain-only experience.
daemon:
  enabled: true
`,
}

/** Memory (3rd-brain) files. The wikilinks pointing at VAULT note names are what produce the
 *  "about" edges between the two brains — memory notes with no such link float unconnected. */
export const DEV_MEMORY_FILES: Record<string, string> = {
    'about-the-user.md': `---
type: profile
---
# About the user

Prefers concrete examples over abstraction. Currently working through [[Rewrite the parser]] and
reading [[The Book of Disquiet]].
`,
    'preferences.md': `---
type: preference
---
# Preferences

Dark themes. Monospace everywhere. Dislikes notifications.

Cares about [[Spaced Repetition]] as a study method, not as an app feature.
`,
    'project-context.md': `---
type: project
---
# Project context

[[Rewrite the parser]] is a rewrite, not a greenfield build — the old grammar has to keep passing its
existing tests throughout.
`,
}
