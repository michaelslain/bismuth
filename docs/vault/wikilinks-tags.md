# Wikilinks and tags

A wikilink (`[[My Note]]`) links one note to another by name, and a tag (`#idea`) groups notes under a shared label.
Bismuth turns every resolved link into a graph edge and every tag into a shared tag node, and the editor autocompletes both as you type.
Read this page to learn the syntax, how a link finds its note, and the cases where a link or tag silently does nothing.

```markdown
---
tags: [book, "science fiction"]
---
See [[Gamma]], [[reading/Gamma#Chapter 2|chapter two]] and ![[diagram.png]].
Filed under #reading/2026 and #idea.
```

This note links to `Gamma` and `reading/Gamma` (the embed produces no link), and carries four tags: `book`, `science fiction`, `reading/2026` and `idea`.

## Which wikilink forms are supported?

| Form | Example | Links to |
|---|---|---|
| Name | `[[My Note]]` | the note named `My Note`, anywhere in the vault |
| Alias | `[[My Note\|shown text]]` | `My Note`; the editor shows `shown text` |
| Heading | `[[My Note#Section]]` | `My Note`, opened scrolled to the `Section` heading |
| Path | `[[reading/My Note]]` | exactly `reading/My Note.md` |
| Combined | `[[reading/My Note#Section\|Alias]]` | `reading/My Note`, heading and alias applied |

Anything between the brackets is allowed except `]`, so `[[2024-01-15]]`, `[[doc-v1.2.3]]` and `[[note@tag]]` are valid targets. An empty `[[]]` is ignored. In live preview the editor hides the brackets, the folder path and the heading, and shows the alias, or the bare name if there is none.

A heading anchor matches an ATX heading (`## Section`) by its text, ignoring case and repeated spaces. If no heading matches, the note simply opens at its saved scroll position.

## How does a link find its note?

A link resolves in this order, and the first match wins:

1. The target equals a note's path without `.md` (`reading/My Note`).
2. The target equals a note's file name without `.md` (`My Note`).

Matching is case-sensitive, so `[[note]]` does not find `Note.md`. A link that matches nothing creates no graph edge and raises no error; clicking it in the editor opens a new note with that name.

When two notes share a file name (`reading/Note.md` and `writing/Note.md`), a bare `[[Note]]` goes to the one with the fewest folders, and between equals to the one whose path sorts first.
Write `[[writing/Note]]` to pick the other.
The autocomplete and drag-to-link already write the path form when a name is ambiguous, so the link you insert always resolves to the note you chose.

A link to an image or PDF, such as `[[photo.png]]`, resolves to that file's [companion note](frontmatter.md#companion-notes-frontmatter-for-binary-files-imagespdfs) (`photo.png.md`) if one exists.
Clicking it opens the file's preview tab.
If the target is an existing image or PDF with no companion, clicking still opens it.

## Why does `![[file]]` not count as a link?

An exclamation mark directly before the brackets makes the token an embed, a render-only directive for images, PDFs, audio, video and note transclusion. Embeds never create graph edges. `[[Diagram.png]]` is a link and `![[Diagram.png]]` is an embed. See [Attachments and embeds](attachments.md).

## Where are links and tags ignored?

