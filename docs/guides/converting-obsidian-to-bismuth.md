# Converting an Obsidian vault to Bismuth

A Bismuth vault is any folder of markdown, so an Obsidian vault already opens as one. Converting (importing, migrating) rewrites the few features whose format differs, writes the result to a new folder, and reports what was lossy. Follow this guide whenever you turn an Obsidian vault into a Bismuth vault; the source vault is never modified.

Wikilinks, embeds, tags, frontmatter, callouts, math and `::` flashcards work unchanged. The conversion covers `.base` files, Tasks-plugin emoji, links by alias or with `.md`, and the `.obsidian/` settings. For the reverse direction, read [converting a Bismuth vault to Obsidian](converting-bismuth-to-obsidian.md).

## Ground rules

- Write to `<source>-bismuth`. If that folder exists and is not empty, ask the user before touching it.
- Look formats up before converting. Both Bismuth and Obsidian (and its plugins) change, so the tables in the topic pages under `guides/converting-obsidian-to-bismuth/` orient you and the live sources win.
- Apply only the rewrites the topic pages specify. Never edit a note's own content to make a check pass. A validation failure caused by the note itself (a typo, a stray `[[`) goes in the report's Lossy section as a known item, and the check stays failing for that item.
- Read Bismuth docs (cited below as `docs/<path>.md`) in this order:
  1. The `bismuth_docs_read` MCP tool, with `path` set to the page without the `docs/` prefix, for example `{path: "bases/overview.md"}`. An optional `section` heading returns one section.
  2. The file `~/.bismuth/docs/<path>.md`.
  3. `docs/<path>.md` in a Bismuth checkout.

  `bismuth_docs_search {query}` finds a page by keyword, and `bismuth --help` lists every CLI command.
- Read a topic page the same way: each `<name>.md` cited below is `guides/converting-obsidian-to-bismuth/<name>.md`, for example `bismuth_docs_read {path: "guides/converting-obsidian-to-bismuth/tasks.md"}`.
- Every command below takes `--vault "$OUT"`; add `--pretty` to read the JSON. From a checkout, run the CLI as `bun run cli/src/index.ts`. On an installed machine `bismuth` may not be on PATH; the binary is at `~/.bismuth/bin/bismuth`.

## Workflow

### 1. Copy

The rsync leaves `.obsidian/` readable in `$SRC` for step 4.

```bash
SRC=/path/to/vault; SRC="${SRC%/}"; OUT="$SRC-bismuth"
case "$OUT" in "$SRC"/*) echo "OUT is inside SRC"; exit 1;; esac
[ -n "$(ls -A "$OUT" 2>/dev/null)" ] && echo "EXISTS, ask the user" || { mkdir -p "$OUT" && rsync -a --exclude=.obsidian --exclude=.trash "$SRC"/ "$OUT"/; }
```

### 2. Inventory

Count what the vault uses; only those features get converted.

```bash
SRC="$SRC" bash <<'EOF'
cd "$SRC" || exit 1; export LC_ALL=en_US.UTF-8
g() { grep -rE --include='*.md' --exclude-dir=.obsidian --exclude-dir=.trash "$@" .; }
n() { wc -l | tr -d ' '; }; BT='```'
pr() { printf '%-22s %s\n' "$1" "$2"; }
pr "base files" "$(find . \( -path ./.obsidian -o -path ./.trash \) -prune -o -name '*.base' -print | n)"
for f in base tasks dataview dataviewjs mermaid; do pr "$f fences" "$(g "^[[:space:]]*${BT}${f}[[:space:]]*\$" | n)"; done
pr "checkbox tasks" "$(g '^[[:space:]]*[-*+] \[.\] ' | n)"
pr "emoji tasks" "$(g '^[[:space:]]*[-*+] \[.\] .*(📅|⏳|🛫|✅|➕|❌|🔺|⏫|🔼|🔽|⏬|🔁)' | n)"
pr "numbered tasks" "$(g '^[[:space:]]*[0-9]+[.)] \[.\] ' | n)"
pr "lossy emoji (🏁⛔🆔)" "$(g '🏁|⛔|🆔' | n)"
pr ":: lines (hint only)" "$(g '^([^`]*[^:`])?:{2,3}[^:]' | n)"
pr "flashcard-tag notes" "$(g -l '#flashcard|^tags:.*flashcard|^[[:space:]]*- flashcard' | n)"
pr "excalidraw notes" "$(find . \( -path ./.obsidian -o -path ./.trash \) -prune -o -name '*.excalidraw.md' -print | n)"
pr "canvas files" "$(find . \( -path ./.obsidian -o -path ./.trash \) -prune -o -name '*.canvas' -print | n)"
pr "notes with aliases" "$(g -l '^aliases:' | n)"
pr "block refs" "$(g '\^[A-Za-z0-9-]+[[:space:]]*$|\[\[[^]]*#\^' | n)"
pr "[[x.md]] links" "$(g -o '\[\[[^]|#]+\.md[]|#]' | n)"
pr "md links to .md" "$(g -o '\]\([^)]+\.md(#[^)]*)?\)' | n)"
pr "%% comment lines" "$(g '%%' | n)"
pr "community plugins" "$(cat .obsidian/community-plugins.json 2>/dev/null || echo none)"
EOF
```

### 3. Look up current formats

For each feature present, open that topic page's `## Sources`: the Bismuth doc plus the Obsidian or plugin page. Plugin syntax is converted only when the plugin is in `community-plugins.json`. When a live source disagrees with the topic page's table, follow the live source and write the difference down for the report.

### 4. Convert

