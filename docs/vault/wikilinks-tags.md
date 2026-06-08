# Wikilinks and Tags

This document is the exhaustive reference for how Bismuth extracts `[[WikiLink]]` wikilinks and `#tag` tags from vault notes, how both are resolved into graph nodes and edges, what ambiguity rules govern filename-based link resolution, and how the editor surfaces autocomplete for both syntax forms. The extraction logic lives in `core/src/wikilinks.ts` and `core/src/tags.ts`; the graph integration lives in `core/src/vault.ts`; the editor autocomplete helpers live in `app/src/editor/wikilink.ts` and `app/src/editor/tag.ts`.

---

## Wikilinks

### Syntax

The supported wikilink forms mirror Obsidian syntax. All three can be combined:

| Form | Example | What gets extracted |
|---|---|---|
| Bare name | `[[My Note]]` | `My Note` |
| With alias | `[[My Note\|Alias Text]]` | `My Note` (alias stripped) |
| With heading anchor | `[[My Note#Section]]` | `My Note` (anchor stripped) |
| Path-qualified | `[[reading/My Note]]` | `reading/My Note` |
| All combined | `[[reading/My Note#Section\|Alias]]` | `reading/My Note` |

Embeds (`![[file]]`) use the same double-bracket notation but are **not wikilinks** — they are render-only transclusion directives (images, PDFs, audio, video, note transclusion) and **never produce a graph edge**. The negative lookbehind `(?<!!)` in the extractor regex ensures a `!` immediately before `[[` is excluded.

```
![[Diagram.png]]   → skipped (embed, not a link)
[[Diagram.png]]    → extracted (link)
![[Other Note]]    → skipped (embed)
[[Other Note]]     → extracted (link)
```

### Extraction: `extractWikilinks(md: string): string[]`

Located in `core/src/wikilinks.ts`.

1. Calls `stripCode(md)` first (see below) to blank out fenced and inline code spans.
2. Applies the regex `/(?<!!)\[\[([^\]]+?)\]\]/g` to the masked string.
3. For each match, strips the alias (text after `|`) and heading anchor (text after `#`), then trims whitespace.
4. Returns deduplicated targets as a `string[]`. Order is insertion order of the `Set` used internally.

```ts
// Examples matching what the tests verify:
extractWikilinks("See [[internship]] and [[housing|my place]] and [[essay#intro]] and [[internship]].")
// → ["internship", "housing", "essay"]  (deduplicated, alias and anchor stripped)

extractWikilinks("![[image.png]][[Note]]")
// → ["Note"]  (embed excluded)

extractWikilinks("```\n[[Hidden]]\n```\n[[Visible]]")
// → ["Visible"]  (code fence blanked)

extractWikilinks("`[[NotALink]]` but [[RealLink]]")
// → ["RealLink"]  (inline code span blanked)

extractWikilinks("")   // → []
extractWikilinks("plain text")  // → []
```

#### What is extracted from complex syntax

- `[[My Note#Section]]` → `"My Note"` (anchor discarded)
- `[[reading/My Note#Section|Alias]]` → `"reading/My Note"` (heading and alias discarded, path preserved)
- `[[2024-01-15]]` → `"2024-01-15"` (numbers allowed)
- `[[my-note]]`, `[[my_note]]` → extracted as-is (hyphens, underscores allowed)
- `[[note@tag]]`, `[[doc-v1.2.3]]` → allowed (no restriction on target characters beyond `]`)
- `[[]]` → ignored (empty target after trim)

#### Code-stripping: `stripCode(md: string): string`

Also exported from `core/src/wikilinks.ts`. Used by both `extractWikilinks` and `extractTags`.

Replaces code regions with same-length runs of spaces (newlines preserved), so character offsets outside the code are unaffected:

- **Fenced code blocks**: ` ``` ` or `~~~` openers (with optional info string) through the matching closer (or end of document if unterminated). Supports indented fences. An unterminated block is treated as extending to end of file — all content after the opener is hidden.
- **Inline code spans**: one or more backticks, then the shortest matching run on the same line.

```
"Real [[Outside]]\n```\n[[Inside]]\n```\nmore [[Also Outside]]"
→ extracts: ["Outside", "Also Outside"]

