# Bismuth CLI Reference

The `bismuth` CLI ("control every aspect of a Bismuth vault from the shell") is the `@bismuth/cli` workspace. It is a thin shell wrapper over the `@bismuth/core` library: nearly every command calls a core function directly against the vault's files on disk, with **no running HTTP server required** — the running app's file watcher picks up writes live. The only exceptions are the two commands that need the server process's in-memory state (`agent-graph`, `api`), and the `serve` command which *starts* the server. This page documents every command (one per `cli/src/commands/*.ts`), every flag, the global flags + environment variables, output conventions, and the dispatch model.

## Invocation & Binary

The binary is declared in `cli/package.json` as `{ "bin": { "bismuth": "src/index.ts" } }` and runs under Bun. During development you invoke it as:

```bash
bun run cli/src/index.ts <command> [args]   # from the repo root
```

Once installed/linked, it is the `bismuth` binary:

```bash
bismuth <command> [args] [--vault <dir>] [--memory <dir>] [--pretty]
```

> Note on naming: the `package.json` `bin` name is **`bismuth`**, matching the `@bismuth/` workspace namespace (the `BISMUTH_*` env vars are a legacy prefix, not the binary name). The lone CLI test (`cli/test/cli.test.ts`) describes `bismuth graph` while actually spawning `bun run cli/src/index.ts`. Examples below use `bismuth`.

### Help

```bash
bismuth            # no args → help
bismuth --help
bismuth -h
bismuth help
```

Any of these prints the usage banner plus an alphabetically sorted table of every registered command (`<key>  <summary> <usage>`), then the reminder: "most commands need a vault: pass --vault <dir> or set BISMUTH_VAULT." Exits `0`.

### Dispatch model (longest-match)

`cli/src/index.ts` merges all command groups into one registry keyed by the **full command string** ("task toggle", "row add", "graph", …). Dispatch is **longest-match**: it first tries the two-word phrase `argv[0] argv[1]`; if that key exists it consumes both words, otherwise it falls back to the single word `argv[0]`. Everything after the matched command word(s) is passed to the command's `run(args)`.

- Unknown command → prints `unknown command: <first two words>`, the help banner, exits `1`.
- A thrown error inside a command → prints `error: <message>` to stderr, exits `1`.

## Global Flags & Environment

Argument parsing lives in `cli/src/args.ts` and is shared by every command. Flags are simple `--name <value>` (string) or `--name` (boolean) tokens; positionals are everything else.

| Flag / env | Meaning |
|---|---|
| `--vault <dir>` | Vault directory. **Required by most commands.** Resolution order: `--vault` flag → `BISMUTH_VAULT` env. If none set, the command fails with `error: no vault — pass --vault <dir> or set BISMUTH_VAULT` and exits `1`. |
| `BISMUTH_VAULT` | Env fallback for the vault dir (see above). |
| `--memory <dir>` | Memory (3rd-brain) directory. **Optional.** Resolution: `--memory` flag → `BISMUTH_MEMORY` env. Used only by `graph` and `serve`. |
| `BISMUTH_MEMORY` | Env fallback for the memory dir. |
| `--pretty` | Boolean. Pretty-prints JSON output with 2-space indentation. Accepted by every command (it is only consulted by the shared `out()` helper). |
| `--api <url>` | (api/agent-graph/app only) Base URL of a running server. `api`/`agent-graph`: `--api` → `BISMUTH_API` → `:4321`. The `app` group adds two more fallbacks: `--api` → `BISMUTH_API` → `CLAUDE_RELAY_URL` → the run-registry (`~/.bismuth/run`) → `:4321`. |
| `--off` | (daemon toggles only) boolean — disable instead of enable. |
| `--clear` | (folder-icon only) boolean — clear the icon instead of setting one. |
| `--regex` / `--case` / `--word` | (search/replace only) booleans — regex mode, case-sensitive, whole-word. |
| `BISMUTH_DAEMON_DIR` | (daemon only, read by `core/src/daemon.ts`) overrides the daemon's **machine-level** identity dir (default `~/.bismuth/daemon` — device-id, devices.json, owner.json, daemon.pid). Not a CLI flag; an env var. Per-vault crons/processes live under `<vault>/.daemon` and are addressed via `--vault`, not this var. |

### Argument-parsing semantics (gotchas)

From `cli/src/args.ts`:

- `flag(args, "name")` returns the token immediately after `--name`, or `undefined` if `--name` is absent or last.
- `bool(args, "name")` is `true` iff `--name` appears anywhere.
- `positionals(args)` returns non-flag tokens in order. **It treats the token after a `--flag` as that flag's value and skips it — unless that next token itself starts with `--`.** So a flag whose value happens to follow a positional, or a value-less boolean flag, is handled correctly, but a positional that looks like it follows a value-taking flag can be consumed. Put boolean flags (`--pretty`, `--regex`, `--off`, `--clear`) where they won't swallow a positional, or pass them last.
- Values are NOT type-coerced by the parser; individual commands do their own coercion (see `prop set`, `settings set`, `row` commands which `JSON.parse` values).

### Output conventions (`out()`)

Every command prints through the shared `out(data, args)`:

- `undefined` / `null` → prints nothing (e.g. `read`, `move`, `mkdir`, `write` print nothing on success — they return void from core).
- `string` → printed as-is (e.g. `task toggle` → `ok`; `daemon cron toggle` → `ok`).
- objects / arrays → `JSON.stringify`, single-line by default, **2-space indented when `--pretty` is passed** (the helper checks `bool(args, "pretty")`).

This makes the CLI uniformly machine-parseable: anything that returns structured data emits JSON.

---

## File commands (`commands/file.ts`)

Vault entry CRUD over `core/src/files.ts`. All require a vault.

### `read <path>`
Print a vault note's raw contents (`readNote`). Fails `read: <path> required` if no path.
```bash
bismuth read "Projects/Internship.md" --vault ~/vault
```

### `write <path> [--content <text>]`
Write a vault note. Content comes from `--content`, or **stdin** if `--content` is omitted (`await Bun.stdin.text()`). Prints nothing on success.
```bash
bismuth write "Notes/Idea.md" --content "# Idea\n\nbody" --vault ~/vault
echo "# From stdin" | bismuth write "Notes/Piped.md" --vault ~/vault
```

