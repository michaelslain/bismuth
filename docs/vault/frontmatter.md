# Frontmatter: Parsing, Mutation, Property Registry, and Bases Integration

This document covers everything Bismuth does with YAML frontmatter: how it is parsed (tolerantly) from markdown files, how individual keys are set or deleted while preserving formatting, how the property registry in `settings.yaml` maps frontmatter keys to typed schemas, and how parsed frontmatter flows into the Bases query engine as the `note` namespace of every `Row`.

---

## Parsing: `parseFrontmatter`

### Signature

```typescript
export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(md: string): Frontmatter
```

### Regex

The parser matches the opening `---` block via:

```
/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
```

- The block **must start at character 0** — any leading text disqualifies it as frontmatter.
- Handles both `\n` (Unix) and `\r\n` (Windows) line endings.
- Stops at the first closing `---` on its own line; extra `---` fences inside the body do not interfere.
- The trailing newline after the closing `---` is consumed (the regex has `\r?\n?`), so `body` starts cleanly at the first non-fence character.

### Tolerance for malformed YAML

If the YAML block fails to parse (duplicate keys, invalid syntax, bare `:`), the error is silently caught and `data` is returned as `{}`. The note is never dropped from the vault graph — malformed frontmatter degrades to an empty property set, not a crash.

```typescript
try {
  data = (parse(m[1]) ?? {}) as Record<string, unknown>;
} catch {
  data = {};
}
```

### YAML types preserved

The underlying `yaml` library produces native JS types:

| YAML token | JS type |
|---|---|
| `key: value` | `string` |
| `key: 42` | `number` |
| `key: true` / `false` | `boolean` |
| `key: [a, b]` | `string[]` (flow array) |
| `key:\n  - a\n  - b` | `string[]` (block array) |
| `key:\n  nested: v` | `object` |
| `key: 2026-06-01` | `Date` (yaml auto-coerces ISO dates) |
| empty block (`---\n---`) | `{}` |

### Edge cases (verified in tests)

- No frontmatter at all → `{ data: {}, body: md }` (body is the entire input string).
- Empty frontmatter block (`---\n---\nBody`) → `{ data: {}, body: "Body" }`.
- Missing closing `---` → regex fails to match → treated as no frontmatter.
- Invalid YAML (`key: : : syntax`) → caught, `data = {}`, body is still correctly extracted from the raw match.
- Body is preserved verbatim including trailing newlines and whitespace.
- Flow arrays (`tags: [book, fiction]`) come back as `string[]`, not converted to block style.

### Example

```typescript
const { data, body } = parseFrontmatter(`---
status: in-progress
priority: 1
tags: [a, b]
---
# Title
body text`);
// data = { status: "in-progress", priority: 1, tags: ["a", "b"] }
// body = "# Title\nbody text"
```

---

## Mutation: `setFrontmatterKey` and `deleteFrontmatterKey`

Both functions rewrite a note's markdown string, returning the updated string. They never touch the file system directly — callers pass the raw markdown and receive the rewritten string.

### `setFrontmatterKey`

```typescript
export function setFrontmatterKey(md: string, key: string, value: unknown): string
```

**Behavior:**

- If the note has **no frontmatter**, a fresh block is prepended using `yaml.stringify({ [key]: value })`. The existing body follows intact.
- If frontmatter **exists**, the block is mutated via the `yaml` Document API (`doc.set(key, value)`) to preserve all existing formatting: flow vs block arrays, quoting style, key order, comments on other keys.
- The body is never touched.
- Setting a key that doesn't yet exist appends it to the end of the frontmatter (after all existing keys).

**Examples:**

```typescript
// Update an existing key — preserves key order and other keys
const out = setFrontmatterKey(`---
title: Gamma
tags: [book, fiction]
---
# Gamma`, "status", "done");
// Result:
// ---
// title: Gamma
// tags: [book, fiction]   ← flow style preserved, no conversion to block list
// status: done
// ---
// # Gamma

// Create frontmatter when note had none
setFrontmatterKey("# Just a note\n\nSome content.", "status", "done");
// Result:
// ---
// status: done
// ---
// # Just a note
//
// Some content.