"Use `[[NotALink]]` but [[RealLink]] counts."
→ extracts: ["RealLink"]

"[[Before]]\n~~~\n[[Hidden]]\n~~~\n[[After]]"
→ extracts: ["Before", "After"]

"[[Before]]\n```\n[[StillHidden]]\nno closing fence"
→ extracts: ["Before"]   (unterminated block hides to EOF)
```

This mirrors the editor's live-preview behavior, which also skips code fences when rendering links and tags.

### Graph Integration

`buildVaultGraph` in `core/src/vault.ts` runs a two-pass algorithm using `buildGraphFromNotes`:

**Pass 1**: Walk all `.md` files, create a `GraphNode` of kind `"note"` for each. IDs are the vault-relative path with the `.md` extension removed (e.g. `reading/My Note.md` → `"reading/My Note"`). Two lookup maps are built simultaneously:
- `byBase: Map<string, string>` — basename (no extension, no path) → note id
- `byPath: Map<string, string>` — full relative path (no extension) → note id

**Pass 2**: For each note, extract wikilinks from its full content (frontmatter + body), resolve each target against the maps, and emit `"link"` edges.

#### Node schema

```ts
interface GraphNode {
  id: string;       // vault-relative path minus .md, e.g. "reading/quotes/My Note"
  label: string;    // filename stem, e.g. "My Note"
  kind: "note";
  folder: string;   // top-level folder segment, or "(root)" for root-level notes
}
```

- `"reading/quotes/x.md"` → id `"reading/quotes/x"`, label `"x"`, folder `"reading"`
- `"x.md"` → id `"x"`, label `"x"`, folder `"(root)"`
- `"a/b/c/d/deep.md"` → folder is always the first path segment: `"a"`

#### Edge schema

```ts
interface GraphEdge {
  from: string;   // source note id
  to: string;     // target note id
  kind: "link";
}
```

### Resolution: Filename-Based Matching

Wikilink matching is **filename-based** (Obsidian-compatible): a bare `[[My Note]]` matches `My Note.md` anywhere in the vault by basename, not by path.

**Resolution order** (implemented in `resolveLinkTarget`):

1. **Exact path match** (`byPath.get(target)`): If the target contains a `/` or exactly equals a known vault-relative path (minus `.md`), this wins.
2. **Basename fallback** (`byBase.get(target)`): If no exact path matches, look up the target as a basename.

```ts
// resolveNotePath in wikilink.ts (frontend) mirrors this order:
resolveNotePath("My Note", notes)            // looks up byBase
resolveNotePath("reading/quotes/My Note", notes)  // exact path wins
```

#### Ambiguity rules

- If two notes share the same basename (e.g. `reading/Note.md` and `writing/Note.md`), a bare `[[Note]]` link is **ambiguous**. The outcome is undefined — `byBase` stores only the last-indexed winner. Use `[[reading/Note]]` to be explicit.
- A path-qualified link `[[reading/Note]]` always wins over a basename collision.
- **Links to non-existent notes are silently dropped** — no edge is created, no error is raised. The note node for the target simply doesn't exist, so `resolveLinkTarget` returns `undefined` and the edge is skipped.

```
// vault.test.ts examples:
"internship.md" linking to [[housing]] and [[ghost]]
→ edge internship→housing created  (housing.md exists)
→ no edge for ghost                (ghost.md does not exist)

"index.md" linking [[reading/Note]] when both reading/Note.md and writing/Note.md exist
→ edge index→reading/Note  (exact path wins)

"index.md" linking [[My Note]] when only reading/My Note.md exists
→ edge index→reading/My Note  (basename fallback resolves correctly)
```

#### Circular links

Circular links are allowed and both directions create edges:

```
a.md: [[b]]
b.md: [[a]]
→ edges: a→b and b→a both present
```

Self-links (`[[self]]` in `self.md`) may or may not produce an edge — behavior is not guaranteed.

---

## Tags

### Syntax

Tags appear in two locations in a note:

1. **Frontmatter `tags` key** — a YAML sequence or comma-separated string.
2. **Inline body tags** — `#tag` patterns in the markdown body.

