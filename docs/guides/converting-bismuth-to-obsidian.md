# Converting a Bismuth vault to Obsidian

A Bismuth vault and an Obsidian vault are both a folder of markdown, so exporting (migrating, handing a Bismuth vault to an Obsidian user) means rewriting the few things Obsidian does not read, writing the result to a new folder, and reporting what was lossy. Follow this guide whenever you convert a Bismuth vault; the source vault is never modified.

Wikilinks, embeds, callouts, math, frontmatter, tags and attachments are the same text in both apps and copy across untouched. The rest converts as follows:

| Bismuth | Obsidian | Topic page |
|---|---|---|
| `.settings`, `.daemon/`, `.trash/` | `.obsidian/*.json`, nothing | `vault-and-settings` |
| `type: base` markdown note (a flat view, or a `views:` list) | `.base` YAML file (many views) + a note for any prose body | `bases` |
| bracket task fields `[due 2026-09-14] [high]` | Tasks-plugin emoji `⏫ 📅 2026-09-14` | `tasks` |
| `::`/`:::` cards, row-card bases | Spaced Repetition plugin cards | `flashcards` |
| `.draw` files, ` ```draw ` ink fences | PNG pictures, or dropped | `drawings` |
| `<file>.<ext>.md` companion notes | ordinary visible notes | `companion-notes` |
| sheets, ` ```graph `, `icon:`, `visibility:`, template tokens, daemon memory | mostly nothing | `other-features` |

The conversion is lossy because Bismuth has more kinds of thing than Obsidian. Nothing is lost silently: every loss goes in the report (step 6).

## Ground rules

- Write to `<source>-obsidian` next to the source. If that folder already exists, stop and ask; never merge into it.
- Treat the topic pages as procedure plus pointers, not a copy of either format. Both Bismuth and Obsidian (and its plugins) change, so a claim in a topic page is a lead to confirm in step 3. A claim marked unverified has not been checked against Obsidian itself: confirm it or leave the feature out and report it. When a topic page and a live source disagree, the live source wins.
- Read Bismuth docs in this order:
  1. `bismuth_docs_read` with `path` set to the cited path minus `docs/`, for example `docs/bases/overview.md` becomes `{path: "bases/overview.md"}`. An optional `section` takes a heading.
  2. The file `~/.bismuth/docs/<path>` on a machine with the Bismuth app.
  3. `docs/<path>` in a Bismuth checkout.

  `bismuth_docs_search {query}` finds a page by keyword, and `bismuth <group> --help` lists commands.
- Obsidian docs live at <https://help.obsidian.md> (Bases, properties, tags, templates, daily notes). The Tasks plugin docs are at <https://publish.obsidian.md/tasks/Introduction> and the Spaced Repetition plugin docs at <https://stephenmwangi.com/obsidian-spaced-repetition/>. Each topic page lists its exact pages.
- The Bismuth CLI has no export-to-Obsidian command. It reads only: `tree`, `base read`, `base render`, `rows`, `task list`, `card all`, `render`, `export`, `settings get`, `graph`. You do the rewriting with `sed`, `grep`, `find` and small `bun` scripts; the topic pages give exact, tested ones where it matters.
- Needs: `bun` (1.2.21 or later), `jq`, `rsync`, `perl`, and `bismuth` (otherwise `~/.bismuth/bin/bismuth`). Check with the line below, which must print a version and `{ a: 1 }`. Without bun, port the scripts to `node`.
  ```bash
  bun -e 'console.log(Bun.version, Bun.YAML.parse("a: 1"))' && jq --version
  ```
- The Bismuth CLI is headless (no server needed): `bismuth <command> --vault "$SRC"`. Output is JSON, and `jq` is handy. If `bismuth` refuses with a visibility message, run it from the owner's own shell.

Each topic page is `guides/converting-bismuth-to-obsidian/<topic>.md`. Read one with `bismuth_docs_read {path: "guides/converting-bismuth-to-obsidian/<topic>.md"}`, or open the file directly:
[vault-and-settings](converting-bismuth-to-obsidian/vault-and-settings.md) · [bases](converting-bismuth-to-obsidian/bases.md) · [tasks](converting-bismuth-to-obsidian/tasks.md) · [flashcards](converting-bismuth-to-obsidian/flashcards.md) · [drawings](converting-bismuth-to-obsidian/drawings.md) · [companion-notes](converting-bismuth-to-obsidian/companion-notes.md) · [other-features](converting-bismuth-to-obsidian/other-features.md)

