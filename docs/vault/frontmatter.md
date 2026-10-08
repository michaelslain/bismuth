# Frontmatter and properties

Frontmatter is the YAML block at the top of a note that holds its properties: tags, an icon, a status, a due date.
Bismuth reads it for the graph, for Bases queries and for editor autocomplete, edits one key at a time without reformatting the rest, and lets a vault declare a type for each key.
Read this page to write frontmatter, set it from the CLI, or declare property types; images and PDFs keep theirs in a [companion note](#companion-notes-frontmatter-for-binary-files-imagespdfs).

```markdown
---
status: in-progress
rating: 4
due: 2026-06-01
tags: [book, fiction]
icon: BookOpen
---
# Gamma
Body text with an inline #reading tag.
```

And a type declaration for those keys, in the vault's `.settings`:

```yaml
properties:
  rating:
    type: number
    min: 0
    max: 5
  status:
    type:
      enum: [draft, in-progress, done]
  due: date
  tags:
    type:
      list: string
```

## How do I write frontmatter?

The block must start at the first character of the file, open with a line containing only `---`, and end at the next line containing only `---`. Text before the opening fence means the note has no frontmatter. A missing closing fence also means none.

| YAML | Value in Bismuth |
|---|---|
| `key: value` | string |
| `key: 42` | number |
| `key: true` | boolean |
| `key: [a, b]` or a block list | list of strings |
| `key:` with nested keys | object |
| `key: 2026-06-01` | string (dates stay text) |

If the YAML does not parse (duplicate keys, a stray `:`), Bismuth treats the properties as empty. The note stays in the vault, its body links and tags still count, and the editor stops reporting schema problems for that block until you fix the syntax. Nothing is rewritten.

### Which keys does Bismuth give meaning to?

| Key | Effect |
|---|---|
| `tags` | A list or a comma-separated string. Each tag becomes a graph tag node. See [Wikilinks and tags](wikilinks-tags.md#which-tag-forms-are-supported). |
| `icon` | The note's sidebar icon: a Lucide icon name or an emoji. |
| `aliases`, `cssclasses` | Declared as string lists, so the editor does not flag them as unknown. |
| `visibility` | `chat-only` or `hidden` limits what the daemon and chat can read. See [Visibility controls](visibility.md). |
| `type: base` | Makes the note a base. See [Bases overview](../bases/overview.md). |

Every other key is yours. It is available in Bases as `note.<key>`; declare it under `properties:` (below) to get autocomplete and lint for it.

## How do I set or delete a property from the CLI?

Use `bismuth prop set <file> <key> <value>` and `bismuth prop delete <file> <key>`. The value is parsed as JSON and falls back to the raw string, so numbers, booleans and arrays need no special quoting.

```bash
bismuth prop set "reading/Gamma.md" status done
bismuth prop set "reading/Gamma.md" tags '["book","fiction"]'
bismuth prop delete "reading/Gamma.md" status
```

Both commands return `{ "ok": true, "path": "<note that was written>" }`.
Setting a key that does not exist appends it after the other keys.
Setting an existing key keeps its position, its quoting and the style of any list.
Deleting a key removes only that line; deleting the last key removes the whole `---` block.
Deleting a key that is not there leaves the file unchanged.
Both fail with `ENOENT` if the note does not exist.

The app uses the same logic through `POST /set-property` and `POST /delete-property`, which answer `404 note not found` for a missing note instead of creating one.

## How do I declare property types?

A `properties:` map in `.settings` declares the type of each frontmatter key vault-wide. The declaration drives editor autocomplete (key and value suggestions) and lint squiggles; it does not change how Bases compares values. Each entry is either a bare type name or an object.

```yaml
properties:
  due: date                 # shorthand for { type: date }
  mood:
    type:
      enum: [calm, tense]
      caseInsensitive: true
    doc: "How the entry felt"
```

Object entries accept `type` (required), `required`, `default`, `doc`, `min` and `max`.
`default` and `doc` are stored with the declaration and returned by `GET /schema`.
`min` and `max` apply to numbers and only produce warnings.

| Type | Accepts | Lint result when wrong |
|---|---|---|
| `string` | any value | never flagged |
| `number` | a number | error |
| `boolean` | `true` or `false` | error |
| `date` | `YYYY-MM-DD` that is a real calendar date (`2026-02-30` fails) | error |
| `datetime` | an ISO-8601 string | error |
| `file` | a note path or `[[WikiLink]]` | warning `not found in vault` if no such note |
| `icon` | any string | never flagged |
| `{ enum: [...] }` | one of the listed values | error, with up to 3 nearest suggestions |
| `{ list: <type> }` | a list whose items match; a comma-separated string counts as a list | error on the first bad item |
| `{ fields: { key: type } }` | an object whose nested keys match | error on the first bad field |

An empty value (`null`) is always valid. An enum with `caseInsensitive: true` compares without case but keeps your configured casing in suggestions.

Two declarations fall back to `string` without an error: an unknown type name (`type: url`) and `type: keybind`, which is reserved for the settings file's own keybindings.
The registry silently reading a typo as `string` is the main reason a declared type seems to do nothing, so check the spelling first.

### What do the built-in properties look like?

`tags`, `aliases` and `cssclasses` are string lists and `icon` is an icon, with no declaration needed. An entry of your own with the same name overrides the built-in one.

### How severe are the lint diagnostics?

The same validator checks note frontmatter and the `.settings` file, with different severities.

| Situation | In a note | In `.settings` |
|---|---|---|
| Key not in the registry | info | warning |
| Missing `required` key | ignored | error |
| Wrong type | error | error |
| Number outside `min`/`max` | warning | warning |

### What does autocomplete offer?

Typing in frontmatter suggests declared keys that start with what you typed, and completes values for booleans (`true`, `false`) and enums, including enums inside a list. Open-ended types (`string`, `number`, `date`, `file`, `icon`) suggest nothing.

## How does frontmatter feed Bases?

Every note is one row in Bases, and the parsed frontmatter is the row's `note` namespace: `note.status`, `note.rating`, `note.due`.
The values are used as parsed, with no coercion from the property registry, so a `rating` stored as the string `"4"` compares as a string.
`file.tags` is separate: it merges the frontmatter `tags` with inline `#tags`, without the leading `#`.
See [Bases properties](../bases/properties.md) for the `file` namespace and property declarations inside a base.

## Companion notes: frontmatter for binary files (images/PDFs)

An image or PDF has no markdown file of its own, so its tags and properties live in a hidden companion note named `<file>.<ext>.md` beside it: `photo.png` has `photo.png.md`, and `paper.pdf` has `paper.pdf.md`.
The companion is an ordinary note.
Its frontmatter uses all the rules above, its `tags` feed the same tag graph and Bases queries, and it gets its own graph node labelled with the binary's file name (`photo.png`).
Ink annotations are separate and live in `<file>.<ext>.draw`.

### Tag an image or PDF from the CLI or an agent

Run `bismuth prop set` on the binary. It writes to the companion and creates the companion if it does not exist.

```bash
bismuth prop set "Papers/paper.pdf" tags '["reading"]' --vault ~/vault
```

The result is `{ "ok": true, "path": "Papers/paper.pdf.md" }`. `bismuth prop delete` on a binary whose companion does not exist returns `{ "ok": true }` and writes nothing. Both commands fail with `ENOENT` when the binary itself is missing, so a typo in the file name cannot create a stray note.

Never create a separate `<name>.md` that only embeds the binary (`![[paper.pdf]]`) to hold its tags. That makes a second, unrelated note; the app never associates it with the binary. The MCP server's instructions say the same, so an agent sees it before its first tool call.

### How the app treats a companion note

- Created on first edit. Opening an image or PDF creates nothing. The companion is written when you edit the tags strip under the preview's header or type a scratch note, never before.
- Hidden in the tree. The sidebar hides `<file>.md` while `<file>` is present. The companion still exists on disk and still appears in the graph, search and Bases.
- Opening it opens the binary. A graph click, the Cmd+O switcher, a wikilink, a Bases card or app control that targets the companion opens the binary's preview tab instead, with the tags strip below its header.
- An orphan is a normal note. If the binary is deleted outside the app, the companion shows in the tree and opens as itself.
- Moves and deletes travel together. Moving, trashing or restoring the binary carries the companion and the drawing sidecar with it.
- Hand-written text is kept. You can write a body below the frontmatter. Tag edits keep it untouched.

### What are scratch-note blocks?

Typed notes you place on a PDF's or image's scratch paper are stored in the companion's body, one region per non-blank block. Text you wrote by hand stays first and is never changed.

```markdown
Anything you wrote by hand stays here, untouched.

<!-- scratch id=k3f9 p=3 x=842 y=412 w=300 -->
**why?** see [[Lecture 7]]
<!-- /scratch -->
```

`p` is the 1-based page, `x` and `y` are the position and `w` the width in the 816 by 1056 page space that ink uses.
A marker that is malformed or has no closing marker is never treated as a block, so editing the companion by hand cannot lose text.
The blocks are searchable text, and their wikilinks and tags reach the graph like any note's.
Placing and editing blocks is covered in [Drawing](../drawing/overview.md).

## How it works

### Parsing and editing

`core/src/frontmatter.ts` owns both directions.
`parseFrontmatter(md)` returns `{ data, body }` using `FRONTMATTER_REGEX` (`/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/`), which handles `\n` and `\r\n` and consumes the newline after the closing fence.
A YAML parse failure is caught and `data` becomes `{}`.
The body is never altered.

`setFrontmatterKey` and `deleteFrontmatterKey` take and return a markdown string and never touch the file system.
Both go through `mutateFrontmatter`, which edits the AST with the `yaml` Document API so key order, quoting, comments and flow versus block lists survive.
It writes with `lineWidth: 0` (no folding, because the daemon's cron and process parser is line-based) and `flowCollectionPadding: false` (`[a, b]`, not `[ a, b ]`).
If the block is malformed it falls back to `yaml.parse` plus `yaml.stringify`, which drops comments but does not corrupt the note.
`setFrontmatterKey` on a note without frontmatter prepends a fresh block.

### Property registry

`getVaultSchema(vault)` in `core/src/settings.ts` returns `BUILTIN_PROPERTIES` overridden by `loadRegistry(settings.properties)`, and `GET /schema` serves it.
`loadRegistry` in `core/src/schema/registry.ts` accepts a bare type string or an object, unwraps nested `type` keys, and parses `enum`, `list` and `fields` forms.
The recognised scalar names are `SCALAR_PROPERTY_TYPES`; anything else becomes `string`.

`validateDocument(parsed, schema, { mode })` in `core/src/schema/validate.ts` produces the diagnostics, with `mode` either `frontmatter` or `settings`.
`app/src/editor/yamlSchema.ts` maps them to editor ranges and calls it with a `resolveLink` callback for `file` properties.
Open-map sections (an object with empty `fields`, such as `properties` and `folderIcons`) are never recursed into.
`keySuggestions` and `valueSuggestions` in `core/src/schema/suggest.ts` back autocomplete.

The `list` type accepts a comma-separated string through `parseList` in `core/src/schema/coerce.ts`, which splits on commas only, never on whitespace. `normalizeTag` strips one leading `#`.

### Bases rows

`core/src/basesData.ts` builds one `Row` per note: `{ file: fileMeta(...), note: data, formula: {} }`, where `data` is the raw `parseFrontmatter` result and `file.tags` comes from `extractTags(data, body)`.

### Companion notes

`core/src/fileKinds.ts` defines `isCompanionable`, `companionPathFor` and `binaryForCompanion`.
`cli/src/commands/prop.ts` routes `prop set` and `prop delete` at the companion whenever the file is companionable.
`app/src/preview/companionDoc.ts` (`shouldWriteCompanionDoc`, `splitCompanion`, `joinCompanion`) decides when to write and keeps the hand-written body.
`app/src/preview/CompanionFrontmatter.tsx` is the tags strip.
`app/src/preview/createCompanionStore.ts` is the one store behind both the strip and every scratch block, so a save from either cannot drop the other's content.
`core/src/scratchNotes.ts` parses and serializes the scratch regions.
`resolveCompanionTarget` in `app/src/App.tsx`, shared by `openFile` and `openTool`, swaps a companion path for its binary when the sidebar still lists that binary.
`listTree` in `core/src/files.ts` does the hiding.

Source: `core/src/frontmatter.ts`, `core/src/schema/registry.ts`, `core/src/schema/validate.ts`, `core/src/schema/suggest.ts`, `core/src/schema/coerce.ts`, `core/src/schema/types.ts`, `core/src/settings.ts`, `core/src/basesData.ts`, `core/src/fileKinds.ts`, `core/src/scratchNotes.ts`, `core/src/routes/vault.ts`, `cli/src/commands/prop.ts`, `app/src/editor/yamlSchema.ts`, `app/src/preview/companionDoc.ts`, `app/src/preview/createCompanionStore.ts`, `app/src/App.tsx`