Both are extracted by `extractTags` and deduplicated into a single set for the note.

#### Frontmatter tags

The frontmatter `tags` key is parsed by `parseList` from `core/src/schema/coerce.ts`:

| Frontmatter value | Result |
|---|---|
| `tags: [foo, bar]` | `["foo", "bar"]` |
| `tags: foo` | `["foo"]` |
| `tags: "foo, bar"` | `["foo", "bar"]` (comma-split only) |
| `tags: "science fiction"` | `["science fiction"]` (multi-word tag preserved — NO whitespace split) |
| `tags: "science fiction, russian lit"` | `["science fiction", "russian lit"]` |
| `tags: ["science fiction", "russian"]` | `["science fiction", "russian"]` |
| `tags: null` | `[]` |
| `tags: []` | `[]` |
| `tags: ""` | `[]` |
| `tags: "   "` | `[]` (whitespace-only → empty) |
| `tags: ["#prefixed"]` | `["prefixed"]` (leading `#` stripped by `normalizeTag`) |

**Key rule**: The only separator in a string value is `,`. Whitespace inside a tag value is preserved. `"science fiction"` is one tag, not two.

#### Inline body tags

The regex is `/(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g` applied to the markdown body (after `stripCode`).

Rules:
- The `#` must be at **start of line** or **preceded by whitespace**. This excludes `C#`, `##headings`, and mid-word `#`.
- The character immediately after `#` must be a word character (`A-Za-z0-9_`). This means `# ` (heading) and `##` (heading marker) are excluded because the character after `#` is a space or another `#`.
- Subsequent characters: `A-Za-z0-9_`, `/` (for nested tags), `-`.
- Tags are **case-sensitive**: `#MyTag`, `#myTag`, `#MYTAG` are three distinct tags.

```
#body-tag         → "body-tag"        (hyphen allowed)
#my_tag           → "my_tag"          (underscore allowed)
#parent/child     → "parent/child"    (slash for nesting)
#tag1             → "tag1"            (numbers allowed after first char)
# Title           → not a tag         (heading — space after #)
## Another        → not a tag         (heading marker)
C#                → not a tag         (mid-word #)
`#fix`            → not a tag         (inside inline code span)
```

Consecutive tags like `#tag1#tag2` (no whitespace between): `#tag1` is captured (the `#` of `#tag2` is not preceded by whitespace), but `#tag2` is NOT captured by the regex. Only `#tag1` and `#tag3` in `#tag1#tag2 #tag3` are guaranteed.

Tags inside fenced code blocks or inline code spans are suppressed by `stripCode` (same logic as wikilinks):

```ts
extractTags({}, "```\n#notag\n```\n#realtag")
// → ["realtag"]

extractTags({}, "Run `git commit -m '#fix'` then add #real")
// → ["real"]
```

### Extraction: `extractTags(data, body): string[]`

Located in `core/src/tags.ts`. Signature:

```ts
extractTags(data: Record<string, unknown>, body: string): string[]
```

- `data` is the parsed YAML frontmatter object (from `parseFrontmatter`).
- `body` is the markdown body string (everything after the frontmatter block).
- Returns a deduplicated `string[]` of tag names (without leading `#`).

Deduplication is global across both sources:

```ts
extractTags({ tags: ["foo"] }, "Text with #foo and #bar")
// → ["foo", "bar"]   (foo deduplicated, not doubled)
```

### Graph Integration

`buildVaultGraph` in `core/src/vault.ts` creates tag nodes and edges during the edge-extraction pass.

#### Tag node schema

Tag nodes are created lazily on first reference across the vault. All notes that reference the same tag share the single node.

```ts
interface GraphNode {
  id: string;    // "tag:" + tag name, e.g. "tag:foo", "tag:science fiction"
  label: string; // "#" + tag name, e.g. "#foo", "#science fiction"
  kind: "tag";
  // no folder field on tag nodes
}
```