// Set an array value
setFrontmatterKey(`---\nstatus: todo\n---\nbody`, "tags", ["a", "b"]);
// data.tags === ["a", "b"]  ← stored as flow array [a, b]
```

**Key-order guarantee:** when updating an existing key, its position in the YAML map is unchanged. All other keys remain at their original positions.

**Flow-style preservation:** the `yaml` Document API edits the AST in place. A key stored as `tags: [book, fiction]` stays in flow style after an unrelated key is added — it does NOT convert to the block list `- book\n- fiction`. The `flowCollectionPadding: false` option prevents `[ book, fiction ]` (with spaces) from appearing; the output is `[book, fiction]`.

### `deleteFrontmatterKey`

```typescript
export function deleteFrontmatterKey(md: string, key: string): string
```

**Behavior:**

- No frontmatter → returns `md` unchanged (no-op).
- Key not present → returns `md` unchanged (no-op).
- Key present alongside other keys → removes only that key; all other keys, their order, formatting, and comments are preserved.
- Key is the **last key** in the frontmatter → removes the entire `---` block (no dangling fence, no leading blank line left behind).

**Examples:**

```typescript
// Remove one key, keep others
deleteFrontmatterKey(`---
icon: House
status: todo
---
# Note
body text`, "icon");
// Result:
// ---
// status: todo
// ---
// # Note
// body text

// Remove the last key — whole block dropped
deleteFrontmatterKey(`---
icon: House
---
This is the body.
`, "icon");
// Result: "This is the body.\n"  ← no "---" left, no leading newline

// Key absent → identical string returned
deleteFrontmatterKey(`---\nstatus: todo\n---\nbody`, "icon") === original; // true
```

### Internal: `mutateFrontmatter`

Both functions delegate to the private `mutateFrontmatter(md, mutate)` helper. It:

1. Extracts the frontmatter YAML text and body.
2. Attempts `yaml.parseDocument(fmText)` (Document API — preserves AST).
3. If successful, calls `mutate(doc, doc.toJSON(), fmText)` and reassembles the string.
4. If `parseDocument` throws (malformed YAML), falls back to `yaml.parse` (plain object), applies the mutation to that object, and re-serializes with `yaml.stringify`. Comments are lost in this fallback path, but the note is not corrupted.
5. The `mutate` callback returns `{ keep: boolean; result: string }`:
   - `result !== ""` → use that string directly (used for no-op returns).
   - `keep === false` → body only (no frontmatter block).
   - Otherwise → emit `---\n<doc.toString()>---\n<body>`.

---

## Property Registry: `properties:` in `settings.yaml`

### Purpose

The property registry tells Bismuth the *declared type* of each frontmatter key vault-wide. It powers:

- **Autocomplete** in the editor (key completions, value completions for enums).
- **Lint squiggles** (type errors, range violations, broken file links).
- **Bases query engine** (type coercion for filters and comparisons).
- **Schema endpoint** (`GET /schema`) — the frontend reads this to build the autocomplete and linter.

### Location in `settings.yaml`

```yaml
properties:
  rating:
    type: number
    min: 0
    max: 5
  status:
    type:
      enum: [draft, published, archived]
  tags:
    type:
      list: string
  due: date
  cover: file
  icon: icon
```

The `properties:` section is a free-form YAML map. The backend reads it via `getVaultSchema(vault)` which calls `loadRegistry(data.properties)`.

### Bare-string shorthand

A property entry can be just a type string instead of an object:

```yaml
properties:
  due: date         # shorthand for { type: date }
  cover: file       # shorthand for { type: file }
  rating: number    # shorthand for { type: number }
```

Bare strings map directly to scalar `PropertyType` values. Any unrecognized string falls back to `"string"`.

### Full entry object

```yaml
properties:
  myKey:
    type: <PropertyType>     # required
    required: true           # optional; only meaningful in settings mode, not frontmatter lint
    default: <value>         # optional; used by the schema engine for initialization
    doc: "Human-readable description"  # optional; shown in autocomplete
    min: 0                   # optional; numeric range lower bound (soft warning)
    max: 100                 # optional; numeric range upper bound (soft warning)
```

### `PropertyType` values

All valid type values accepted in `properties:`:

#### Scalar types (bare strings)

| Type string | JS value | Notes |
|---|---|---|
| `string` | `string` | Always valid — any string passes |
| `number` | `number` | Must not be `NaN` |
| `boolean` | `boolean` | Must be `true` or `false` |
| `date` | `string` (`YYYY-MM-DD`) or `Date` | Validated as a real calendar date (rejects e.g. `2026-02-30`) |
| `datetime` | ISO-8601 string or `Date` | Parsed via `Date.parse`; any valid ISO string passes |
| `file` | `string` (note path or `[[WikiLink]]`) | Resolved via wikilink extraction; a missing link produces a **warning** (not an error) |
| `icon` | `string` | Any string passes — a Lucide icon name or emoji; never flagged |
| `keybind` | `string` | Any string passes (validated leniently); used only in `settings.yaml` |

#### Composite types (object form)

**Enum:**
```yaml
status:
  type:
    enum: [draft, published, archived]
    caseInsensitive: true   # optional; default false
