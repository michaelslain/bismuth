---
name: authoring-bismuth-bases
description: Use when creating, editing, or debugging a Bismuth "base" — a `type: base` markdown note whose frontmatter declares filters/formulas/views over the vault. Covers picking the right view kind (table, cards, list, bullets, kanban, map, calendar, flashcards, bar, line, stat, heatmap) and writing frontmatter that actually matches the code.
---

# Authoring Bismuth bases

## The model

A **base** is an ordinary `.md` file with `type: base` in its YAML frontmatter — there is **no `.base` extension**. The frontmatter *is* the config: `source` says where rows come from (vault notes, checkbox tasks, or another base), `filters`/`formulas` shape and compute over those rows, and `views` is an array of one-or-more view configs, each with a `type` (one of the 12 kinds below) plus that kind's own fields. A minimal `---\ntype: base\n---` alone renders every vault note as a table — the safe default.

## Which view kind to use

| If you want to show... | Use |
|---|---|
| Many rows with several properties as a spreadsheet grid — the default/fallback for browsing and scanning | `table` |
| Rows with a visual identity (book covers, images) or an inline-editable Google-Keep-style note body/checklist | `cards` |
| A compact clickable list (title + up to 2 more fields) — this is the automatic fallback for a `tasks:` query | `list` |
| A plain prose-style bullet list of one field, no table chrome (quotes, one-liners) | `bullets` |
| One field bucketed into a handful of distinct values you drag rows between (a status/stage board) | `kanban` |
| Rows with `lat`/`lng` coordinates plotted on a world map | `map` |
| A date field (+ optional time/recurrence) on a month/week/day grid | `calendar` |
| Front/back Q&A pairs reviewed with spaced repetition | `flashcards` |
| A category or time axis vs. a numeric value, compared as bars | `bar` |
| A numeric value over time, read as a trend | `line` |
| A single aggregated number (sum/avg/count) as one big tile — no breakdown | `stat` |
| Daily activity over a long span (a year), as a GitHub-style contribution grid | `heatmap` |

## Workflow

1. **Pick a kind** from the table above.
2. **Read `references/<kind>.md`** in this skill for that kind's exact config keys, a working frontmatter example, and its specific failure modes — do not guess a key name from memory or from another kind's shape.
3. **Create the note**: a `.md` file (any path/name) with `type: base` frontmatter, `source:` if you don't want the whole vault, and a `views:` array with your chosen `type:` plus its fields.
4. **Verify by reading it back** — re-read the file you wrote (or open it in the app / query it) and confirm the frontmatter parses the way you intended, especially `source:` (see gotcha below): a typo'd `source` silently falls back to a default rather than erroring.

## Cross-cutting gotchas (apply to every kind)

- **`source:` accepts a string or an object** — `source: notes where #book` and `source: { kind: notes, where: '#book' }` are equivalent (`normalizeSource()` coerces both). An unrecognized `source` (bad `kind`, a typo) doesn't error — it silently becomes `undefined`, and the caller falls back to `{ kind: "notes" }` (whole vault) or `{ kind: "base" }` (own body rows), which is rarely what you wanted. Double-check `source:` renders the row set you expect.
- **A base referenced by `from:` resolves its OWN source recursively.** `from: "[[Keep]]"` doesn't just intersect against Keep's static rows — it re-runs Keep's declared `source` (which may itself be `notes`/`tasks`/another `base`). This composition is cycle-guarded (a config loop or a symlink loop returns `[]`, never throws), but it means changing an upstream base's `source:` can silently change what every base composing it shows.
- **The only embedded block is ` ```query ` — there is no ` ```base `, ` ```view `, or ` ```tasks `.** A base itself is always a `type: base` file; inside a note you reference or query it with a ` ```query ` fence (`of: [[Base]]` or `tasks: <dsl>`, plus `view:`/`where:`/`group:`/`limit:`), never a differently-named fence.

Full reference (routing, caching, the complete `BaseConfig`/`ViewConfig` shape, worked examples): `docs/bases/overview.md`. Sources & composition: `docs/bases/sources.md`. The `\`\`\`query` block: `docs/bases/query-block.md`.