Examples:
```
tag "foo"            → { id: "tag:foo",            label: "#foo",            kind: "tag" }
tag "science fiction" → { id: "tag:science fiction", label: "#science fiction", kind: "tag" }
tag "parent/child"   → { id: "tag:parent/child",   label: "#parent/child",   kind: "tag" }
```

#### Tag edge schema

```ts
interface GraphEdge {
  from: string;   // note id, e.g. "reading/My Note"
  to: string;     // tag node id, e.g. "tag:foo"
  kind: "tag";
}
```

One edge per note-tag pair; duplicates within a note are deduped by `extractTags` before edges are created. Two notes using the same tag each get their own edge to the single shared tag node.

```
// vault.test.ts examples:
note.md with frontmatter tags: [foo] and body #bar
→ nodes: tag:foo (#foo), tag:bar (#bar)
→ edges: note→tag:foo (kind:"tag"), note→tag:bar (kind:"tag")

a.md with #shared  AND  b.md with #shared
→ ONE tag node: tag:shared
→ TWO edges: a→tag:shared, b→tag:shared
```

#### Graph mode filtering

Tag nodes have `kind: "tag"`, which is included in `SECOND_BRAIN_KINDS` (the "2nd brain" view). Tag nodes are **not** present in the "3rd brain" (memory) view or the "agents"/"daemon" views.

```ts
export const SECOND_BRAIN_KINDS = new Set<NodeKind>(["note", "tag"]);
```

---

## Editor Autocomplete

Both wikilinks and tags have **pure, DOM-free helper modules** (`app/src/editor/wikilink.ts`, `app/src/editor/tag.ts`) that are testable under Bun without a browser. The actual CodeMirror integration (trigger, completion source, decoration) is in `app/src/editor/autocomplete.ts`.

### Wikilink Autocomplete

#### Detecting an open wikilink: `matchWikilinkPrefix`

```ts
matchWikilinkPrefix(textBefore: string): { from: number; query: string } | null
```

Detects an open `[[…` on the current line with no closing `]]` yet. The regex `/\[\[([^\]\n]*)$/` matches the rightmost unclosed `[[` on the line.

- Returns `{ from, query }` where `from` is the document offset of the first character after `[[`, and `query` is what has been typed so far.
- Returns `null` when no open wikilink is detected.

```ts
matchWikilinkPrefix("[[")                      // → { from: 2, query: "" }
matchWikilinkPrefix("see [[par")               // → { from: 6, query: "par" }
matchWikilinkPrefix("[[My Note")               // → { from: 2, query: "My Note" }
matchWikilinkPrefix("[[a]] [[b")               // → { from: 8, query: "b" }   (rightmost)
matchWikilinkPrefix("[[Done]]")                // → null  (closed)
matchWikilinkPrefix("just text")               // → null
```

#### Completion candidate type

```ts
type NoteCandidate = { label: string; path: string; folder?: string }
```

- `label` — basename (stem without extension), shown in the autocomplete dropdown and inserted.
- `path` — full vault-relative path (the graph node id), used to navigate to the file on click.
- `folder` — top-level folder, shown as autocomplete detail text.

#### Resolving a chosen note: `resolveNotePath`

```ts
resolveNotePath(target: string, notes: { label: string; path: string }[]): string | null
```