```
- Unknown values produce an error with up to 3 nearest-match suggestions (Levenshtein distance).
- `caseInsensitive: true` makes the check case-insensitive but preserves the configured value casing in suggestions.
- In `settings.yaml` only, `allowPrefixes` lets values starting with a given prefix pass without being in the enum list (used internally for `daily-note:` command IDs).

**List:**
```yaml
tags:
  type:
    list: string      # item type; any PropertyType scalar or object
```
- Items are validated individually.
- A bare string value (`"fiction, russian"`) is coerced to a list by splitting on commas: `["fiction", "russian"]`. Splitting is comma-only, never on whitespace, so `"science fiction, russian"` → `["science fiction", "russian"]`.
- `null` / `undefined` list values are always valid (never flagged).

**Object:**
```yaml
metadata:
  type:
    fields:
      key: string
      nested: number
```
- Nested objects validate their child keys recursively.
- Open-map objects (empty `fields: {}`) accept arbitrary keys — used by `properties:` and `folderIcons:` themselves.

**Path** (used in `settings.yaml`, not in user `properties:` entries):
```yaml
folder:
  type:
    kind: path
    only: dir       # restrict to directories; omit for both files and dirs
    scope: templates  # restrict completion to the configured templates folder
```
Path types are validated leniently (any string passes) — their value is in autocompletion, not validation.

### Built-in properties

These are always recognized without needing a `properties:` entry. User entries with the same name override them:

| Key | Type |
|---|---|
| `tags` | `{ kind: "list", item: "string" }` |
| `aliases` | `{ kind: "list", item: "string" }` |
| `cssclasses` | `{ kind: "list", item: "string" }` |
| `icon` | `"icon"` |

### `loadRegistry` parsing rules

`loadRegistry(raw)` is tolerant of malformed input:

- Non-object or `null` input → `{}` (empty schema).
- Unknown type string (e.g. `type: "url"`) → falls back to `"string"`.
- An entry with a `"type"` key → unwrapped recursively (supports `{ type: { type: "number" } }`).
- An inline object with an `enum` array → parsed as `{ kind: "enum", values: [...] }`.
- An inline object with a `list` key → parsed as `{ kind: "list", item: parseType(obj.list) }`.
- An inline object with a `fields` key → parsed as `{ kind: "object", fields: loadRegistry(obj.fields) }`.

### Validation modes

`validateDocument(parsed, schema, { mode })` runs two modes:

| Behavior | `"frontmatter"` mode | `"settings"` mode |
|---|---|---|
| Unknown key severity | `info` | `warning` |
| Missing required key | ignored | `error` |
| Type mismatch | `error` | `error` |
| Out-of-range number | `warning` | `warning` |
| Unknown nested key (closed section) | `info` | `warning` |
| Open-map section (`fields: {}`) | never recursed | never recursed |

`null` / `undefined` values always pass type validation — the `required` check is separate and only applies in `"settings"` mode.

### Autocomplete support

`suggest.ts` exposes two pure functions used by the editor autocomplete extension:

```typescript
// Key completions filtered by prefix (case-insensitive)
keySuggestions(schema: Schema, prefix: string): string[]

// Value completions for a type, filtered by prefix
valueSuggestions(type: PropertyType, prefix: string): string[]
```

`valueSuggestions` returns concrete values for `boolean` (`"true"`, `"false"`) and `enum` types, drills into `list` item types, and returns `[]` for open-ended types (`string`, `number`, `date`, `file`, `icon`).

---

## How Frontmatter Feeds Bases

The Bases query engine works over a uniform `Row[]` — one row per vault note. Each row has three namespaces:

```typescript
interface Row {
  file: FileMeta;              // file metadata (name, path, folder, tags, links, size, mtime, ctime)
  note: Record<string, unknown>; // frontmatter — the parsed YAML key/value pairs
  formula: Record<string, unknown>; // computed by the query engine
}
```

### The `note` namespace

`note` is exactly the `data` returned by `parseFrontmatter`. Every frontmatter key becomes addressable in Bases filters and formulas as `note.<key>`. For example:

- `note.status` → the `status:` frontmatter value
- `note.rating` → the `rating:` number
- `note.tags` → the `tags:` array (also reflected in `file.tags` after normalization)
- `note.due` → the `due:` date string or `Date` object

### Building vault rows (`buildVaultRows`)

`basesData.ts` builds the vault row feed:

```typescript
// For each .md file:
const { data, body } = parseFrontmatter(raw);
const tags = extractTags(data, body);
const links = extractWikilinks(raw);
rows.push({ file: fileMeta(rel, st, tags, links), note: data, formula: {} });
```

Key points:
- `note` is the raw `data` object from `parseFrontmatter` — no coercion is applied at this stage.
- `file.tags` is independently computed by `extractTags` (which reads both `tags:` frontmatter and inline `#tag` markers, normalized to remove the leading `#`). `note.tags` is the raw YAML value.
- `file.links` is extracted via `extractWikilinks` over the entire raw markdown (including frontmatter).
- The vault row cache (`cachedRows`) is invalidated on file changes; the client keeps an SSE-version-keyed stale-while-revalidate cache.