### `move <from> <to>`
Move/rename a vault entry (`moveEntry`). Both positionals required (`move: <from> <to> required`). Prints nothing.
```bash
bismuth move "Inbox/Draft.md" "Notes/Draft.md" --vault ~/vault
```

### `delete <path>`
Move a vault entry to the trash (`deleteEntry`). Returns `{ trashPath }` (JSON). Required: `<path>`.
```bash
bismuth delete "Notes/Old.md" --vault ~/vault --pretty
# → { "trashPath": ".trash/Old.md" }
```

### `restore <trashPath> <to>`
Restore a trashed entry to a destination path. Implemented as a `moveEntry(vault, trashPath, to)`. Both positionals required.
```bash
bismuth restore ".trash/Old.md" "Notes/Old.md" --vault ~/vault
```

### `mkdir <path>`
Create a directory in the vault (`createEntry(..., "dir")`). Prints nothing. Required: `<path>`.
```bash
bismuth mkdir "Projects/2026" --vault ~/vault
```

### `tree`
List the entire vault file tree as JSON (`listTree`).
```bash
bismuth tree --vault ~/vault --pretty
```

---

## Note / template / daily commands (`commands/note.ts`)

Note creation, templates, and the daily note. All require a vault.

### `note new <path> [--template NAME] [--template-folder DIR]`
Create a new note, optionally seeded from a template. The path gets a `.md` extension appended if missing. Steps:
1. `createEntry(vault, rel, "file")`.
2. If `--template NAME` is given: list templates from the template folder (`--template-folder`, default `"Templates"`), find one whose `name` **or** `path` equals `NAME` (fails `note new: template not found: <NAME>` otherwise), read it, run `expandTemplate(raw, { now: new Date(), title })` where `title` is the filename without dir/`.md`, and write the result.
3. Prints `{ path: rel, created: true }`.
```bash
bismuth note new "Meetings/Standup" --template "Meeting" --vault ~/vault
bismuth note new "Quick.md" --vault ~/vault   # no template
```

### `templates [--template-folder DIR]`
List available note templates (`listTemplates`). Default folder `"Templates"`.
```bash
bismuth templates --vault ~/vault --pretty
bismuth templates --template-folder "_templates" --vault ~/vault
```

### `daily`
Open (creating if needed) today's daily note. Reads the first daily-note config via `readDailyNotes(vault)`; if none configured, defaults to `{ id: "daily", label: "Daily", icon: "CalendarDays", folder: "", fileName: "{{date}}", template: "" }`. Computes the path via `dailyNotePath(config, now)`. If it already exists → prints `{ path, created: false }`. Otherwise it reads the configured template (if set and present) and writes `dailyNoteContent(config, now, templateRaw)`, then prints `{ path, created: true }`.
```bash
bismuth daily --vault ~/vault --pretty
```

---

## Search & replace commands (`commands/search.ts`)

Wraps `core/src/search.ts` `searchVault` and `core/src/replace.ts` `replaceInVault`. Both build `SearchOpts` from three shared boolean flags: `--regex` (regex mode), `--case` (case-sensitive), `--word` (whole-word). All require a vault.

### `search <query> [--regex] [--case] [--word]`
Ranked full-text search with match snippets. Empty/missing query is coerced to `""`.
```bash
bismuth search "neural net" --vault ~/vault --pretty
bismuth search "TODO\(\w+\)" --regex --case --vault ~/vault
```

### `replace <query> <replacement> [--regex] [--case] [--word]`
Vault-wide find-and-replace. Both query and replacement default to `""` if missing. The scope passed to `replaceInVault` is the literal `"vault"`. Prints the result object.
```bash
bismuth replace "colour" "color" --word --vault ~/vault --pretty
```

---

## Graph command (`commands/graph.ts`)

### `graph [--memory <dir>]`
Build the full knowledge graph (vault + optional memory) via `core/src/engine.ts` `buildGraph(vault, memoryDir)` and print it as JSON. Uses both the vault and the (optional) memory dir.
```bash
bismuth graph --vault ~/vault --memory ~/.claude/memories --pretty
bismuth graph --vault ~/vault   # vault only (empty 3rd brain)
```
(This is the command exercised by `cli/test/cli.test.ts`, which asserts the printed JSON's `nodes` contain the sample vault's note ids.)

---

## Task commands (`commands/task.ts`)

Obsidian-Tasks-compatible. Wraps `collectVaultTasks`, the `tasks-query` DSL (`runTaskQuery`), and the in-place `toggleTaskLine`. All require a vault. `today()` (local `YYYY-MM-DD`) is passed for relative-date resolution / completion stamping.

### `task list [--query <dsl>]`
List all checkbox tasks in the vault (`collectVaultTasks`). With `--query <dsl>`, the tasks are filtered through `runTaskQuery(tasks, dsl, today())` (the Tasks-query DSL — see the [tasks docs](../tasks/syntax.md)).
```bash
bismuth task list --vault ~/vault --pretty
bismuth task list --query "not done\ndue before tomorrow\nsort by due" --vault ~/vault
```

