# Autocomplete

Typing a trigger such as `[[`, `#`, `/` or `:` in a note opens a popup of completions: notes, tags, frontmatter properties, blocks, emoji, task fields and more. Press `Ctrl+Space` to open the popup by hand at any caret position. This page lists every trigger and what it completes, for the note editor, table cells, the chat composer and the `.settings` file.

## Which triggers open a popup?

| You type | Where | It completes |
|---|---|---|
| `[[` | note body, table cell, composer | Note names; see [Complete wikilinks and headings](#complete-wikilinks-and-headings) |
| `[[Note#` | note body, table cell, composer | The headings of `Note` |
| `#` after a space or at line start | note body, table cell, composer | Existing tags |
| `??` after a space or at line start | note body, composer | Memory notes (3rd brain), needs the daemon enabled |
| `/` as the first thing on a line | note body, table cell | A block to insert: heading, table, code, callout and more |
| `@` after a space or at line start | chat composer only | A vault file, inserted as a wikilink |
| `:` after a space or at line start | note body, table cell, composer | Emoji, by name or keyword |
| `{{` | note body and frontmatter | Template tokens |
| A key at column 0 in frontmatter | note frontmatter | Property names from the property registry |
| The value of an enum or boolean property, `icon:` or `tags:` in frontmatter | note frontmatter | Allowed values, icon names, or tag lists |
| A keyword on a `- [ ]` task line | note body | Task fields such as `[due ` and `[high]` |
| Inside a `[due `, `[every ` bracket | task line | Dates and recurrence rules |
| A key, `view:`, `where:` or `group:` inside a `query` fence | note body | Query keys, filters and group fields |
| A key or value in `.settings` | the `.settings` file | Setting keys, enum values, icons, keybindings, paths |

`[[`, `#` and `:` are prose triggers. They stay silent inside inline code, fenced code, and (for `:`) inside an open `$...$` math span, where the same characters are literal.

Press `Tab` or `Enter` to accept the highlighted option and `Escape` to dismiss the popup. `Tab` is the `accept-completion` keybinding and `Ctrl+Space` (or `Mod+Shift+Space`, which avoids the macOS input-source switcher) is `open-completion`; both are rebindable in `.settings`. `Enter` accepting is fixed. See [Keybindings](../settings/keybindings.md).

Every source stays silent unless its own trigger matches, so popups rarely overlap. Where triggers could collide, the sources yield to each other: wikilinks give way to heading completion once the link contains a `#` after a real note, and emoji stays quiet inside an open `[[`.

## Complete wikilinks and headings

Typing `[[` opens a list of every note in the vault, showing the note's name with its folder path beside it. Picking one inserts the name and closes the link with `]]`, with the caret after the brackets.

```markdown
[[Proj        ->  [[Project Alpha]]
```

If two notes share a base name, the option inserts the full vault path instead, so the link stays unambiguous: `[[work/Project Alpha]]`.

Once the link contains a `#` after a name that matches a real note, the popup lists that note's headings instead. Picking one inserts the heading text and closes the link: `[[Project Alpha#Goals]]`. If the part before `#` does not match a note (a note literally named `C# Notes`), the popup stays in note mode so the full name still completes. A link to an unknown note offers no headings.

Wikilink targets resolve by file name first and by path second; see [Wikilinks and tags](../vault/wikilinks-tags.md).

## Reference a memory note

Typing `??` after a space or at the start of a line lists the daemon's memory notes. Picking one inserts its slug after the `??`, and the text `??cron-run-preference` stays in the file as written. Clicking a rendered `??slug` opens `<vault>/.daemon/memory/<slug>.md`.

Memory notes exist only while the daemon is enabled for the vault. With the daemon off the list is empty and the popup never opens. The picker is available in the note editor and the chat composer, not in table cells.

A line that is exactly `??` is the multi-reversed flashcard separator, not a reference. Pressing `Enter` on such a line closes the popup and inserts a newline, so writing a flashcard with `??` and Enter works; see [Flashcards](../flashcards/srs.md).

## Complete tags

Typing `#` after a space or at the start of a line, followed by letters, digits, `_`, `-` or `/`, lists the vault's existing tags. Picking one inserts the name after the `#`. Headings (`# Title`) and mid-word `#` such as `C#` do not trigger it.

```markdown
#prog   ->   #programming
```

The popup stays open while you type nested separators such as `projects/alpha`.

## Complete frontmatter properties

Inside the `---` block at the top of a note, four completions apply. The property registry behind them is the `properties:` section of `.settings`; edit it and the completions update without a reload.

| Where the caret is | Offers | Inserts |
|---|---|---|
| An unindented partial key with no `:` yet | Registered property names starting with what you typed | `name: ` |
| After `key:` where `key` is registered as an enum or a boolean | The allowed values | The value |
| After `icon:` | Lucide icon names, prefix matches first, at most 50 | The name (emoji are also allowed; the list only suggests) |
| After `tags:` | Existing tags, for the segment after the last comma | The tag name |

Typing `ty` on a blank frontmatter line suggests `type` when `type` is registered. If a key is not registered, no values are offered.

## Pick a date for a date property

When the caret sits in the value of a frontmatter property registered as `date` or `datetime`, a small popover opens with a native date input (plus a time input for `datetime`) and a list of relative dates: today, tomorrow, in a week and the like. `ArrowUp` and `ArrowDown` move through the list, `Enter` picks the highlighted entry, and `Escape` dismisses the popover until the caret leaves the property.

A `date` property closes the popover once you pick. A `datetime` property stays open after you set the date so you can enter the time.

## Insert blocks with the slash menu

Typing `/` as the first character of a line, ignoring indentation and a leading `- ` or `1. ` list marker, opens a menu of blocks. It stays quiet for a slash mid-text (`and/or`, a path, `6/9`) and inside frontmatter and fenced code. Keep typing to narrow the list; the match works on exact label or keyword, then prefix, then subsequence, so `tbl` finds Table and `h1` finds Heading 1. A space or any non-word character closes the menu.

| Item | Inserts |
|---|---|
| Heading 1, 2, 3 | `# `, `## `, `### ` |
| Bullet list | `- ` |
| Numbered list | `1. ` |
| To-do | `- [ ] ` |
| Quote | `> ` |
| Callout | `> [!note] ` |
| Table | A starter pipe table |
| Code block | A fenced block |
| Query block | A `query` fence, then offers query keys inside it |
| Query builder | Opens a visual builder and inserts the finished `query` fence; offered in the note editor only |
| Graph block | A `graph` fence; see [The graph block](graph-block.md) |
| Math block | A `$$` block |
| Divider | A blank line and `---` |
| Page break | `<!-- pagebreak -->`, invisible on screen; the PDF export starts a new page there |
| Link to note | `[[]]`, then opens the wikilink popup |
| Embed | `![[]]`, then opens the wikilink popup |
| Properties | A frontmatter block with `tags: `; offered only at the very start of a note that has no frontmatter yet |
| Today's date | Today as `YYYY-MM-DD` |

The divider starts with a blank line on purpose: `---` directly under a paragraph is a setext heading underline, not a rule.

## Mention a file in the chat composer

In the chat composer, `@` after a space or at the start of a line lists every file in the vault, ranked by name then path, at most 50. Picking one inserts `[[Name]] ` and adds that file to the chat's context. The `@` stays literal inside code spans and in email addresses. The note editor and table cells do not offer this popup.

## Complete template tokens

Typing `{{` opens the four template tokens: `{{date}}`, `{{time}}`, `{{title}}` and `{{cursor}}`. It works in the note body and in frontmatter, and in the `fileName` field of a daily-note entry in `.settings`. Picking one replaces the `{{...` you typed with the full token and puts the caret after the closing braces. The popup stays open while you type an offset or format such as `{{date+1d` or `{{date:YYYY`. Token meanings are on [Template tokens and daily notes](../templates/syntax.md).

## Insert emoji

Typing `:` after a space or at the start of a line, then a name or keyword, lists matching emoji. The best match is selected first, so `:rocket` and Enter inserts the rocket.

Matching ranks an exact shortcode first, then shortcode prefix, exact keyword, shortcode substring, keyword prefix and keyword substring. Queries of three or more characters also match with typos, so `:rocekt` finds the rocket. A bare `:` shows the most-used emoji. If nothing matches, no popup opens, and a query with no letters or digits (`:_`) matches nothing.

The popup lists emoji only. For the full gallery, use the `emoji-library` toolbar command or the Emoji library action on the left edge of the right-click menu; see [Toolbar commands](../settings/toolbar-commands.md).

## Task metadata completion

On a checkbox line (`- [ ] ...`), typing the start of a field name of two or more letters offers the matching bracket field; `Ctrl+Space` shows all of them. Picking a dated or recurring field inserts its opening and reopens the popup for the value. Typing the bracket yourself works too: `[due` replaces to `[due ` instead of doubling the bracket.

| Keywords | Inserts | Then offers |
|---|---|---|
| `due` | `[due ` | A date |
| `scheduled` | `[scheduled ` | A date |
| `start`, `starts` | `[start ` | A date |
| `repeat`, `recurring`, `recur`, `every` | `[every ` | A recurrence rule |
| `priority`, `highest`, `urgent` | `[highest]` | Nothing |
| `priority`, `high` | `[high]` | Nothing |
| `priority`, `medium` | `[medium]` | Nothing |
| `priority`, `low` | `[low]` | Nothing |
| `priority`, `lowest` | `[lowest]` | Nothing |
| `done`, `completed` | `[done ` | A date |
| `created` | `[created ` | A date |
| `cancelled`, `canceled` | `[cancelled ` | A date |

Inside an open date field (`[due `, `[scheduled `, `[start `, `[done `, `[created `, `[cancelled `) the popup offers these values, each showing its resolved date beside it. Picking one inserts the ISO date and the closing bracket, as in `[due 2026-09-14]`.

| Label | Resolves to |
|---|---|
| `today` | Today |
| `yesterday` | Today minus 1 day |
| `tomorrow` | Today plus 1 day |
| `in 2 days`, `in 3 days` | Today plus 2 or 3 days |
| `in a week`, `in two weeks` | Today plus 7 or 14 days |
| `monday` to `sunday` | The next such weekday, 1 to 7 days ahead |

Inside `[every ` the popup offers `every day`, `every week`, `every weekday`, `every month`, `every year` and `every 2 weeks`, and closes the bracket. The field syntax itself is on [Task syntax](../tasks/syntax.md).

## Query block completion

Inside a `query` fence, the popup depends on the line:

| Line so far | Offers |
|---|---|
| A partial key with no `:` | The keys `of`, `tasks`, `from`, `where`, `sort`, `view`, `group`, `limit`, each with a one-line help tooltip |
| `view: ` or `as: ` | Every view kind; the kinds are listed on [Bases overview](../bases/overview.md) |
| `where: ` | Starter filters such as `!note.resolved`, `note.due == today()`, `note.priority == "high"`, `file.hasTag("book")` |
| `group: ` | `status`, `priority`, `due`, `scheduled`, `file.folder`, `file.name` |
| `of: ` or `from: ` with no value | A `[[ ]]` skeleton, then the wikilink popup for base and note names |

Picking `of`, `from`, `where`, `view` or `group` reopens the popup for the value. `sort:`, `limit:` and `tasks:` values get no completion. The block works while unclosed, so completion is live as you type the fence. Key meanings are on [The query block](../bases/query-block.md).

## Settings file completion

The `.settings` file at the vault root has its own schema-aware completion. It applies only to that exact file, not to a `settings.yaml` elsewhere in the vault. See [Settings overview](../settings/overview.md) for the file and [Settings reference](../settings/reference.md) for every key.

| Where the caret is | Offers |
|---|---|
| A key position, at the right nesting level | Keys valid there, each showing its type and range (such as `number 11–28`) with the doc and default in the tooltip; silent inside `properties:`, whose names are free-form |
| The value of an enum or boolean key | The allowed values |
| The value of an icon key | **Open icon gallery** first, then Lucide names, prefix matches first, at most 50 |
| The value of a keybinding key | **Record shortcut...**, then modifiers, then keys |
| The value of a design-token key | Font families, `light` or `dark`, easing keywords, or the token's default |
| The value of a vault-path key | Vault files or folders, ranked by full-path prefix, name prefix, then substring; template keys list template files only |
| `fileName:` of a daily-note entry, inside `{{` | Template tokens |
| `command:` in a toolbar item | Every command id with its label, plus `daily-note:<id>` for each daily-note entry in the file |
| A bare `- ` list item whose list holds enum values | That enum's values |
| A value in the `properties:` section | The property type names, plus `enum`, `list` and `object` snippets that insert an inline YAML form |

**Record shortcut...** listens for three seconds, takes the first non-modifier key you press and replaces the whole value with that combination. It prefers the physical key, so `Alt+S` is recorded as `Alt+S`, not `Alt+ß`.

While you build a combination by hand, the popup offers `Mod`, `Alt`, `Shift`, `Cmd`, `Ctrl` and `Meta`; each choice appends `+`, and once you use one modifier its family (`Mod`/`Cmd`/`Ctrl`/`Meta`, `Alt`/`Option`/`Opt`) is hidden. Typing `Mod+Sh` suggests `Shift`. Combinations are covered on [Keybindings](../settings/keybindings.md).

## How it works

`app/src/editor/autocomplete.ts` exports `vaultCompletion`, one `autocompletion()` extension whose `override` array holds every note-editor source. Several `autocompletion()` extensions conflict, so all body and frontmatter sources share this array. Each source is a `CompletionSource` paired with a pure matcher in `wikilink.ts`, `tag.ts`, `emoji.ts`, `templateToken.ts`, `atMention.ts` or `core/src/memoryRef.ts`, so triggers are unit-tested without a browser. `Editor.tsx` and the table cell editor (`cellEditorExtensions.ts`) both build it through `markdownEditingExtensions`, which is why a cell completes like the note body. A source that needs a host input is added only when the host supplies it: `getMemories` for `??`, `getFiles` for `@`, `getHostPath` for the Query builder item, and `slashMenu: false` removes the slash menu from the composer.

Every source applies through `applyCompletion` in `app/src/editor/applyCompletion.ts`, which replaces the range, places the caret and tags the transaction with `pickedCompletion` so CodeMirror closes the popup. Passing `trigger = true` (or `makeApply(..., true)`) reopens the popup after the insert, which chains `[[` into wikilinks or `[due ` into dates. `completionDisplayConfig` and `completionNavKeymap` in `completionDisplay.ts` draw the icon column and bind the navigation keys. A `wikilinkAutoTrigger` listener force-opens the popup for `[[`, `@` and `??`, which CodeMirror's word-character auto-activation misses.

`wikilinkHeadingSource` reads the target note through `readNote` and caches its headings per path for the editor's lifetime. `taskSource` in `taskComplete.ts` classifies the text before the caret with `classifyTaskContext`; the card editor mounts it alone through `taskCompletion()`. `querySource` in `queryComplete.ts` finds the enclosing `query` fence with a small fence state machine. `slashSource` in `slashComplete.ts` ranks `SLASH_ITEMS` from `slashMenu.ts` and adds the dynamic date item. The date popover in `datePickerExtension.tsx` is a state-driven tooltip rather than a completion source, because a completion popup closes when the editor loses focus and a native date input needs to take focus.

`app/src/editor/settingsComplete.ts` is a separate `autocompletion()` extension that `Editor.tsx` wires in, with the YAML schema lint, only when `isSettingsBuffer(path)` is true. It walks up from the caret line to the nearest less-indented `key:` header to find the schema in scope. The property registry in `app/src/propertyRegistry.ts` is a signal seeded empty, filled from `GET /schema` at boot and refetched when a settings path changes.

Adding a source: write a pure matcher and a `CompletionSource`, add the source to the `override` array at the right priority, and keep any file-type-specific source (like settings) in its own extension.

Source: `app/src/editor/autocomplete.ts`, `app/src/editor/applyCompletion.ts`, `app/src/editor/completionDisplay.ts`, `app/src/editor/taskComplete.ts`, `app/src/editor/queryComplete.ts`, `app/src/editor/slashComplete.ts`, `app/src/editor/slashMenu.ts`, `app/src/editor/atMention.ts`, `app/src/editor/datePickerExtension.tsx`, `app/src/editor/settingsComplete.ts`, `app/src/editor/cellEditorExtensions.ts`, `app/src/propertyRegistry.ts`, `core/src/memoryRef.ts`, `core/src/templates.ts`
