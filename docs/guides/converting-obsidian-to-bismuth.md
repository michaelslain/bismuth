# Converting an Obsidian vault to Bismuth

> **When to read this:** Use when turning an Obsidian vault into a Bismuth vault — importing, migrating, or opening an existing Obsidian vault in Bismuth. Walks through inventorying which features the vault uses, looking up the CURRENT Obsidian and Bismuth formats for each, converting .base files, Tasks-plugin emoji, flashcards, links and .obsidian settings into a new folder, validating with the bismuth CLI, and reporting what was lossy.

## The model

A Bismuth vault is any folder of markdown, so an Obsidian vault already opens as one. Most Obsidian syntax (wikilinks, embeds, tags, frontmatter, callouts, math, `::` flashcards) works unchanged. The conversion is the handful of features whose format differs: `.base` files, Tasks-plugin emoji, links by alias or with `.md`, and the `.obsidian/` settings.

## Ground rules

- **Never modify the source vault.** Write to `<source>-bismuth`. If that folder exists and is not empty, ask the user before touching it.
- **Both formats change, so look things up before converting.** The tables in the topic pages under `guides/converting-obsidian-to-bismuth/` are dated snapshots, hints only. The live source wins.
- **Only the rewrites the references specify.** Never edit a note's own content to make a check pass. A validation failure caused by the note itself (a typo, a stray `[[`) goes in the report's Lossy section as a known item, and the check is left failing for that item.
- **Reaching Bismuth docs** (cited below as `docs/<path>.md`), in order:
  1. the `bismuth_docs_read` MCP tool with `path` set to the page without the `docs/` prefix, e.g. `{path: "bases/overview.md"}` (optional `section` heading returns one section);
  2. the file `~/.bismuth/docs/<path>.md`;
  3. `docs/<path>.md` in a Bismuth checkout.

  `bismuth_docs_search {query}` finds a page by keyword; `bismuth --help` lists every CLI command.
- **Reaching a topic page:** each `<name>.md` cited below is `guides/converting-obsidian-to-bismuth/<name>.md` — `bismuth_docs_read {path: "guides/converting-obsidian-to-bismuth/tasks.md"}`, or the file under `~/.bismuth/docs/` or a checkout's `docs/`.
- Every command below takes `--vault "$OUT"`; add `--pretty` to read the JSON. `bismuth` is the CLI (from a checkout: `bun run cli/src/index.ts`). On an installed machine `bismuth` may not be on PATH; the binary is at `~/.bismuth/bin/bismuth`.

## Workflow