Convert in this order; each topic page holds the exact steps. With no `.obsidian/` in `$SRC` there are no settings or plugins: skip every step that reads it and every plugin-gated topic page, and say so in the report. Never stop to ask when nobody is there to answer: take the stated default and record it in the report.

1. Settings: [`vault-and-settings.md`](converting-obsidian-to-bismuth/vault-and-settings.md)
2. Bases: [`bases.md`](converting-obsidian-to-bismuth/bases.md)
3. Tasks: `bismuth task migrate --dry-run --vault "$OUT" --pretty`, review, then run it without `--dry-run`: [`tasks.md`](converting-obsidian-to-bismuth/tasks.md)
4. Query blocks: grep the ` ```tasks ` blocks for the lines `migrate-queries` drops, rewrite ` ```tasks ` to ` ```query `, then run `bismuth base migrate-queries --vault "$OUT"`: [`tasks.md`](converting-obsidian-to-bismuth/tasks.md)
5. Flashcards: [`flashcards.md`](converting-obsidian-to-bismuth/flashcards.md)
6. Links, aliases, embeds, tags, frontmatter: [`links-and-embeds.md`](converting-obsidian-to-bismuth/links-and-embeds.md), [`tags-and-properties.md`](converting-obsidian-to-bismuth/tags-and-properties.md)
7. Drawings and canvas: [`drawings-and-canvas.md`](converting-obsidian-to-bismuth/drawings-and-canvas.md)
8. Everything else (callouts, math, templates, daily notes, Dataview): [`other-syntax.md`](converting-obsidian-to-bismuth/other-syntax.md)

### 5. Validate

Every check must pass; fix and rerun otherwise.

```bash
cd "$OUT" && grep -rlx --include='*.md' 'type: base' . | while IFS= read -r f; do
  echo "$f $(bismuth base validate "$f" --vault "$OUT")"; done          # every line must say "ok":true
grep -rlx --include='*.md' 'type: base' . | while IFS= read -r f; do
  echo "$f rows $(bismuth base render "$f" --vault "$OUT" --pretty | grep -c '"basename"')"; done   # compare to Obsidian
bismuth task list --vault "$OUT" --pretty | grep -c '"line"'            # equals the inventory's checkbox tasks
bismuth task migrate --dry-run --vault "$OUT"                           # "changed":0
bismuth base migrate-queries --dry-run --vault "$OUT"                   # "changed":0
bismuth card decks --vault "$OUT" --pretty                              # one deck per flashcard tag; the bare `flashcards` tag is the deck named ""
```

Then run the unresolved-links check. It prints nothing when clean, and it skips fenced code and inline code spans, where `[[x]]` is an example. Targets ending in `.md` or `.base` count as unresolved. A target caused by the note's own content, such as a stray `[[`, is a known item for the report and is never edited away.

```bash
cd "$OUT" && find . -name '*.md' -print0 | xargs -0 perl -0ne 's/^[ \t]*(`{3,}|~{3,}).*?^[ \t]*\1[ \t]*$//gsm; s/(`+)[^\n]*?\1//g; print "$1\n" while /\[\[([^\]|#\n]+|(?=\n|\z))/g' | sort -u | while IFS= read -r t; do
  case "$t" in '') echo "UNRESOLVED [[ with no target (end of line)"; continue;; esac
  case "$t" in *.md|*.base) echo "UNRESOLVED [[$t]]"; continue;; esac
  case "$t" in ../*|*/../*) echo "UNRESOLVED [[$t]]"; continue;; */*) [ -f "$t.md" ] || [ -f "$t" ] || echo "UNRESOLVED [[$t]]"; continue;; esac
  b=$(basename "$t")
  [ -n "$(find . -type f \( -name "$b.md" -o -name "$b" \) -print -quit)" ] || echo "UNRESOLVED [[$t]]"; done
```

`.settings` need not exist yet: the app creates it the first time it opens the vault, and until then the CLI reads defaults. Absent is a pass; check it only when `$SRC/.obsidian/` existed.

### 6. Report

Write `$OUT.conversion-report.md` and summarise it to the user, with these sections in order:

- Inventory: the step 2 counts.
- Converted: what changed, per step, with paths.
- Lossy: each item with its path, including dropped base view names, dropped task query lines, and links rewritten by hand.
- Defaults taken: every choice made without asking, for example migrating emoji tasks with no Tasks plugin.
- Left as-is: plugin syntax, and features the vault uses that nothing converted.
- Source disagreements: where a live source differed from a topic page.

## Failure modes

- If a base filters on `#x`, it matches nothing. The tag filter is `file.hasTag("x")`, and tags are case-sensitive in Bismuth (`#Foo` is not `#foo`).
- If an Obsidian base has several views, only the first becomes the base. A Bismuth base has one view; each extra view becomes its own `source: base` + `ref` base with its filters restated, because only rows carry over.
- If a base is left as a `.base` file, Bismuth never reads it. A base is a `<Name>.md` note with `type: base`, and a ` ```base ` fence becomes a ` ```query ` fence. Bismuth renders no ` ```tasks ` fence.
- If a binary's tags are written to a `<file>.md` that embeds the binary, that note is a duplicate. Tags for a binary live in its companion note `<file>.<ext>.md` (`photo.png.md`).
- If a ` ```query ` fence has no `source:`, it renders empty. A source-less base note with no body rows resolves to every vault note (in the app, in `base render`, and through a `ref`), but write `source: notes` in every converted base so the scope is explicit.
- If a filter calls an unknown function, `base validate` still passes and the function evaluates to nothing. Check function names against `docs/bases/functions.md`.