## Workflow

Shell state does not persist between tool calls (each call is a fresh shell), so re-set `SRC`, `OUT` and the `bismuth` fallback at the top of every call that uses them.

```bash
SRC=/path/to/bismuth-vault          # never written to
OUT="${SRC%/}-obsidian"             # the new Obsidian vault
command -v bismuth >/dev/null || bismuth() { if [ -x ~/.bismuth/bin/bismuth ]; then ~/.bismuth/bin/bismuth "$@"; else bun run /path/to/checkout/cli/src/index.ts "$@"; fi; }
GUIDE=~/.bismuth/docs/guides/converting-bismuth-to-obsidian   # or <checkout>/docs/guides/converting-bismuth-to-obsidian

# scripts are fences labelled "// name.ts" on their first line; pull one out (indent removed) into a file:
awk -v n=check-links.ts '/^ *```/{if(on)exit;inf=!inf;if(inf){ind=match($0,/[^ ]/)-1;getline l;t=l;sub(/^ */,"",t);if(t=="// " n){on=1;print t}}next} on{print substr($0,ind+1)}' "$GUIDE/vault-and-settings.md" > check-links.ts
```

### 1. Copy

```bash
if [ -e "$OUT" ]; then echo "refusing: $OUT exists"; else
    rsync -aL --exclude '/.settings' --exclude '/.daemon/' --exclude '/.trash/' --exclude '/.git/' --exclude '/.ink/' --exclude '.DS_Store' "$SRC/" "$OUT/"
fi
```

If the user chose to leave `hidden` and `chat-only` notes out of the copy, add `--exclude-from="$LIST"` to the rsync (see `other-features`, `visibility:` keys). `-L` copies symlink targets so later rewrites never write through a link into the source. Without rsync, use `cp -RL "$SRC" "$OUT" && rm -rf "$OUT"/{.settings,.daemon,.trash,.git,.ink}`.

The excluded paths are not note content. `.settings` becomes `.obsidian/` config in step 4, `.daemon/` is Bismuth's runtime (see `other-features`), `.trash/` and `.git/` are housekeeping, and `.ink/` is a folder of Bismuth ink sidecar data (ink lives in ` ```draw ` fences, see `docs/editor/ink.md`). A root `settings.yaml` is vault configuration that the app moves into `.settings` on first open; add `--exclude '/settings.yaml'` if the source has one.

### 2. Inventory

Find out which features this vault uses, so you read only the topic pages you need. Run these from anywhere; each prints nothing when the feature is absent.

```bash
# bases: every type: base note, then how many use each view kind
grep -rlE '^type:[[:space:]]*base[[:space:]]*$' --include='*.md' "$OUT"
grep -rhE '^view:' --include='*.md' "$OUT" | sort | uniq -c | sort -rn
grep -rlE '^views:' --include='*.md' "$OUT"   # multi-entry views: lists: `base read` shows only the first
grep -rlE '^type:[[:space:]]*base[[:space:]]*$' --include='*.md' "$SRC" | while read -r f; do echo "== $f"; bismuth base validate "${f#"$SRC"/}" --vault "$SRC"; done   # silent hazards: bad view kind, extra views, #-truncated filters, dangling ref; exit 1 per problem base
grep -rlE '^mode:[[:space:]]*tasks' --include='*.md' "$OUT"   # task bases (a `mode: tasks` base with no source stores its tasks as body rows: `bases` B7)
grep -rlE '^type:[[:space:]]*base' --include='*.md' "$OUT" | while read -r f; do grep -lE '^```query' "$f"; done   # "bases" that are notes holding a query

# fenced blocks Obsidian cannot render: query, draw, graph (count per file)
grep -rcE '^[[:space:]]*```[[:space:]]*(query|draw|graph)' --include='*.md' "$OUT" | grep -v ':0$'