### Type coercion in the query engine

The Bases expression evaluator and filter engine work with the raw JS values from `note`. The property registry (from `properties:` in `settings.yaml`) is used for autocomplete and lint, but not for automatic coercion in query evaluation — filters compare values as-is. The `parseList` coerce function is applied at validation time for `list`-typed properties when the stored value is a comma-separated string.

### `file` namespace fields

For completeness — the `file` namespace is also available in Bases and filters:

| Field | Type | Notes |
|---|---|---|
| `file.name` / `file.basename` | `string` | Filename without extension |
| `file.path` | `string` | Vault-relative path, e.g. `"reading/housing.md"` |
| `file.folder` | `string` | Folder path; `""` for root |
| `file.ext` | `string` | File extension, e.g. `"md"` |
| `file.size` | `number` | Bytes |
| `file.ctime` | `number` | Creation time (epoch ms; falls back to `ctimeMs` if `birthtimeMs` unavailable) |
| `file.mtime` | `number` | Modification time (epoch ms) |
| `file.tags` | `string[]` | Normalized tags (no `#`); union of frontmatter `tags:` and inline `#tag` |
| `file.links` | `string[]` | Wikilink targets (no `.md`, no `#heading`, no `\|alias`) |

---

## Settings: `settings.yaml` Lifecycle

This section covers the settings file management in `core/src/settings.ts` as it relates to the property registry.

### Reading: `getVaultSchema`

```typescript
async function getVaultSchema(vault: string): Promise<Schema>
```

Returns the merged schema: built-in properties (`tags`, `aliases`, `cssclasses`, `icon`) overridden by user entries from `settings.yaml`'s `properties:` section. Used by `GET /schema` and the editor autocomplete.

### Mutation: `setSettingInFile`

```typescript
async function setSettingInFile(vault: string, path: string[], value: unknown): Promise<void>
```

Merges a single value at a JSON-pointer-style path (e.g. `["appearance", "theme"]`) into `settings.yaml` in place, via the YAML Document API. Preserves all other keys, their comments, and key order. Protected by a per-vault mutex (a `Promise` chain keyed on vault path) to prevent TOCTOU races from concurrent `POST /set-setting` requests.

### Reconciliation: `reconcileSettings`

On every vault open, `reconcileSettings` adds any schema keys missing from the file, using their schema defaults. It:
- Does nothing if the file doesn't exist (calls `initializeSettings` to write a fresh file instead).
- Skips corrupt/empty files (any YAML parse error → leave for the user to fix).
- Never removes unknown keys (only adds missing ones).
- Writes the file only if something actually changed (no spurious SSE churn).
- Recurses into object-typed entries (fills nested missing keys too).

### Frontend serialization: `serializeSettingsForFrontend`

Merges `settings.yaml` over `DEFAULTS` with a per-key `typeof` check — a stored value with a wrong type is silently ignored and the default is used instead. Also enforces schema `min`/`max` and `enum` constraints at merge time. The `properties:` section is excluded from the serialized result (it is delivered separately via `GET /schema`).

---

## Cross-References

- [Bases overview](../bases/overview.md) — how the `Row` model is queried and filtered
- [Tags extraction](../vault/wikilinks-tags.md) — how `file.tags` is built from frontmatter + body
- [Settings schema](../settings/reference.md) — full `SETTINGS_SCHEMA` documentation

Source: core/src/frontmatter.ts, core/src/settings.ts, core/src/schema/settingsSchema.ts, core/src/schema/registry.ts, core/src/schema/types.ts, core/src/schema/validate.ts, core/src/schema/coerce.ts, core/src/schema/suggest.ts, core/src/basesData.ts, core/src/bases/types.ts, core/test/frontmatter.test.ts, core/test/schema/validate-document.test.ts, core/test/schema/integration.test.ts, core/test/schema/types.test.ts