### `task toggle <file> <line>`
Toggle the done state of a task at `<file>:<line>`, where `<line>` is a **1-based** line number. Mirrors `POST /tasks/toggle`: reads the note, splits on `\n`, runs `toggleTaskLine(lines[idx], today())` on the target line (which may insert a recurrence's next occurrence — handled by splicing in place), writes it back, prints `ok`.

Validation: `<line>` must be an integer ≥ 1 (`invalid line number: <x>`), and within the file (`line out of range`). Missing args → `usage: task toggle <file> <line>`.
```bash
bismuth task toggle "Projects/Todo.md" 12 --vault ~/vault
```

---

## Base & row commands (`commands/base.ts`)

Mirrors core's `POST /rows` and `/row/*` handlers — see the [bases overview](../bases/overview.md). A base is a `type: base` markdown note; its rows live in a GFM table. All require a vault. The `today()` value is threaded into source resolution. Reads use `parseBaseFile` / `resolveSource`; row mutations use `rowOps` (`upsertRow`/`deleteRow`/`reorderRow`).

### `base read <path>`
Parse a `type: base` note and print `{ config, rows }` (`parseBaseFile(text, { name, path })`, name from `fileBasename`).
```bash
bismuth base read "Bases/Reading.md" --vault ~/vault --pretty
```

### `rows [--of '[[Base]]' | --where EXPR | --tasks DSL]`
Resolve a `SourceSpec` to a uniform `Row[]`, following base composition. Exactly one selector builds the spec (checked in this order):
- `--of '[[Base]]'` → `{ kind: "base", ref }` (render/compose another base, resolving *its* source recursively).
- `--tasks DSL` → `{ kind: "tasks", where: DSL || undefined }` (the flag value is the where-expression; an empty value means no filter).
- `--where EXPR` → `{ kind: "notes", where: EXPR }` (vault notes filtered by a Bases expression).
- none → `{ kind: "notes" }` (all vault notes).

Resolution runs server-side-equivalent via `resolveSource(spec, { root: vault, today })`.
```bash
bismuth rows --of "[[Reading]]" --vault ~/vault --pretty
bismuth rows --where "#book" --vault ~/vault
bismuth rows --tasks "not done" --vault ~/vault
bismuth rows --vault ~/vault          # all notes
```

### `row add <basePath> --json '{...}'`
Append a row to a base's table; fields come from a required `--json` object. Implemented as `upsertRow(text, ..., null, note)` (index `null` = append). Prints `{ ok: true }`.

`--json` must be valid JSON and a plain object (not array/primitive), else fails (`missing --json '{...}'` / `--json is not valid JSON` / `--json must be a JSON object`).
```bash
bismuth row add "Bases/Reading.md" --json '{"title":"Dune","status":"reading"}' --vault ~/vault
```

### `row update <basePath> <index> --json '{...}'`
Replace the row at `<index>` (integer; `<index> must be an integer` otherwise) with the `--json` fields (`upsertRow(..., index, note)`). Prints `{ ok: true }`.
```bash
bismuth row update "Bases/Reading.md" 2 --json '{"status":"done"}' --vault ~/vault
```

### `row delete <basePath> <index>`
Remove the row at `<index>` (`deleteRow`). Prints `{ ok: true }`.
```bash
bismuth row delete "Bases/Reading.md" 2 --vault ~/vault
```

### `row reorder <basePath> <from> <to>`
Move a row from one position to another (`reorderRow`). Both indices integers. Prints `{ ok: true }`.
```bash
bismuth row reorder "Bases/Reading.md" 0 3 --vault ~/vault
```

---

## Flashcard / SRS commands (`commands/card.ts`)

Reads mirror `GET /cards/*`; `card review` mirrors the dual-mode `POST /cards/review`. See the [flashcards/SRS docs](../flashcards/srs.md). All require a vault. `today()` drives due calculations + review scheduling.

### `card decks`
List flashcard decks with total + due counts (`collectDecks(vault, today())`).
```bash
bismuth card decks --vault ~/vault --pretty
```

### `card all`
List every flashcard parsed from the vault (`collectCards(vault)`).
```bash
bismuth card all --vault ~/vault --pretty
```

### `card due [--deck <name>]`
List flashcards due today (`dueCards(vault, today(), deck?)`), optionally filtered to one deck.
```bash
bismuth card due --vault ~/vault
bismuth card due --deck "Spanish" --vault ~/vault --pretty
```

### `card note <path>`
List every flashcard parsed from a single note, regardless of due date (`noteCards(vault, path)`). Required `<path>` (`usage: card note <path>`).
```bash
bismuth card note "Notes/Biology.md" --vault ~/vault --pretty
```

### `card review` — dual mode
Two distinct invocation shapes, branched on whether `--file` + `--index` are both present.

**Row card (flashcard base):** `--file <base> --index <n> --response <hard|good|easy> [--dueField <c> --easeField <c> --intervalField <c>]`. Parses the base, grabs `rows[index]` (`row not found: <file>#<index>` if absent), applies SM-2 to the row's scheduling columns via `applyReviewToRow(row.note, response, today(), undefined, fields)`, and writes it back with `upsertRow`. The custom scheduling columns are only applied when **all three** of `--dueField`/`--easeField`/`--intervalField` are given (otherwise defaults are used). `--index` must be an integer.

```bash
bismuth card review --file "Decks/Spanish.md" --index 4 --response good --vault ~/vault
bismuth card review --file "Decks/Spanish.md" --index 4 --response easy \
  --dueField due --easeField ease --intervalField interval --vault ~/vault
```

**Markdown card (legacy inline):** `<id> <response>` where `<id>` is the inline-card identifier `${notePath}::${cardIndex}::${subIndex}` and `<response>` is one of `hard|good|easy`. Calls `applyReview(vault, id, response, today())`.

```bash
bismuth card review "Notes/Biology.md::0::0" good --vault ~/vault
```

Valid responses are exactly `hard | good | easy` (`response must be one of hard | good | easy`). Both paths print `{ ok: true }`.

---

## Frontmatter property commands (`commands/prop.ts`)

Mirrors `POST /set-property` and `/delete-property`. Reads the note, mutates one frontmatter key (preserving YAML formatting via `setFrontmatterKey`/`deleteFrontmatterKey`), writes it back. All require a vault. Prints `{ ok: true }`.

**Value coercion:** the value string is run through `JSON.parse` — so `42`, `true`, `["a","b"]`, `{"k":1}`, and `"quoted"` parse as their JSON types — and falls back to the **raw string** if it isn't valid JSON (e.g. `reading` → the string `"reading"`).

### `prop set <file> <key> <value>`
```bash
bismuth prop set "Books/Dune.md" status reading --vault ~/vault          # → string "reading"
bismuth prop set "Books/Dune.md" rating 5 --vault ~/vault                # → number 5
bismuth prop set "Books/Dune.md" tags '["sci-fi","classic"]' --vault ~/vault   # → array
bismuth prop set "Books/Dune.md" favorite true --vault ~/vault           # → boolean
```

### `prop delete <file> <key>`
```bash
bismuth prop delete "Books/Dune.md" status --vault ~/vault
```

---

## Settings & folder-icon commands (`commands/settings.ts`)

Reads the merged settings feed + schema; mutates `.settings` and the per-folder icon map in place (preserving comments/key order). All require a vault.

### `settings get [--key a.b.c]`
Print the merged settings feed (`serializeSettingsForFrontend`). With `--key`, walks the dotted path and prints just that subtree/value (`undefined` printed as nothing if a segment is missing).
```bash
bismuth settings get --vault ~/vault --pretty
bismuth settings get --key appearance.theme --vault ~/vault
```

### `settings set <key.path> <value>`
Set a `.settings` value at a dotted path. The path is split on `.`; the value is coerced via `JSON.parse` (falling back to raw string, same rule as `prop set`). Calls `setSettingInFile(vault, keyPath.split("."), value)`. Prints `{ ok: true }`.
```bash
bismuth settings set appearance.theme dark --vault ~/vault
bismuth settings set ui.sidebarWidth 320 --vault ~/vault
bismuth settings set toolbar '[{"command":"search","icon":"Search"}]' --vault ~/vault
```

### `settings schema`
Print the vault's property/validation schema (`getVaultSchema`).
```bash
bismuth settings schema --vault ~/vault --pretty
```

### `folder-icon <folder> <icon> [--clear]`
Set (or, with `--clear`, clear) a folder's icon in `.settings` (`setFolderIcon(vault, folder, clear ? null : icon)`). Prints `{ ok: true }`. The args are validated: a missing `<folder>` always fails (`usage: folder-icon <folder> <icon> [--clear]`), and a missing `<icon>` fails the same way **unless** `--clear` is passed (clearing needs no icon).
```bash
bismuth folder-icon "Projects" Folder --vault ~/vault
bismuth folder-icon "Projects" anything --clear --vault ~/vault   # icon arg ignored when --clear
```

---

## Daemon commands (`commands/daemon.ts`)

Reads/writes the **`@bismuth/daemon`** runtime's on-disk state. The daemon is ONE machine process that multiplexes per-vault "brains"; its state is split in two:

- **Machine-level identity** (device-id, devices.json, owner.json, daemon.pid) lives at `~/.bismuth/daemon` (`daemonMachineDir()`, override with the `BISMUTH_DAEMON_DIR` env var). The machine-level commands — `status`, `devices`, `owner`, `install`, `setup`, `update` — **take no `--vault`**.
- **Per-vault brain** (crons, processes, memory, session-id, identity.md) lives under `<vault>/.daemon` (`vaultDaemonDir(vault)`). The per-vault commands — `daemon graph`, `daemon cron toggle`, `daemon cron run`, `daemon process toggle` — **REQUIRE a vault** (`--vault <dir>` / `BISMUTH_VAULT`) and operate on that vault's `.daemon` dir.

Mirrors the server's `/daemon/*` routes. See [daemon integration](../daemon/overview.md). status/devices/owner-read/graph just read files; owner-set, cron/process toggles, and cron-run flip frontmatter / drop trigger files the running daemon polls. install/setup register the bundled daemon service. Bismuth never starts/stops the daemon.

### `daemon status`
Print the daemon's liveness, this device id, and current owner (`daemonStatus()`).
```bash
bismuth daemon status --pretty
```

### `daemon devices`
List all heartbeating devices (each flagged owner/this) (`listDevices()`).
```bash
bismuth daemon devices --pretty
```

### `daemon owner [<deviceId>]`
With no arg → print the current owner (`getOwner()`). With `<deviceId>` → claim that device as owner (`setOwner(deviceId)`) and print the result.
```bash
bismuth daemon owner --pretty                 # read
bismuth daemon owner my-laptop-abc123         # claim
```

### `daemon install`
Print the bundled daemon's install status (read-only, never throws) (`installStatus()` from `core/src/daemonInstall.ts`): `{ installed, running, binPath }`. Probes the installed binary at `~/.bismuth/bin/bismuth-daemon` (env override `BISMUTH_DAEMON_BIN`).
```bash
bismuth daemon install --pretty
```

### `daemon setup`
Run the daemon's idempotent self-install (`runSetup()` → `<bin> --ensure-installed`), registering the launchd/systemd service that points at the bundled binary. Result: `{ ok, binPath, error? }`.
```bash
bismuth daemon setup --pretty
```

### `daemon update`
Re-register the bundled daemon service. The daemon ships with the app and updates **with** it (no git pull / no self-update) — so "update" just calls the same `runSetup()` as `daemon setup` to (re)write the service definition pointing at the freshly-staged binary. Result: `{ ok, binPath, error? }`.
```bash
bismuth daemon update --pretty
```

### `daemon graph` — **requires `--vault`**
Build this vault's daemon-mode graph (daemon hub → crons + processes, `supervises` edges) and print it as JSON (`daemonGraph(vaultDaemonDir(vault))`).
```bash
bismuth daemon graph --vault ~/vault --pretty
```

### `daemon cron toggle <name> [--off]` — **requires `--vault`**
Enable (default) or, with `--off`, disable a cron in this vault's `.daemon` dir by flipping its `enabled` frontmatter (`setCronEnabled(name, !off, vaultDaemonDir(vault))`). Prints `ok`. Missing name → `usage: daemon cron toggle <name> --vault <dir> [--off]`.
```bash
bismuth daemon cron toggle dream --vault ~/vault
bismuth daemon cron toggle dream --off --vault ~/vault
```

### `daemon cron run <name>` — **requires `--vault`**
Request the daemon to run a cron in this vault NOW by dropping a trigger file the daemon polls (`runCron(name, vaultDaemonDir(vault))`). Prints `ok`. Missing name → `usage: daemon cron run <name> --vault <dir>`.
```bash
bismuth daemon cron run dream --vault ~/vault
```

### `daemon process toggle <name> [--off]` — **requires `--vault`**
Enable (default) or, with `--off`, disable a background process in this vault's `.daemon` dir by flipping its `enabled` frontmatter (`setProcessEnabled(name, !off, vaultDaemonDir(vault))`). Prints `ok`. Missing name → `usage: daemon process toggle <name> --vault <dir> [--off]`.
```bash
bismuth daemon process toggle watcher --vault ~/vault
bismuth daemon process toggle watcher --off --vault ~/vault
```

---

## Drawing render command (`commands/draw.ts`)

### `render <file.draw> [--pdf] [--out FILE]`
Render a `.draw` file to PNG (or, with `--pdf`, PDF), **headless** via the core renderer. Reads the file directly off the filesystem with `node:fs` (NOT through the vault — `<file.draw>` is a plain filesystem path, **no `--vault` needed**), parses it with `parseDoc`, renders with `renderDocToPng` / `renderDocToPdf` using the `"dark"` theme, and writes the bytes. Output path defaults to `<file>.png` (or `.pdf`); override with `--out`. Prints `wrote <outPath>`.
```bash
bismuth render Sketch.draw
bismuth render Sketch.draw --pdf --out Sketch.pdf
```
This overlaps with `export <file.draw>` (below); `render` is the dedicated drawing-only entry point.

---

## Server commands (`commands/serve.ts`)

### `serve [--port N]`
Run the core HTTP server (graph + vault API + SSE) via `createServer({ vault, memory, port })`. Uses `requireVault` + `memoryDir`. Default port `4321`; override with `--port`. Prints `core listening on http://localhost:<port>`. The `Bun.serve` instance keeps the process alive; the command does not block on its own.
```bash
bismuth serve --vault ~/vault --memory ~/.claude/memories
bismuth serve --port 4322 --vault ~/vault
```

### `backup`
Commit a git snapshot of the vault, local only (`commitVault(vault, snapshotMessage())`). Prints `committed` or `nothing to commit`.
```bash
bismuth backup --vault ~/vault
```

---

## Universal export command (`commands/export.ts`)

### `export <file> [--format md|html|png|pdf] [--out FILE] [--no-frontmatter]`
Export a note / base / sheet / drawing to `md | html | png | pdf`, reusing the app's own exporter (`app/src/export/exporters.ts` `renderExport`) with headless deps so CLI output matches in-app export exactly. The target file is the first non-flag arg.

Format defaulting: `--format` if given, else `png` for `.draw` files, else `md`.

`--no-frontmatter` strips a plain note's leading YAML frontmatter block from the output (`ExportOptions.includeFrontmatter: false` — applies to `md` and `html` headlessly; ignored for bases/sheets/drawings, whose frontmatter is config, not content). Omit it for the default (frontmatter included, the historical behavior). See [export overview](../export/overview.md) "Include/exclude frontmatter".

Two paths:
- **`.draw` files** — rendered straight through the headless core renderer (`parseDoc` + `renderDocToPng`/`renderDocToPdf`, `"dark"` theme). Only `png` or `pdf` are valid (`a .draw file exports to png or pdf` otherwise). **No `--vault` needed** for drawings (file read with `node:fs`). This is the *only* file kind that rasterizes to `png` (or `pdf`) headlessly from the CLI.
- **Notes / bases / sheets** — `requireVault`, then `renderExport(file, fmt, deps, "dark")` with deps wiring `read` → `readNote`, `resolveRows` → `resolveSource`, and `drawingToPng` → the core renderer (so an embedded `.draw` inside a note still rasterizes). Only `md`/`html` are headless. **Both `png` AND `pdf` of notes/bases/sheets are browser-only** (the `htmlToPng`/`htmlToPdf` deps both `throw`, since both rely on `html2canvas`/`jsPDF` which need a DOM). The CLI raises a clear "open in the app" error:
  - `pdf` → *"pdf export of notes/bases/sheets is browser-only (html2canvas) — open the file in the app and export from there, or export --format html|md"*
  - `png` → *"png export of notes/bases/sheets is browser-only (html2canvas) — open the file in the app and export from there, or export --format html|md"*

Output path defaults to the exporter's chosen filename (or `<file>.<fmt>` for drawings); override with `--out`. Prints `wrote <outPath>`.
```bash
bismuth export "Notes/Essay.md" --format html --vault ~/vault
bismuth export "Notes/Essay.md" --format md --out essay.md --vault ~/vault
bismuth export "Notes/Essay.md" --format md --no-frontmatter --vault ~/vault   # body only, YAML stripped
bismuth export Sketch.draw                 # → Sketch.draw.png (no vault)
bismuth export Sketch.draw --format pdf --out sketch.pdf
bismuth export "Bases/Reading.md" --format png --vault ~/vault   # ERRORS — png is app-only
bismuth export "Notes/Essay.md" --format pdf --vault ~/vault     # ERRORS — pdf is app-only
```

---

## Server-passthrough commands (`commands/api.ts`)

These reach a **running** bismuth server for capabilities that live in the server process's memory and can't be computed headlessly (notably the in-memory relay/agent graph). API base resolution: `--api <url>` → `BISMUTH_API` env → `http://localhost:4321`. If the server is unreachable, the command fails with *"could not reach a running server at <base> — start one with `bismuth serve` (or pass --api <url>)"*. Non-2xx responses fail with `<METHOD> <path> → <status>: <body…>` (body truncated to 200 chars). JSON responses are parsed; non-JSON bodies are returned as text.

### `agent-graph [--api <url>]`
Fetch the live agents graph (terminal sessions + subagents) from a running server (`GET /agent-graph`). See the [agents/relay integration](../terminal/overview.md).
```bash
bismuth agent-graph --pretty
bismuth agent-graph --api http://localhost:4322
```

### `api <GET|POST|PUT> <path> [--json '<body>'] [--api <url>]`
Call any server route directly. `<method>` is upper-cased; `<path>` is appended to the base (a leading `/` is added if missing). With `--json`, the value is `JSON.parse`d and sent as the request body with `content-type: application/json`. Missing method/path → `usage: bismuth api <GET|POST|PUT> <path> [--json '<body>']`.
```bash
bismuth api GET /graph --pretty
bismuth api GET /tasks
bismuth api POST /set-property --json '{"path":"Books/Dune.md","key":"rating","value":5}'
bismuth api PUT /file --json '{"path":"Notes/X.md","content":"# X"}'
bismuth api GET /version --api http://localhost:4322
```
This is the escape hatch for any endpoint without a dedicated CLI command (see the full route list in the project's server documentation).

---

## App-control commands (`commands/app.ts`)

Drive a **running Bismuth app**'s tabs (and, through the bismuth MCP's `bismuth_cli` tool, from a Claude session) via core's `/ui/*` routes → a per-window control WebSocket. These need a running app (a headless CLI has no window). Core discovery: `--api <url>` → `BISMUTH_API` → `CLAUDE_RELAY_URL` → the run-registry (`~/.bismuth/run`, matched by `--vault`/`BISMUTH_VAULT`, else the single running core) → `:4321`. Full reference: [../mcp/app-control.md](../mcp/app-control.md).

- **`app windows`** — list open windows: `[{ id, label, activeTabId, tabCount }]`.
- **`app tabs [--window <id>]`** — list a window's tabs + panes.
- **`app open <content> [--new-tab] [--window <id>]`** — open a note path or sentinel (`::graph`/`::inbox`/`.settings`/`::term:<uuid>` — no `::search`; search is the in-window Cmd+O switcher, not a tab). `::chat:*` is refused.
- **`app close <tabId> [--window <id>]`** / **`app focus <tabId> [--window <id>]`** — close / activate a tab.
- **`app run <commandId> [--window <id>]`** — run a command-catalog id; a small blocklist (`new-window`/`open-folder`/`update-app`/`update-daemon`/`new-claude-chat`) is refused.
- **`app commands`** — the ids `app run` accepts (catalog − blocklist).

```bash
bismuth app windows --pretty
bismuth app open reading/Dune.md --new-tab
bismuth app run new-note --window main
```

`--window` picks a window; omitted, the single open window is used (none → 404, several → 409). A blocked `run`/`open` fails with the server's 403 message.

## Daemon inbox commands (`commands/page.ts`)

The daemon inbox (`<vault>/.daemon/pages`), headless (no server). `create` authors a **validated** page (`core/src/daemonPages.ts` `createDaemonPage`) so the nested `actions[]` frontmatter is never hand-written — see [../daemon/pages.md](../daemon/pages.md).

- **`page list [--retention-days <n>]`** — pages merged with their `.state` sidecar.
- **`page create <slug> [--title <t>] [--body <md>] [--actions '<json>'] [--source <s>] [--deliver-at <iso>]`** — refuses a bad slug / an existing page.
- **`page resolve <page-path> <actionId>`** — press an action (approve → daemon runs; dismiss → resolved locally).
- **`page mark-failed <page-path>`** — force a stuck `working` page to `failed`.

```bash
bismuth page create reply-drafts --title "Reply drafts" --body "…" \
  --actions '[{"id":"send","label":"Send","kind":"primary","prompt":"Send them."}]'
bismuth page list --pretty
```

---

## Install commands (`commands/install.ts`)

Install the `bismuth` CLI + MCP server **machine-wide** from a built tools source (the bundled app's `bismuth-tools` resource, or `--src <dir>`). Idempotent + version-gated — a no-op when the bundled binaries are unchanged. Doesn't touch the vault. See [self-update](../overview/self-update.md) and the [MCP server](../mcp/overview.md).

### `install [--src <dir>] [--status] [--dry-run]`
With `--status`, prints the `BismuthStatus` (CLI on PATH? MCP registered? installed version). Otherwise copies the compiled `bismuth`/`bismuth-mcp` + docs into `~/.bismuth`, symlinks the CLI onto PATH (`/usr/local/bin`, fallback `~/.local/bin`), and registers the MCP in the user's global Claude config (`claude mcp add -s user`). `--dry-run` reports the action with no side effects. Source dir: `--src` → `BISMUTH_INSTALL_SRC`.
```bash
bismuth install --status --pretty
bismuth install --src /path/to/bismuth-tools
```

### `uninstall`
Removes the machine-wide CLI symlink (if it's ours), the global MCP registration (`claude mcp remove -s user bismuth`), and `~/.bismuth`.

## Checkpoint commands (`commands/checkpoint.ts`)

A **checkpoint** is a lightweight git ref (`refs/bismuth/<name>`) marking how far a periodic consumer has processed a repo's autosave history — a *bookmark*, not a branch. Every consumer reads the same linear history and remembers its own position, so they advance independently, side by side (invisible to normal git, never pushed). This lets background jobs process only "what changed since I last ran": the **dream** cron over a vault's memory repo `<vault>/.daemon/memory` (`refs/bismuth/dream`), **vault-review** over the vault (`refs/bismuth/vault-review`). Headless; generic over any git-tracked dir via `--dir` (falls back to `--vault`/`BISMUTH_VAULT`). By default each op commits pending changes first so the delta reflects the latest on-disk state — pass `--no-commit` to diff against existing history only (e.g. a protected vault).

### `checkpoint diff <ref> --dir <path> [--no-commit]`
Lists files changed since `refs/bismuth/<ref>`: `{ base, head, files: [{status, path}] }`. First run (ref unset) → `base: null` and every tracked file at HEAD is reported as added (`status: "A"`).
```bash
bismuth checkpoint diff dream --dir "$HOME/Documents/library of alexandria/.daemon/memory" --pretty
bismuth checkpoint diff vault-review --dir "$HOME/Documents/library of alexandria" --no-commit
```

### `checkpoint advance <ref> --dir <path> [--no-commit]`
Moves the ref to HEAD (call after successfully processing the delta). Returns `{ ref, head }`.

### `checkpoint ref <ref> --dir <path>`
Prints the ref's current SHA: `{ ref, sha }` (`sha: null` if unset).

---

## Calendar commands (`commands/calendar.ts`)

Edit a calendar base file **by API** instead of hand-editing raw YAML — the app rewrites hand-edited YAML (strips quotes, adds `localUpdated`) and can't cleanly remove a single recurring occurrence. A calendar is a `type: base` + `view: calendar` markdown file: events live in the base's row table, categories in frontmatter. Every write preserves the WHOLE frontmatter and touches only events + categories (ported from the app's calendar backend into `core/src/calendar.ts`). All commands are **headless** (the app's vault watcher picks up writes live) and **require a vault**. Bridged to the MCP as `bismuth_cli` (no new MCP tool), so `bismuth_cli_help` lists them — this is the Claude-side calendar-management surface.

**Google-Calendar sync safety.** These commands are safe on a gcal-synced calendar: the sync manifest lives outside the vault (`~/.bismuth/gcal/sync.json`), events are identified by their `id` column (preserved by every mutation), and each create/edit stamps `localUpdated` exactly like the app — so the two-way sync sees CLI edits as ordinary local edits. A locally deleted event is deleted from Google on the next sync (by design). See `docs/gcal/overview.md`.

**Event-field flags (shared).** The mutating commands (`add`, `move`, `override`) build event fields from an optional `--json '{...}'` object first, then overlay convenience flags (**flags win**): `--title`, `--date` (→ `date`), `--start` (→ `startTime`), `--end` (→ `endTime`), `--location`, `--link`, `--description`, `--category`, and `--recurrence '{...}'` (→ `recurrence`). `--json` must be a valid JSON **object** (`--json is not valid JSON` / `--json must be a JSON object`). `--recurrence` must be valid JSON (`--recurrence is not valid JSON` / `--recurrence must be a JSON object`); if its `seriesId` is absent, a `crypto.randomUUID()` is filled in. The `Recurrence` JSON shape is `{"type": "daily"|"weekly"|"biweekly"|"monthly", "startDate": "YYYY-MM-DD", "endDate"?: "YYYY-MM-DD", "daysOfWeek"?: [0-6, Sunday=0], "seriesId"?: "..."}`. `calendar add` also accepts `--rrule` (an iCal RRULE) as a friendlier alternative — see below.

### `calendar bases`
Discover the vault's calendar base files: every `.md` whose frontmatter is `type: base` with a calendar view (`view: calendar` shorthand, or a `views:` array containing `{type: calendar}`). Prints `[{ path, title, events, categories }]` (title falls back to the basename; `categories` is the name list). Use this to find the `<basePath>` the other commands take.
```bash
bismuth calendar bases --vault ~/vault --pretty
```

### `calendar create <basePath> [--title '...']`
Create a new, empty calendar base file (`type: base` + `view: calendar` frontmatter). `.md` is appended when missing; parent folders are created; an existing path fails with `EEXIST` (never clobbers). Prints `{ ok: true, path }`.
```bash
bismuth calendar create "Bases/Team Cal" --title "Team Cal" --vault ~/vault
```

### `calendar list <basePath> [--from YYYY-MM-DD --to YYYY-MM-DD]`
List **raw stored events** — recurring masters unexpanded, with their real ids (this is how you find an `<id>` for `move`/`delete`/`override`). Optional window: singles filter by `date`, masters by series-window intersection; either bound may be omitted.
```bash
bismuth calendar list "Bases/Cal.md" --from 2026-07-01 --to 2026-07-31 --vault ~/vault --pretty
```

### `calendar range <basePath> <from> <to>`
List **concrete event instances** in `[from, to]` with recurrences expanded (one instance per matching date), sorted by date then start time (`eventsForRange`).
```bash
bismuth calendar range "Bases/Cal.md" 2026-07-06 2026-07-12 --vault ~/vault --pretty
```

### `calendar day <basePath> <date>`
List a day's events with recurrences expanded to concrete instances (`eventsForDay`). Both positionals required (`<basePath> required` / `<date> (YYYY-MM-DD) required`). Prints the event array (read-only).
```bash
bismuth calendar day "Bases/Cal.md" 2026-07-10 --vault ~/vault --pretty
```

### `calendar get <basePath> <id>`
Print one event by id, as stored. Fails with `no event with id <id>` when absent.
```bash
bismuth calendar get "Bases/Cal.md" evt-123 --vault ~/vault --pretty
```

### `calendar search <basePath> <text> [--from YYYY-MM-DD --to YYYY-MM-DD]`
Case-insensitive substring search over `title`/`description`/`location`/`category`/`categories`. Default: searches raw stored events (masters unexpanded). With **both** `--from` and `--to`: searches the expanded concrete instances in that window instead. Multi-word text works positionally (`calendar search Cal.md team sync`).
```bash
bismuth calendar search "Bases/Cal.md" dentist --vault ~/vault
bismuth calendar search "Bases/Cal.md" standup --from 2026-07-01 --to 2026-07-31 --vault ~/vault
```

### `calendar overlaps <basePath> <date>`
Detect overlapping timed events on a given day (`detectOverlaps(eventsForDay(...))`). Prints `{ date, overlaps }` where `overlaps` is the array of colliding pairs (read-only). Both positionals required.
```bash
bismuth calendar overlaps "Bases/Cal.md" 2026-07-10 --vault ~/vault --pretty
```

### `calendar add <basePath> [--json '{...}'] [--title … --date … --start … --end … --recurrence '{...}' --rrule '…']`
Add an event; fields come from the shared `--json`/convenience flags above. `--date` (YYYY-MM-DD) is **required** (`--date (YYYY-MM-DD) required`); `<basePath>` required. `--rrule` accepts an iCal RRULE (`RRULE:` prefix optional; same subset the gcal sync supports — `FREQ=DAILY|WEEKLY|MONTHLY`, `INTERVAL=2` with `FREQ=WEEKLY` for biweekly, `BYDAY`, `UNTIL`; no `COUNT`/`YEARLY`) and normalizes the event's date to the first valid occurrence; an explicit `--recurrence` wins over `--rrule`. Calls `addEvent`, writes the calendar back, prints `{ ok: true, event }` (the created event, with its new id).
```bash
bismuth calendar add "Bases/Cal.md" --date 2026-07-10 --title "Standup" --start 09:00 --end 09:15 --vault ~/vault
bismuth calendar add "Bases/Cal.md" --date 2026-07-10 --title "Weekly" --rrule 'FREQ=WEEKLY;BYDAY=FR' --vault ~/vault
bismuth calendar add "Bases/Cal.md" --date 2026-07-10 --title "Daily" \
  --recurrence '{"type":"daily","startDate":"2026-07-10"}' --vault ~/vault
```

### `calendar move <basePath> <id> [--date … --start … --end … --json '{...}' …]`
Move/edit an event by id: overlay any of the shared event fields (`--date`/`--start`/`--end`/`--json`/…). At least one field must be provided (`nothing to update — pass --date/--start/--end/--json …`); `<basePath>` and `<id>` required. Calls `moveEvent`, writes back, prints `{ ok: true, event }` (the updated event, re-read via `findEvent`).
```bash
bismuth calendar move "Bases/Cal.md" evt-123 --date 2026-07-11 --start 10:00 --vault ~/vault
```

### `calendar delete <basePath> <id>`
Delete an event by id (`deleteEvent`). `<basePath>` and `<id>` required. Prints `{ ok: true }`.
```bash
bismuth calendar delete "Bases/Cal.md" evt-123 --vault ~/vault
```

### `calendar override <basePath> <id> <date> [--title … --start … --end … --json '{...}' …]`
Override **one** occurrence of a recurring event on a specific `<date>`, **splitting the series** (`overrideOccurrence`). The occurrence date is the positional `<date>` — a `--date` flag would be ambiguous, so any `date` field is stripped from the overlaid updates before applying. `<basePath>`, `<id>` (the recurring event), and `<date>` (YYYY-MM-DD occurrence) all required. Prints `{ ok: true }`.
```bash
bismuth calendar override "Bases/Cal.md" evt-weekly 2026-07-17 --title "Moved standup" --start 11:00 --vault ~/vault
```

### `calendar delete-occurrence <basePath> <id> <date>`
Delete **one** occurrence of a recurring event on a specific `<date>`, splitting the series (`deleteOccurrence`). Same three required positionals as `override`. Prints `{ ok: true }`.
```bash
bismuth calendar delete-occurrence "Bases/Cal.md" evt-weekly 2026-07-17 --vault ~/vault
```

### `calendar categories <basePath>`
List the calendar's categories: `[{ name, color }]` from frontmatter (read-only).
```bash
bismuth calendar categories "Bases/Cal.md" --vault ~/vault --pretty
```

### `calendar category add <basePath> <name> [--color '#b00020']`
Add a category. `--color` is any CSS color (`"#b00020"`, `rgb(...)`, named) **or a theme token** (`accent`, `teal`, `blue`, `violet`, `green`, `gold`, `rose`) — defaults to `accent`. A duplicate name fails (`CALENDAR_CATEGORY_EXISTS`). Prints `{ ok: true, categories }`.
```bash
bismuth calendar category add "Bases/Cal.md" Work --color '#b00020' --vault ~/vault
```

### `calendar category update <basePath> <name> [--rename <newName>] [--color <c>]`
Rename and/or recolor a category. A rename **cascades** into every event's `category`/`categories` fields (each changed event gets a fresh `localUpdated`, keeping gcal sync consistent). At least one of `--rename`/`--color` is required; renaming onto an existing name fails. Prints `{ ok: true, categories }`.
```bash
bismuth calendar category update "Bases/Cal.md" Work --rename Job --color teal --vault ~/vault
```

### `calendar category remove <basePath> <name> [--reassign <otherCategory>]`
Remove a category. Events referencing it get the category **cleared** — or reassigned to `--reassign <other>` (which must be another existing category). Prints `{ ok: true, categories }`.
```bash
bismuth calendar category remove "Bases/Cal.md" Work --reassign Personal --vault ~/vault
```

---

## Command index (by domain)

| Command | Group file | Needs vault? | Output |
|---|---|---|---|
| `read` `write` `move` `delete` `restore` `mkdir` `tree` | file.ts | yes | mixed (delete/tree JSON; others none) |
| `note new` `templates` `daily` | note.ts | yes | JSON |
| `search` `replace` | search.ts | yes | JSON |
| `graph` | graph.ts | yes (+optional memory) | JSON |
| `task list` `task toggle` | task.ts | yes | JSON / `ok` |
| `base read` `rows` `row add` `row update` `row delete` `row reorder` | base.ts | yes | JSON / `{ok:true}` |
| `card decks` `card all` `card due` `card note` `card review` | card.ts | yes | JSON / `{ok:true}` |
| `prop set` `prop delete` | prop.ts | yes | `{ok:true}` |
| `settings get` `settings set` `settings schema` `folder-icon` | settings.ts | yes | JSON / `{ok:true}` |
| `calendar bases/create/list/range/day/get/search/overlaps/add/move/delete/override/delete-occurrence` + `calendar categories` + `calendar category add/update/remove` | calendar.ts | yes | JSON / `{ok:true}` |
| `daemon status/devices/owner/install/setup/update` | daemon.ts | **no** (machine `~/.bismuth/daemon`) | JSON / `ok` |
| `daemon graph` `daemon cron toggle/run` `daemon process toggle` | daemon.ts | **yes** (per-vault `<vault>/.daemon`) | JSON / `ok` |
| `render` | draw.ts | **no** (filesystem path) | `wrote <file>` |
| `serve` `backup` | serve.ts | yes (+optional memory) | string |
| `export` | export.ts | yes (no for `.draw`) | `wrote <file>` |
| `agent-graph` `api` | api.ts | **no** (needs running server) | JSON / text |
| `app windows/tabs/open/close/focus/run/commands` | app.ts | **no** (needs running app; discovery via `BISMUTH_API`/`CLAUDE_RELAY_URL`/run-registry) | JSON |
| `page list/create/resolve/mark-failed` | page.ts | **yes** (per-vault `<vault>/.daemon/pages`) | JSON |
| `install` `uninstall` | install.ts | **no** (machine-wide `~/.bismuth` + global MCP) | JSON |
| `checkpoint diff/advance/ref` | checkpoint.ts | **no** (any git dir via `--dir`) | JSON |

Source: cli/src/index.ts, cli/src/args.ts, cli/src/types.ts, cli/src/commands/file.ts, cli/src/commands/note.ts, cli/src/commands/search.ts, cli/src/commands/graph.ts, cli/src/commands/task.ts, cli/src/commands/base.ts, cli/src/commands/calendar.ts, cli/src/commands/card.ts, cli/src/commands/prop.ts, cli/src/commands/settings.ts, cli/src/commands/daemon.ts, cli/src/commands/draw.ts, cli/src/commands/serve.ts, cli/src/commands/export.ts, cli/src/commands/api.ts, cli/src/commands/app.ts, cli/src/commands/page.ts, cli/src/commands/install.ts, cli/src/commands/checkpoint.ts, cli/package.json, cli/test/cli.test.ts, core/src/uiControl.ts, core/src/runRegistry.ts, core/src/daemonPages.ts, core/src/daemon.ts, core/src/daemonInstall.ts, core/src/daemonGraph.ts, core/src/files.ts, core/src/backup.ts, core/src/bismuthInstall.ts, core/src/settings.ts