# bracket-field lines (the grep misses plain checkboxes), then the authoritative count: every checkbox, fenced ones too
grep -rnE '^[[:space:]]*[-*+] \[.\] .*\[((due|scheduled|start|done|created|cancelled) [0-9]{4}-[0-9]{2}-[0-9]{2}|highest|high|medium|low|lowest|every [^]]+)\]' --include='*.md' "$OUT"
bismuth task list --vault "$SRC" | jq length

# flashcards: notes holding cards, and row-card bases
bismuth card all --vault "$SRC" | jq -r '.[].notePath' | sort -u
grep -rlE '^view:[[:space:]]*flashcards' --include='*.md' "$OUT"

# drawings and sheets, then <file>.draw sidecars (a sibling binary exists)
find "$OUT" \( -name '*.draw' -o -name '*.sheet' \)
find "$OUT" -name '*.*.draw' | while read -r f; do [ -e "${f%.draw}" ] && echo "$f"; done

# companion notes: <file>.<ext>.md next to <file>.<ext>
find "$OUT" -name '*.*.md' | while read -r f; do [ -e "${f%.md}" ] && echo "$f"; done

# visibility: keys in notes, folder rules in .settings, and daemon memory
grep -rlE '^visibility:' --include='*.md' "$OUT"
bismuth settings get --key folderVisibility --vault "$SRC"
ls "$SRC/.daemon/memory" 2>/dev/null
```

A hit inside a fenced code block is documentation, not a live construct; judge it by eye. Keep the output: it becomes the first section of the report.

### 3. Look up current formats

For each feature the inventory found, read both sides before writing any conversion:

1. The Bismuth side: the doc pages listed under that topic page's `## Sources`. They say how the construct is stored.
2. The Obsidian side: the pages listed under `## Sources`. `help.obsidian.md` and `publish.obsidian.md` are JavaScript-rendered, so `curl` returns an empty shell with HTTP 200. Each Obsidian source line gives a `(raw: …)` URL; fetch that with `curl -s '<raw url>'` for the same page as markdown. The Spaced Repetition site is static, so `curl` works on it directly. Check the topic page's claims against what you read.
3. If a page has moved, search from <https://help.obsidian.md> or the plugin's GitHub repository. If you cannot confirm a detail, drop it from the output and list it in the report as unverified.
4. Where a topic page differs from the live page, follow the live page and note the difference in the report.

### 4. Convert

Do the steps in this order; later steps depend on earlier ones.

1. Settings to `.obsidian/` (`vault-and-settings`). They are independent, so do them first so attachments resolve.
2. Binary side-files and ink: render `.draw` files to PNG and handle ` ```draw ` fences (`drawings`), then settle companion notes (`companion-notes`). Files come before the notes that reference them.
3. Bases to `.base` files (`bases`). This comes before step 4, because converted ` ```query ` blocks embed the new `.base` names, and inbound `[[Base]]` links need rewriting.
4. ` ```query ` blocks to ` ```base ` or ` ```tasks ` (`bases`, `tasks`).
5. Tasks to emoji (`tasks`). Run the rewrite after bases, so the task-bearing notes you generate get converted too.
6. Flashcards (`flashcards`). Row-card bases produce new notes, so this follows step 3.
7. Everything else (`other-features`): ` ```graph ` fences, `visibility:` keys, sheets, template tokens.
8. Daemon memory, only if the user asked for it (`other-features`).

### 5. Validate

Every check has an expected result. A failure is a bug in your conversion: fix it and rerun that whole check.

```bash
# (a) nothing Bismuth-only left, each expected 0. The last one may hit a line whose date is not a
# real day (`[due 2026-02-30]`, text to Bismuth); the `tasks` topic page has a filter that drops those.
grep -rlE '^type:[[:space:]]*base[[:space:]]*$' --include='*.md' "$OUT" | wc -l
grep -rcE '^[[:space:]]*```[[:space:]]*(draw|query)' --include='*.md' "$OUT" | grep -v ':0$' | wc -l
grep -rnE '^[[:space:]]*[-*+] \[.\] .*\[((due|scheduled|start|done|created|cancelled) [0-9]{4}-[0-9]{2}-[0-9]{2}|highest|high|medium|low|lowest|every [^]]+)\]' --include='*.md' "$OUT" | wc -l