Fenced code blocks (<code>```</code> or `~~~`, indented fences included) and inline code spans are blanked before links, tags and embeds are read, so examples in code never reach the graph.

An unterminated fence hides everything to the end of the file. If links or tags below a code block are missing from the graph, look for a fence with no closing line.

## Which tag forms are supported?

A tag is either a frontmatter entry or an inline `#word`. A note's tags are the union of both, with duplicates removed.

Frontmatter `tags` accepts a list or a comma-separated string. A leading `#` is stripped.

| Value | Tags |
|---|---|
| `tags: [foo, bar]` | `foo`, `bar` |
| `tags: foo` | `foo` |
| `tags: "foo, bar"` | `foo`, `bar` |
| `tags: "science fiction"` | `science fiction` (one tag) |
| `tags: ["#foo"]` | `foo` |
| `tags:` empty, `""`, `[]` | none |

Commas are the only separator in a string. Whitespace inside a tag is kept.

Inline tags follow these rules:

- The `#` is at the start of a line or after whitespace.
- The next character is a letter, digit or `_`. Later characters may also be `/` (nesting) and `-`.
- Tags are case-sensitive: `#MyTag` and `#mytag` are two tags.

```text
#body-tag        tag "body-tag"
#parent/child    tag "parent/child"
# Title          heading, not a tag
## Another       heading, not a tag
C#               not a tag (# mid-word)
`#fix`           not a tag (inline code)
#tag1#tag2       only "tag1"; the second # follows a letter, not whitespace
```

## What does the editor autocomplete?

| You type | Suggestions |
|---|---|
| `[[` | Note names. A name shared by several notes inserts the path form. |
| `[[Note#` | The headings of `Note`, when `Note` resolves to a real note. |
| `#` after whitespace | Tags already in the vault. |
| `tags: ` in frontmatter, and after each comma | Tags already in the vault. |

Accepting a note name adds `]]` unless it is already there, and leaves the cursor after it. Heading suggestions start only when the text before the `#` names a real note, so typing `[[C#` still completes a note called `C# Notes`.

## How do links and tags appear in the graph?

Each `.md` note is a `note` node.
A resolved link is a `link` edge from the linking note to the target.
Each distinct tag is one `tag` node with id `tag:<name>` and label `#<name>`, shared by every note that uses it, and each note-tag pair is one `tag` edge.
Repeated links from one note to the same target make one edge.

The 2nd brain graph shows both note and tag nodes. Memory notes are separate; see [Graph](../graph/overview.md).

## How it works

### Extraction

`core/src/wikilinks.ts` exports `stripCode(md)` and `extractWikilinks(md)`.
`stripCode` replaces fenced and inline code with spaces of the same length, keeping newlines, so offsets and the whitespace test for tags stay correct.
`extractWikilinks` returns the distinct targets, matching `/(?<!!)\[\[([^\]]+?)\]\]/g` against the masked text and cutting each match at the first `|` and then the first `#`.
It skips the work entirely when the note has no `[[`.

`core/src/tags.ts` exports `extractTags(data, body)`. Frontmatter tags go through `parseList` and `normalizeTag` from `core/src/schema/coerce.ts`. Inline tags use `INLINE_TAG_REGEX` (`/(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g`) on the masked body. The result is a deduplicated array without the `#`.

### Resolution

`buildVaultGraph` in `core/src/vault.ts` extracts links from the whole file text, frontmatter included, and resolves each with `resolveLinkTarget(target, byBase, byPath)`: `byPath.get(target) ?? byBase.get(target)`.
`buildGraphFromNotes` fills `byBase` with `preferId` from `core/src/linkTarget.ts`, which picks the id with the fewest path segments and then the smaller path by code-unit order.
The same module provides `pickByBase` and `linkTargetFor`, which the editor uses so that the graph and a click resolve a name to the same note, and so that inserted links are path-qualified exactly when needed.

`resolveNotePath(target, notes)` in `app/src/editor/wikilink.ts` is the editor's mirror: exact path first, then `pickByBase`.
`wikilinkOpenPath` decides what a click opens: a resolved note id gets `.md` appended, an unresolved target that `previewKind` recognises as a previewable attachment opens as written, and anything else opens as a new `<target>.md`.

### Editor helpers

The pure helpers in `app/src/editor/wikilink.ts` and `app/src/editor/tag.ts` have no CodeMirror imports, so they run under `bun test`.
`matchWikilinkPrefix` finds the rightmost unclosed `[[` on the line, `matchWikilinkHeadingPrefix` splits an open link at its first `#`, `matchTagPrefix` applies the inline-tag boundary rule, and `parseWikilink` splits `target#heading|alias` and derives `display`.
`wikilinkVisibleRange` returns the slice live preview leaves visible.
`buildInsert` appends `]]` only when it is not already ahead.
`matchTagListItem` in `app/src/editor/autocomplete.ts` completes the segment after the last comma of a frontmatter `tags:` line.
The completion sources are wired in `app/src/editor/autocomplete.ts`; heading completion reads the target note once and caches its parsed headings per path.

### Graph kinds

`SECOND_BRAIN_KINDS` in `core/src/graph.ts` is `note` and `tag`. A tag node has no `folder` field.

Source: `core/src/wikilinks.ts`, `core/src/tags.ts`, `core/src/vault.ts`, `core/src/graphBuilder.ts`, `core/src/linkTarget.ts`, `core/src/graph.ts`, `core/src/schema/coerce.ts`, `app/src/editor/wikilink.ts`, `app/src/editor/tag.ts`, `app/src/editor/autocomplete.ts`, `app/src/Editor.tsx`
