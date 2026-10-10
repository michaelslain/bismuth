# Migrating from an older version

Bismuth reads vaults and settings written by its own older builds, converting most of them on
its own. This page lists what an older vault or install can contain, what Bismuth does with it, and
what you need to do yourself, if anything. It is the one page in these docs about earlier versions;
every other page describes the current app.

Start with `bismuth doctor`, which finds most of these and explains each one:

```bash
bismuth doctor --vault <vault>        # list findings, change nothing
bismuth doctor --vault <vault> --fix  # apply the safe repairs
```

See [Doctor](doctor.md) for what each finding means and which repairs need your OK.

## Notes and tasks

| what you have | what happens | what you do |
|---|---|---|
| Task lines written with Obsidian Tasks emoji (📅 ⏳ 🛫 ✅ ➕ ❌ 🔺 ⏫ 🔼 🔽 ⏬ 🔁) | Task views show no due date, priority or recurrence for them. The desktop app converts a vault to bracketed fields on first open, after taking a local git snapshot. `BISMUTH_NO_TASK_MIGRATE=1` skips that pass. | Nothing, or convert by hand: `bismuth task migrate --vault <vault> --dry-run`, then without `--dry-run`. Task lines inside fenced code are left as they are. |
| A ` ```query ` block whose `tasks:` holds Tasks-plugin text (`not done`, `due before tomorrow`) | Translated into a Bases filter every time it is read. | Optional: `bismuth base migrate-queries --vault <vault>` rewrites it to `tasks:` + `where:` + `sort:`. See [Tasks-plugin query text](../tasks/query-dsl.md). |
| A ` ```query ` block that iterates notes with `from: notes where …` | A query block has no notes source, so it renders its empty state. | Move it into a `type: base` note with `source: notes where …`, or an inline block whose first key is `source:`. |
| `as: <kind>` in a ` ```query ` block | Read as `view: <kind>`. | Optional: write `view:`. |
| `![[Sketch.draw]]` in a note | Shown as plain text: a `.draw` file is not embeddable. | Open the drawing in its own tab, or draw on the note with draw mode ([Note ink](../editor/ink.md)). |
| A `.draw` file or an image or PDF ink sidecar (`<file>.<ext>.draw`) saved as JSON Lines: a header line, then one line per page that has ink | A build that reads only the one-object form shows no ink for it, and on a sidecar its first stroke replaces the file, which loses the ink. Bismuth rewrites a one-object drawing as JSON Lines on its next save. | Update every Bismuth install that opens the vault (desktop, iPad, CLI, daemon) before you draw on a PDF or image. See [Drawing](../drawing/overview.md#the-draw-file-format). |
| A `.ink/` folder of sidecar files | Ink lives in ` ```draw ` fences inside notes. Doctor finding `vault.ink-dir` removes the folder when every sidecar is empty and leaves it alone otherwise. | Run `bismuth doctor --fix`. A folder that still holds data needs a look by hand. |
| A `DAEMON.md` file at the vault root | Not read. Doctor finding `vault.daemon-md`. | Run `bismuth doctor` and follow the finding. |

## Bases