# (b) every .base file is valid YAML with no frontmatter fence
find "$OUT" -name '*.base' | while read -r f; do
    head -1 "$f" | grep -q '^---' && echo "FRONTMATTER FENCE $f"
    bun -e 'Bun.YAML.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$f" || echo "BAD YAML $f"
done
```

- (c) Every `[[link]]` target exists in the output. Run the `check-links.ts` script in `vault-and-settings` (section "Link check script") as `bun run check-links.ts "$OUT"`; expected `missing=0`. Hits marked `case-only` are warnings to report.
- (d) The task count matches. The `tasks=` figure printed by the rewrite script in `tasks` must equal `bismuth task list --vault "$SRC" | jq length`. The one exception is a `mode: tasks` base that stored its tasks as body rows (`bases`, B7): `task list` counts vault checkboxes only, so `tasks=` exceeds the source count by exactly the number of stored rows converted. Say so in the report.
- (e) Open the result in Obsidian if the user can. A `.base` file or a Tasks query that parses as YAML can still be a query Obsidian rejects, and nothing headless checks that. Say so in the report when you could not.

### 6. Report

Write `$OUT.conversion-report.md` beside the vault (not inside it) and summarise it to the user. Contents:

- The inventory output, as counts per feature.
- What converted cleanly, per feature.
- What was lossy, one line per item with the file path (each topic page has a Lossy list to draw from), and every note the conversion created (base prose notes, flashcard notes).
- Anything unverified, and every place a live doc disagreed with a topic page.
- What the copy excluded: `.settings`, `.daemon/`, `.trash/`, `.git/`, `.ink/`. Name each one the source actually had.
- Prose that still describes Bismuth. Conversion keeps note prose as is, so some of it is false in Obsidian ("there is no `.base` extension", "Reading List is a base"). This is a manual review step, not a zero-expected check. Run the grep below (the `\bbases?\b` term catches "Reading List is a base" and is noisy by design), read every hit, and list the ones that are false, one line per hit with path and line. Do not rewrite the prose.
  ```bash
  grep -rniE 'type: base|\.settings|bismuth|\bbases?\b' --include='*.md' --include='*.base' "$OUT"
  ```
- The Obsidian plugins the output needs, so the user knows what to install:
  - Tasks (community plugin), if any task lines or ` ```tasks ` blocks were written.
  - Spaced Repetition (community plugin), if any flashcard notes exist, plus the settings changes `flashcards` lists.
  - Maps (an official community plugin), if any `type: map` view was written.
  - Bases is a core plugin; check the Obsidian version the live docs name for each view type.
- The settings the user must apply by hand because no config key could be confirmed.

## Failure modes

- If two Bismuth tags differ only by case, they merge silently in Obsidian (`#Book` and `#book` are two tags in Bismuth and one in Obsidian). List every case-variant pair in the report; do not rewrite them.
- If a Bismuth base has a multi-entry `views:` list, convert it entry by entry (`bases`, B4). Bases that compose another (`source: base` + `ref`) over the same rows may be folded back into one `.base` with several views, which is optional. The default is one `.base` per Bismuth base, which is always correct.
- If a note has ink in a ` ```draw ` fence, Obsidian cannot show it: Obsidian has no stroke format. The fence is stripped (or flattened to a picture of the whole note) and reported.
- If a base's `ref` names no file, it resolves to zero rows; report it (`bismuth base validate` flags it). The other zero-row trap is a base that spells `source: base` with no `ref:`: `base render` and `rows --of` return nothing for it, though it has body rows. Read a body-row base's rows with `base read` (`bases`).
- If daemon memory is copied, it may hold content derived from `hidden` notes: visibility is applied when memory is read, not when it is written. Copy memory only on request, and honour every `visibility` rule (`other-features`).
- If a note is `visibility: hidden` or `chat-only`, Obsidian treats it as an ordinary note and the copy includes it. The report lists every `hidden` and `chat-only` note so the user can delete them from `$OUT` before handing the vault to anyone.