1. **Copy.** `.obsidian/` stays readable in `$SRC` for step 4.
```bash
SRC=/path/to/vault; SRC="${SRC%/}"; OUT="$SRC-bismuth"
case "$OUT" in "$SRC"/*) echo "OUT is inside SRC"; exit 1;; esac
[ -n "$(ls -A "$OUT" 2>/dev/null)" ] && echo "EXISTS, ask the user" || { mkdir -p "$OUT" && rsync -a --exclude=.obsidian --exclude=.trash "$SRC"/ "$OUT"/; }
```
2. **Inventory.** Count what the vault uses; only those features get converted.
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
3. **Look up current formats.** For each feature present, open that reference's `## Sources`: the Bismuth doc plus the Obsidian or plugin page. Plugin syntax is converted only if the plugin is in `community-plugins.json`. If a live source disagrees with the snapshot, the live source wins; write it down for the report.
4. **Convert**, in this order (the reference holds the exact steps). No `.obsidian/` in `$SRC` means no settings or plugins: skip every step that reads it and every plugin-gated reference, and say so in the report. Never stop to ask when nobody is there to answer: take the stated default and record it in the report.
   1. settings: [`vault-and-settings.md`](converting-obsidian-to-bismuth/vault-and-settings.md)
   2. bases: [`bases.md`](converting-obsidian-to-bismuth/bases.md)
   3. tasks: `bismuth task migrate --dry-run --vault "$OUT" --pretty`, review, then without `--dry-run`: [`tasks.md`](converting-obsidian-to-bismuth/tasks.md)
   4. query blocks: grep the ` ```tasks ` blocks for lines `migrate-queries` drops, then ` ```tasks ` becomes ` ```query `, then `bismuth base migrate-queries --vault "$OUT"`: [`tasks.md`](converting-obsidian-to-bismuth/tasks.md)
   5. flashcards: [`flashcards.md`](converting-obsidian-to-bismuth/flashcards.md)
   6. links, aliases, embeds, tags, frontmatter: [`links-and-embeds.md`](converting-obsidian-to-bismuth/links-and-embeds.md), [`tags-and-properties.md`](converting-obsidian-to-bismuth/tags-and-properties.md)
   7. drawings and canvas: [`drawings-and-canvas.md`](converting-obsidian-to-bismuth/drawings-and-canvas.md)
   8. everything else (callouts, math, templates, daily notes, Dataview): [`other-syntax.md`](converting-obsidian-to-bismuth/other-syntax.md)
5. **Validate.** Every check must pass; fix and rerun otherwise.
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
   Unresolved links (prints nothing when clean; a target caused by the note's own content, such as a stray `[[`, is a known item for the report, never edited away). It skips fenced code and inline code spans, where `[[x]]` is an example, not a link. `.md` suffixes and `.base` targets count as unresolved:
```bash
cd "$OUT" && find . -name '*.md' -print0 | xargs -0 perl -0ne 's/^[ \t]*(`{3,}|~{3,}).*?^[ \t]*\1[ \t]*$//gsm; s/(`+)[^\n]*?\1//g; print "$1\n" while /\[\[([^\]|#\n]+|(?=\n|\z))/g' | sort -u | while IFS= read -r t; do
  case "$t" in '') echo "UNRESOLVED [[ with no target (end of line)"; continue;; esac
  case "$t" in *.md|*.base) echo "UNRESOLVED [[$t]]"; continue;; esac
  case "$t" in ../*|*/../*) echo "UNRESOLVED [[$t]]"; continue;; */*) [ -f "$t.md" ] || [ -f "$t" ] || echo "UNRESOLVED [[$t]]"; continue;; esac
  b=$(basename "$t")
  [ -n "$(find . -type f \( -name "$b.md" -o -name "$b" \) -print -quit)" ] || echo "UNRESOLVED [[$t]]"; done
```
   `.settings` need not exist yet: the app creates it the first time it opens the vault, and until then the CLI reads defaults. Absent is a pass; check it only when `$SRC/.obsidian/` existed.
6. **Report.** Write `$OUT.conversion-report.md` and summarise it to the user. Sections, in order:
   - **Inventory**: the step 2 counts.
   - **Converted**: what changed, per step, with paths.
   - **Lossy**: each item with its path, including dropped base view names, dropped task query lines, and links rewritten by hand.
   - **Defaults taken**: every choice made without asking (for example migrating emoji tasks with no Tasks plugin).
   - **Left as-is**: plugin syntax, and features the vault uses that nothing converted.
   - **Source disagreements**: live source vs snapshot.

## Gotchas

- The tag filter is `file.hasTag("x")`, never `#x`. Tags are case-sensitive in Bismuth (`#Foo` is not `#foo`).
- One view per base. Extra Obsidian views become separate `source: base` + `ref` bases with their filters restated (rows only carry over).
- A ` ```base ` fence becomes a ` ```query ` fence; `.base` files become `<Name>.md` with `type: base`. There is no `.base` extension and no ` ```tasks ` fence.
- A binary's tags live in its companion note `<file>.<ext>.md` (`photo.png.md`), never a `<file>.md` that embeds it.
- Always write `source: notes` in converted bases and `query` fences. It is good practice: it makes the scope explicit. A source-less base file with no body rows already resolves to every vault note (in the app, in `base render`, and through a `ref`), but a ```query fence with no source is empty, so the fence always needs it.
- Unknown filter functions pass `base validate` and evaluate to nothing. Check them against `docs/bases/functions.md`.