| what you have | what happens | what you do |
|---|---|---|
| A markdown base (a `type: base` note) | Still read and written as markdown. New bases are `.base.jsonl` files, where line 1 is the config and each later line is one row, so `grep` returns whole rows and a row edit changes one line. | Nothing, or convert: `bismuth base migrate --all --dry-run --vault <vault>` prints the plan, then run it without `--dry-run`. Each `<name>.md` becomes `<name>.base.jsonl` and the `.md` moves to the vault trash. Google Calendar sync settings and sync state carry over. A base whose body has text but no rows is refused, and lines that are neither table rows nor list items are dropped and counted in the output. A base that already has a `.base.jsonl` beside it is refused. See [Bases overview](../bases/overview.md#where-are-a-bases-own-rows-stored). |
| A base with a `views:` list of one entry | Read through that entry; the app's next write flattens it to `view: <kind>` with the keys at the top level. Doctor finding `vault.base-views-list`. | Nothing. |
| A base with a `views:` list of several entries | Read through the first entry only. App writes to it fail with `BASE_VIEWS_FORMAT_ERROR`, and `bismuth base validate` reports it. Doctor finding `vault.base-views-multi`. | Give each extra view its own base with `source: base` and `ref: "[[This Base]]"`, then delete the `views:` list. |
| A base body written as a GFM pipe table | Read as rows; the first row write converts the body to a YAML list. | Nothing. |
| `calendarContent: tasks` on a calendar base | Read as `mode: tasks`; `mode:` wins when both are present. | Optional: write `mode: tasks`. |
| `descriptionField:` on a kanban base | Ignored. A `description` property renders as markdown by default. | Delete the key, or declare `properties: [{ name: description, type: markdown }]`. |
| A flashcards base whose cards come from `source: notes …`, with grades failing ("row not found") or landing on the wrong card | Grades are written to the base file's own rows by position. | Move the cards into the base file's own body as a YAML list of `front`/`back` rows and remove `source:`. |
| A cards, bullets or list base with `source: tasks` and no `mode:` | Cards and bullets show plain items; list shows checkboxes. | Add `mode: tasks`. |

## Settings

Every row below is handled when Bismuth reconciles `.settings`, which happens at core start, on
every save of `.settings` from the editor, and before each single-key write.

| what you have | what happens | what you do |
|---|---|---|
| `settings.yaml` at the vault root, or a `.settings/` folder holding `settings.yaml` | Renamed to the single `.settings` file (copied if the rename fails, leaving the original as a backup). Doctor finding `vault.settings-location`. | Nothing; rename it by hand if Bismuth cannot. |
| `appearance.theme` set to `oxide-duotone`, `gunmetal-teal`, `rose-gold`, `indigo-oxide`, `forest-oxide`, `full-sheen`, or a `-light` variant | A dark name becomes `ink`, a `-light` name becomes `paper`, and the old size keys (`appearance.editorFontSize`, `uiFontSize`, `tabFontSize`, `iconSize`, `monoScale`, `sidebarWidth`, `editor.lineHeight`) are deleted so defaults apply. | Pick `ink`, `paper`, `cathode` or `riso` if the mapping is not what you want ([Themes](../settings/themes.md)). |
| `terminal.cursorWidth`, `terminal.cursorGlideMs`, `terminal.cursorBlinkSeconds` | Moved to `appearance.cursorWidth`, `appearance.cursorGlideMs`, `appearance.cursorBlinkSeconds`; an existing `appearance.*` value wins. | Nothing. |
| `daemon.recall.semantic`, or no such key (meaning-based recall was on by default) | A saved value moves to `embeddings.enabled`; an existing `embeddings.enabled` wins. With neither, `embeddings.enabled` is `false`, so recall and search match by words only. | Set `embeddings.enabled: true` for meaning-based matching. |
| `appearance.sidebarIconFontSize` or `appearance.toolbarIconSize` | Renamed to `appearance.iconSize`; an existing `iconSize` wins. | Nothing. |
| `appearance.editorFont`, `appearance.paletteInputFontSize`, `appearance.tabFontSize`, `editor.defaultMode`, `daemon.home`, `daemon.autoUpdate`, the `terminal` section (`fontSize`, `lineHeight`) | Removed. Doctor finding `vault.settings-retired-keys`. The auto-update switch is `update.autoUpdate`; a terminal's text follows `appearance.editorFontSize` and `editor.lineHeight`. | Nothing. |
| A `.settings` that lists every default | When at least half the schema's leaves sit at exactly their default, every default-valued leaf and empty section is stripped; comments, unknown keys and non-default values stay. | Nothing. |
| Graph keys `repulsion`, `linkDistance`, `centering`, `nodeSize` and the `nodeSize*Mult` keys | Accepted and validated; nothing reads them. | Delete them. |
| `googleCalendar.enabled`, `calendarId`, `basePath` (one global sync mapping) | Still used as a fallback for the base `basePath` names. | Open that calendar's settings and turn on sync there, which writes `googleCalendarSync` and `googleCalendarId` on the base ([Google Calendar sync](../gcal/overview.md)). |
| A custom theme in `.themes/` with top-level colour keys (`background`, `isLight`, …) | `bismuth theme validate` warns `<key>: moved`. | Move each key under `tokens:` with the token name from the warning; `bismuth theme tokens` lists the names ([Custom themes](../guides/custom-themes.md)). |

## Backups, sync and the machine

| what you have | what happens | what you do |
|---|---|---|
| Stale rules in the vault's `.git/info/exclude` (`.settings`, `.daemon`, `.ink/.daemon/`, `settings.yaml`) that keep settings or daemon files out of snapshots | The next snapshot prunes them. Doctor finding `vault.backup-exclude`. | Nothing, or `bismuth doctor --fix` now. |
| Sandbox profiles piling up in `.daemon/tmp` | Doctor finding `vault.visibility-profiles`. | `bismuth doctor --fix`. |
| A Google-synced base that `bismuth gcal health` does not list | Sync records from older builds are claimed by the installed app only. | Run `bismuth gcal health --vault <dir> <basePath>` to see it marked `legacy: true`, then run a real sync to claim it. |
| A `~/.claude-bot` brain (memory, crons, processes) from an older daemon | Copied once into the first vault whose daemon you enable; existing files are never overwritten and the source is never deleted. `BISMUTH_LEGACY_CLAUDE_BOT_DIR` points it at another source. | Nothing. |
| A `crons/vault-review.md` beside the stock `dream` cron | Renamed to `vault-review.md.disabled` at the next brain start; `dream` continues from its checkpoint. A hand-edited `dream.md` keeps `vault-review` running. | Nothing; rename it back to restore it. |
| A stock `crons/dream.md` from an older build | Replaced with the current `dream` at the next brain start. A hand-edited `dream.md` is never touched. | Nothing. |
| `daemon.name` in `.settings` | Not read; the name lives in `.daemon/identity.md` frontmatter. | Move the name there ([Set up the daemon](../daemon/setup.md)). |
| A saved tab or script that opens `::inbox` or `::search` | Persisted tabs and `bismuth app` open requests are remapped to `::daemon` and `::graph`. | Use `::daemon` and `::graph` in scripts. |
| A daemon service unit or binary from an older install | Doctor findings in the `daemon` section (`daemon.unit-old-home`, `daemon.binary-skew`, …). | `bismuth doctor --fix`; repairs that stop or replace the service show in the launch toast for your OK. |
| `~/.claude/skills/<id>` symlinks into `~/.bismuth` | Removed by the machine-wide install and by `bismuth uninstall`. | Nothing. |
| App config saved under `com.michael.obsidian` | Moved to `com.bismuth.app` on launch when the new directory does not exist. | Nothing. |
| A browser `localStorage` key `three-brains.settings` | Read once, imported, then removed. | Nothing. |

Source: `core/src/doctor/sections/`, `core/src/settings.ts`, `core/src/taskMigrateRun.ts`,
`core/src/bases/parse.ts`, `core/src/bases/taskDsl.ts`