Mirrors the backend's `resolveLinkTarget`:
1. Exact path match (`n.path === target`) wins.
2. Basename fallback (`n.label === target`).
3. Returns `null` when nothing matches (the target is treated as a brand-new note that doesn't exist yet).

```ts
const notes = [
  { label: "My Note", path: "reading/quotes/My Note" },
  { label: "Index",   path: "Index" },
];

resolveNotePath("My Note", notes)                  // → "reading/quotes/My Note"
resolveNotePath("reading/quotes/My Note", notes)   // → "reading/quotes/My Note"
resolveNotePath("Index", notes)                    // → "Index"
resolveNotePath("Nonexistent", notes)              // → null
```

#### Building the insertion text: `buildInsert`

```ts
buildInsert(label: string, hasClosingAhead: boolean): { insert: string; cursorOffset: number }
```

- If the cursor already has `]]` immediately ahead (`hasClosingAhead: true`), inserts only the label to avoid `]]]]`.
- Otherwise appends `]]`.
- `cursorOffset` is always `label.length + 2` so the cursor lands just after `]]`.

```ts
buildInsert("Foo", false)  // → { insert: "Foo]]", cursorOffset: 5 }
buildInsert("Foo", true)   // → { insert: "Foo",   cursorOffset: 5 }
```

#### Live-preview visible range: `wikilinkVisibleRange`

```ts
wikilinkVisibleRange(inner: string, start: number): { from: number; to: number }
```

Given the text inside a `[[…]]` token and the document offset of the opening `[[`, returns the character range to **reveal** in live-preview — everything outside this range (the brackets, folder path, `#heading`) is hidden by the decoration.

- If an alias (`|`) is present: reveals the alias text only.
- If a heading (`#`) is present but no alias: reveals only the basename (up to the `#`), excluding the anchor.
- If neither: reveals the full inner text as-is (which is the bare name).

```ts
wikilinkVisibleRange("My Note", 0)             // → { from: 2, to: 9 }   (whole name)
wikilinkVisibleRange("reading/quotes/My Note", 0) // → { from: 17, to: 24 } (basename only)
wikilinkVisibleRange("My Note|Alias", 0)       // → { from: 10, to: 15 } (alias only)
wikilinkVisibleRange("My Note#Section", 0)     // → { from: 2, to: 9 }   (name, not anchor)
wikilinkVisibleRange("My Note", 100)           // → { from: 102, to: 109 } (offset honored)
```

#### Parsing a wikilink token: `parseWikilink`

```ts
parseWikilink(inner: string): { target: string; alias?: string; heading?: string; display: string }
```

Fully parses the text between `[[` and `]]` into its semantic parts:

```ts
parseWikilink("My Note")                          // → { target: "My Note", display: "My Note" }
parseWikilink("reading/quotes/My Note")           // → { target: "reading/quotes/My Note", display: "My Note" }
parseWikilink("My Note|Alias")                    // → { target: "My Note", alias: "Alias", display: "Alias" }
parseWikilink("My Note#Section")                  // → { target: "My Note", heading: "Section", display: "My Note" }
parseWikilink("reading/My Note#Section|Alias")    // → { target: "reading/My Note", heading: "Section", alias: "Alias", display: "Alias" }
parseWikilink("  My Note  ")                      // → { target: "My Note", display: "My Note" }  (trimmed)
```

- `display` is always the alias if given, else the basename of the target (last `/`-delimited segment).
- The `alias` and `heading` fields are absent (not `undefined`) when not present.

### Tag Autocomplete

#### Detecting a tag in progress: `matchTagPrefix`

```ts
matchTagPrefix(textBefore: string): { from: number; query: string } | null
```

Detects a `#tag` being typed at the end of the text before the cursor. Requires the `#` to be at start-of-line or after whitespace (same rule as the body extractor).

```ts
matchTagPrefix("#")               // → { from: 1, query: "" }
matchTagPrefix("#sch")            // → { from: 1, query: "sch" }
matchTagPrefix("see #pro")        // → { from: 5, query: "pro" }
matchTagPrefix("#parent/child")   // → { from: 1, query: "parent/child" }
matchTagPrefix("see #a #b")       // → { from: 8, query: "b" }   (rightmost)
matchTagPrefix("# ")              // → null  (heading)
matchTagPrefix("##")              // → null  (heading marker)
matchTagPrefix("C#")              // → null  (mid-word #)
matchTagPrefix("just text")       // → null
```

`from` points to the document offset of the first character of the tag name (after the `#`). Completion replaces from this offset.

#### Frontmatter `tags:` value autocomplete

Defined in `app/src/editor/autocomplete.ts` as `matchTagListItem`:

```ts
matchTagListItem(textBefore: string): { from: number; query: string } | null
```

Matches when the cursor is on a frontmatter `tags:` line, completing the segment after the last comma. This supports inline comma-separated frontmatter tag values with autocomplete.

```ts
matchTagListItem("tags: fic")           // → { from: 6, query: "fic" }
matchTagListItem("tags: fiction, rus")  // → { from: 15, query: "rus" }
matchTagListItem("tags: a,  b")         // → { from: 10, query: "b" }   (leading spaces trimmed)
matchTagListItem("status: do")          // → null  (non-tags key)
```

---

## Edge Cases and Gotchas

### Wikilinks

- **Embeds are never links**: `![[file]]` always produces zero edges, even if the target is a valid note.
- **Case-sensitive targets**: `[[Note]]` and `[[note]]` are distinct targets. If you have both `Note.md` and `note.md`, the match is unambiguous. If only one exists, that one matches regardless of case only if its exact stem matches.
- **Unterminated fenced blocks hide to EOF**: A ` ``` ` with no matching close treats the rest of the document as code. Any wikilinks or tags after the opener are silently ignored.
- **Whitespace in link targets**: `[[My Note]]` extracts `"My Note"` (space preserved). Wikilink targets can contain spaces.
- **Numbers and special characters**: targets like `[[2024-01-15]]`, `[[doc-v1.2.3]]`, `[[note@tag]]` are all valid.
- **Ambiguous basename**: when two notes share a basename, `byBase` stores only one (last-indexed). The result is non-deterministic. Always use a path-qualified link to avoid ambiguity.
- **Links to missing notes**: silently produce no edge. The note is not "created" in the graph as a placeholder.

### Tags

- **Multi-word frontmatter tags**: `"science fiction"` in a YAML string is ONE tag. The comma is the only separator. Whitespace is not a separator.
- **Leading `#` in frontmatter**: `tags: ["#foo"]` → tag is `"foo"` (leading `#` stripped by `normalizeTag`).
- **Inline tags require whitespace or line-start before `#`**: `word#tag` is NOT a tag. `C#` is NOT a tag.
- **Consecutive inline tags without whitespace**: `#tag1#tag2` — only `tag1` is captured; `tag2`'s `#` is not preceded by whitespace.
- **Deduplication across frontmatter and body**: if `foo` appears in both, the resulting tag list contains it once.
- **Tag nodes are global**: one tag node is shared across all notes that use the tag. Multiple notes referencing the same tag create multiple edges (one each) to the single node.
- **Tags are case-sensitive**: `#MyTag`, `#myTag`, `#MYTAG` are three separate tag nodes.

---

## Data Flow Summary

```
vault .md files
    ↓ parseFrontmatter(content)
  { data (YAML), body (markdown) }
    ↓ extractWikilinks(content)       ↓ extractTags(data, body)
  ["target1", "target2", ...]       ["tag1", "tag2", ...]
    ↓ resolveLinkTarget(target,       ↓ (always create tag node + edge)
       byBase, byPath)
  toId (or undefined → skip)
    ↓                                  ↓
  GraphEdge { from, to, kind:"link" }  GraphNode { id:"tag:name", kind:"tag" }
                                       GraphEdge { from, to:"tag:name", kind:"tag" }
```

Both wikilinks and tags feed into `GET /graph` as part of the vault graph returned by `buildVaultGraph`. The frontend accesses them through the shared graph state; the "2nd brain" view shows both `"note"` and `"tag"` kind nodes.

---

## Related Documentation

- [Graph types and node/edge kinds](../graph/overview.md)
- [Vault graph builder](../vault/structure.md)
- [Frontmatter parsing](../vault/frontmatter.md)
- [Bases source system](../bases/overview.md)

`Source: core/src/wikilinks.ts, core/src/tags.ts, app/src/editor/wikilink.ts, app/src/editor/tag.ts, core/src/vault.ts, core/src/graph.ts, core/src/schema/coerce.ts, core/test/wikilinks.test.ts, core/test/tags.test.ts, app/src/editor/wikilink.test.ts, app/src/editor/tag.test.ts, core/test/vault.test.ts, app/src/editor/autocomplete.test.ts`
