# Sheets Overview

Bismuth supports in-vault spreadsheets via `.sheet` files — each file is a Univer workbook JSON snapshot persisted directly inside the vault. The spreadsheet editor is powered by `@univerjs/presets` v0.25, code-split so its large JS bundle loads only when a `.sheet` pane is first opened. The implementation spans four modules: `SheetView.tsx` (Solid component, lifecycle), `sheet/univerSheet.ts` (Univer adapter), `sheet/snapshot.ts` (pure parse/serialize), and `sheet/sync.ts` (external-edit reload guard). The Univer chrome is reskinned to match Bismuth's design system via `sheet/univer-theme.css` and `sheet/univer-icons.css`.

---

## The `.sheet` File Format

A `.sheet` file is the **plain-text JSON serialization of a Univer `IWorkbookData` object**, pretty-printed with 2-space indentation for human-readable diffs.

### Structure overview

The object is Univer's `IWorkbookData`. Key top-level fields (as seen in the wild and in `sheetHtml.ts`):

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Workbook identifier assigned by Univer |
| `name` | `string` | Display name of the workbook |
| `sheets` | `Record<sheetId, SheetData>` | Map of sheet-id → sheet object |
| `sheetOrder` | `string[]` | Ordered list of sheet ids (determines tab order) |

Each sheet object (`SheetData`) contains at minimum:

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Sheet tab name |
| `cellData` | `Record<rowIndex, Record<colIndex, CellData>>` | Sparse cell map (row/col are numeric string keys) |

Each cell (`CellData`) carries at minimum `{ v: <value> }` where `v` is the raw value (string, number, boolean, or null).

### Empty / blank workbook

An **empty or whitespace-only** `.sheet` file deserializes to `{}` (the empty object). Univer treats `{}` as a valid workbook and initializes a fresh blank sheet. This means "New Spreadsheet" creates an empty file on disk that becomes a fresh workbook on first open — no placeholder JSON is needed.

### Serialization is stable and deterministic

`serializeSnapshot` uses `JSON.stringify(data, null, 2)`. Given the same in-memory object, the output is identical across calls (no random keys, no timestamps injected by the serializer itself).

### Round-trip guarantee

```
parseSnapshot(serializeSnapshot(data)) deepEquals data
```

Verified in `snapshot.test.ts`.

---

## parse / serialize API (`sheet/snapshot.ts`)

This module is **Univer-free** (no canvas, no DOM) and runs cleanly under Bun for unit testing.

### `WorkbookSnapshot`

```ts
export type WorkbookSnapshot = Record<string, unknown>;
```

Opaque wrapper around Univer's `IWorkbookData`. The module deliberately avoids importing Univer types so the parse/serialize logic is testable in a headless environment.

### `parseSnapshot(text: string): WorkbookSnapshot`

Parses a `.sheet` file's text content.

- Empty string or whitespace-only → returns `{}` (blank workbook, not an error)
- Valid JSON → returns the parsed object
- Invalid JSON → throws `SheetParseError`

```ts
parseSnapshot("")                         // → {}
parseSnapshot("   \n  ")                  // → {}
parseSnapshot('{"id":"wb1"}')             // → { id: "wb1" }
parseSnapshot("{bad json")                // throws SheetParseError
```

### `serializeSnapshot(data: WorkbookSnapshot): string`

Serializes a workbook snapshot to the text written to disk.

```ts
serializeSnapshot({ id: "wb1", sheets: { s1: { name: "A" } } })
// → '{\n  "id": "wb1",\n  "sheets": {\n    "s1": {\n      "name": "A"\n    }\n  }\n}'
```

Output is always 2-space-indented JSON. This is intentionally human-readable so `.sheet` diffs in git are meaningful.

### `SheetParseError`

```ts
export class SheetParseError extends Error {
  constructor(cause: unknown);
  name: "SheetParseError";
}
```

Thrown only by `parseSnapshot` on invalid JSON. The `message` is `Invalid .sheet contents: <cause.message>`. `SheetView` catches this specifically and shows the message in the error state instead of a generic string.

---

## How Sheets Mount (code-split, `sheet/univerSheet.ts`)

The Univer library is large. It is never bundled into the main app chunk. The import is a **dynamic `import()`** inside `SheetView.tsx`, deferred until the first time a `.sheet` pane is actually rendered:

```ts
const { mountSheet } = await import("./sheet/univerSheet");
```

Vite splits `univerSheet.ts` (and all its `@univerjs/*` deps) into a separate JS chunk. The user only pays the bundle cost when they open a spreadsheet.

### `mountSheet(opts: MountOptions): SheetHandle`

Creates a Univer instance inside a given container element.

#### `MountOptions`

| Field | Type | Required | Description |
|---|---|---|---|
| `container` | `HTMLElement` | yes | Parent DOM element (stays stable across remounts) |
| `data` | `WorkbookSnapshot` | no | Initial workbook data; omit or pass `{}` for a blank workbook |
| `onChange` | `() => void` | yes | Fired on every data-mutating Univer command (caller debounces) |
| `dark` | `boolean` | no | Initial dark mode state |

#### Remount isolation

Univer **cannot** be disposed and re-created into the same DOM node — attempting it renders blank. `mountSheet` works around this by always creating a **fresh child `<div>`** inside `container`:

```ts
const root = document.createElement("div");
root.className = "bismuth-sheet"; // scopes univer-theme.css
root.style.width = "100%";
root.style.height = "100%";
opts.container.appendChild(root);
```

On `dispose()` this child is removed. The stable `container` ref in the Solid component is never touched. This makes external-reload remounts reliable.

#### Default font

After `createWorkbook`, all sheets get `{ ff: "Monaspace Xenon" }` as the default cell style, matching the app's monospace. This is applied **before** wiring `onChange` so it is part of the post-mount baseline and does not count as a user edit — opening a sheet never triggers a spurious save.

#### Univer presets loaded

- `UniverSheetsCorePreset` — core spreadsheet editing (cells, formulas, formatting)
- `UniverSheetsSortPreset` — sort ranges
- `UniverSheetsFilterPreset` — column filters

Locale is `LocaleType.EN_US`. (Important: using the wrong enum member `En_US` would silently register under a wrong key and produce raw `ui.ribbon.*` key strings in the toolbar — use exactly `LocaleType.EN_US`.)

#### `SheetHandle`

The object returned by `mountSheet`:

| Method | Signature | Description |
|---|---|---|
| `getSnapshot` | `() => WorkbookSnapshot` | Calls `univerAPI.getActiveWorkbook().save()` — returns current in-memory state |
| `setDark` | `(dark: boolean) => void` | Toggles dark mode at runtime without remounting |
| `dispose` | `() => void` | Tears down the Univer instance and removes the child div; safe to call multiple times |

---

## `SheetView` Component (`SheetView.tsx`)

`SheetView` is the Solid component that wires together loading, mounting, saving, and external-reload.

### Props

```ts
{ path: string; onSaved?: () => void }
```

- `path` — vault-relative path to the `.sheet` file (e.g. `"Notes/Budget.sheet"`)
- `onSaved` — optional callback fired after each successful write to disk

### Lifecycle

#### 1. Mount: read + mount Univer

`onMount` reads the file from disk via `api.read(path)`, parses it with `parseSnapshot`, then calls `mountSheet`. If the file is empty, Univer initializes a blank workbook.

After `mountSheet` returns, `lastWrittenText` is **immediately baseline'd** to `serializeSnapshot(handle.getSnapshot())`. This is the canonical snapshot after Univer's own mount-time commands (selection setup, render pass). The baseline ensures that Univer's internal initialization commands — which fire `onChange` — compare equal to `lastWrittenText` and do not trigger a disk write for an untouched sheet.

#### 2. Edit: debounced save

Every data-mutating Univer command fires `onChange → dirty = true; save()`. The save is debounced at **750ms** so a burst of fast edits writes once. On fire:

1. `serializeSnapshot(handle.getSnapshot())` produces the current snapshot text.
2. If it equals `lastWrittenText` (no real change — e.g. a selection change that Univer fires as a command), `dirty` is cleared and the write is skipped. This is essential: without clearing `dirty`, the flag would stay `true` and block all future external reloads.
3. Otherwise, the text is written via `api.write(path, text)`, `lastWrittenText` is updated, `dirty` is cleared, and `onSaved?.()` is called.

#### 3. External reload: SSE-driven

`onServerChange` subscribes to the SSE event stream (via `serverVersion.ts`). On every change event, the handler runs `isExternalChange` (see below). If it returns `true`:

1. The current on-disk content is fetched via `api.read(path)`.
2. The snapshot is parsed with `parseSnapshot`.
3. The old Univer instance is disposed and a fresh one is mounted with the new data.
4. If the file has been deleted (read throws) or the text is invalid JSON (parse throws), the error is silently swallowed and the last good workbook stays visible.

The `onServerChange` subscription is registered **synchronously** (not inside the async `onMount`) so its cleanup is properly owned by the component's `onCleanup`.

#### 4. Theme sync

A `createEffect` tracks `settings.appearance` and calls `handle.setDark(dark)` reactively. The dark/light state is derived from `resolveAppearance(settings.appearance).isLight`. When the user switches the app theme, the sheet chrome updates without any remount.

#### 5. Cleanup

`onCleanup` calls:
- `unsub()` — unsubscribes the SSE listener
- `save.cancel()` — cancels any pending debounced write
- `handle?.dispose()` — tears down Univer

### Error states

| Condition | Behavior |
|---|---|
| `api.read` fails at mount | Error message shown in red; Univer never mounts |
| `parseSnapshot` throws `SheetParseError` | `SheetParseError.message` shown in red |
| Any other mount error | `String(e)` shown in red |
| File vanishes during external reload | Silently kept showing last workbook |
| Invalid JSON during external reload | Silently kept showing last workbook |

---

## External-Edit Reload Guard (`sheet/sync.ts`)

### `isExternalChange(d: ChangeDecision): boolean`

Pure function. Returns `true` only when ALL of the following hold:

1. `changedPaths` includes `path` (the event touches our file)
2. `isDirty` is `false` (no in-progress edits that would be clobbered)
3. The on-disk text differs from what we last wrote (`diskText !== lastWrittenText`), **or** we have never written (`lastWrittenText === null`)

Rule 3 filters out the **echo**: every `api.write` triggers an SSE event that arrives back at the client. Without the echo filter, the sheet would reload from disk after every save — causing a double-mount for no reason. The comparison is an exact string equality check (same 2-space JSON).

#### `ChangeDecision` interface

```ts
interface ChangeDecision {
  path: string;             // vault-relative path of the open sheet
  changedPaths: string[];   // paths from the SSE event
  isDirty: boolean;         // true while pane has unsaved edits
  diskText: string;         // current on-disk text
  lastWrittenText: string | null; // text from our last write, or null if never written
}
```

#### Test cases (from `sync.test.ts`)

```ts
// change to a different file → false
isExternalChange({ path: "Budget.sheet", changedPaths: ["other.md"], ... }) // false

// pane is dirty → false (never clobber in-progress edits)
isExternalChange({ ..., changedPaths: ["Budget.sheet"], isDirty: true }) // false

// own echo: diskText === lastWrittenText → false
isExternalChange({ ..., diskText: "A", lastWrittenText: "A" }) // false

// external write while clean → true
isExternalChange({ ..., diskText: "EXTERNAL", lastWrittenText: "A" }) // true

// never written (lastWrittenText null) + disk changed → true
isExternalChange({ ..., lastWrittenText: null, diskText: "B" }) // true
```

---

## Theme Integration

### `univer-theme.css`

Scoped entirely to `.bismuth-sheet` (the child div created by `mountSheet`). Never leaks to the rest of the app.

**Strategy**: Univer's chrome uses `var(--univer-*)` CSS custom properties with `!important`. Re-theming is done by overriding these variables (not fighting specificity), mapping them onto Bismuth's own design tokens (`--accent`, `--fg`, `--border`, `--rail`, `--surface-1`, `--surface-2`, `--border-soft`, `--text-muted`, `--faint`, `--danger`). Since Bismuth's tokens already flip between light and dark, the sheet chrome tracks the app theme automatically.

**Key mappings**:

| Univer token | Bismuth token | Effect |
|---|---|---|
| `--univer-primary-300..600` | `var(--accent)` | Active ribbon tab, primary buttons, selection chrome |
| `--univer-primary-50..200` | `color-mix(accent, transparent)` | Accent tints |
| `--univer-primary-700` | `color-mix(accent 82%, black)` | Darker accent hover |
| `--univer-primary-900` | `color-mix(accent 28%, transparent)` | Very faint accent |
| `--univer-red-300..600` | `var(--danger)` | Error/danger states |
| `--univer-gray-900` (dark only) | `var(--rail)` | Toolbar + formula-bar outer rail |
| `--univer-gray-800` (dark only) | `var(--surface-1)` | Popovers, menus, dropdowns |
| `--univer-gray-700` (dark only) | `var(--surface-2)` | Inputs, subtle hover |
| `--univer-gray-600` (dark only) | `var(--border)` | Strong borders / hover |
| `--univer-gray-500` (dark only) | `var(--border-soft)` | Hairline dividers |

The gray-token remaps are scoped to `.bismuth-sheet .univer-dark` so light mode (Univer's white surfaces) is left untouched.

**Font**: `.bismuth-sheet, .bismuth-sheet *` forces `font-family: "Monaspace Xenon", ui-monospace, monospace !important` across all chrome elements. Cell text is canvas-rendered by Univer and unaffected by this rule — that is intentional (canvas text is set separately via `ws.setDefaultStyle({ ff: "Monaspace Xenon" })`).

**Ribbon tabs**: restyled to match Bismuth's `SegmentedToggle` (the 2D/3D graph control): a faint track, muted inactive tabs with small uppercase text, and a neutral "pill" for the active tab rather than an accent-colored one.

**Formula bar**: pinned to `--rail` background with a `--border-soft` hairline below, using `--text-muted` text and `--faint` for the fx icon.

### `univer-icons.css`

Generated file — do not edit by hand. Regenerate with:

```bash
bun gen-univer-icons.ts
```

Re-skins Univer's toolbar SVG icons with Lucide equivalents using a CSS mask technique: each icon targets a stable `univerjs-icon-*-icon` class, applies a `mask`/`-webkit-mask` of the Lucide SVG as a data URI, sets `background-color: currentColor`, and hides the original SVG children with `display: none`. This approach survives Univer re-renders and requires no DOM manipulation.

---

## Routing and Creation

### Routing

`PaneContent.tsx` routes any path ending in `.sheet` to `SheetView`:

```ts
// PaneContent.tsx (lazy-loaded)
const SheetView = lazy(() => import("./SheetView").then(m => ({ default: m.SheetView })));

<Match when={props.path.endsWith(".sheet")}>
  <SheetView path={props.path} onSaved={props.onSaved} />
</Match>
```

The `lazy()` wrapper means the entire Solid component (and by extension the `univerSheet.ts` dynamic import) is only evaluated when a `.sheet` pane is first rendered.

### Creating a new spreadsheet

Two entry points, both calling `newDoc("Spreadsheet", "sheet")` in `App.tsx`:

1. **File tree right-click** → "New Spreadsheet" (creates in the right-clicked folder)
2. **Command palette / toolbar** → `new-spreadsheet` command

`newDoc` calls `api.create(path, "file")`, which writes an empty file. On collision it generates a UUID-suffixed fallback name. The empty file opens in a new tab; `parseSnapshot("")` returns `{}`, and Univer initializes a blank workbook.

Default name: `Spreadsheet.sheet` (fallback: `Spreadsheet-<6-char-uuid>.sheet`).

Tab label: the filename without the `.sheet` extension (from `tabIds.ts`). Tab icon: `Table` (Lucide).

---

## Export

`.sheet` files export to **HTML**, **PDF**, and **PNG** (from `export/formats.ts`):

```ts
formatsFor("budget.sheet") // → ["html", "pdf", "png"]
```

Export to HTML uses `sheetHtml.ts`'s `snapshotToHtmlTable(snap)`, which reads the first sheet in `sheetOrder` (falling back to `Object.keys(sheets)`) and renders a plain `<table>` from the sparse `cellData` map (rows × cols, null cells become empty `<td>`). Only raw cell values (`v` field) are exported — formatting, formulas, and multi-sheet tabs beyond the first are not reflected in the HTML export.

---

## Persistence

`.sheet` files are plain vault files. They:

- Are tracked by the file tree (listed in the sidebar alongside `.md` notes)
- Are watched by the backend's file-change watcher (SSE events propagate edits from external editors back to the open pane)
- Can be moved, renamed, and deleted via the file tree with the same affordances as notes
- Are committed by `POST /backup` (git snapshot) along with all other vault files
- Are included in the mobile port's `TREE_EXTS` (`[".md", ".base", ".sheet", ".draw"]`)

They are **not** processed by the vault graph builder — a `.sheet` file does not become a knowledge-graph node.

---

## Gotchas and Edge Cases

- **Remount into the same node renders blank.** Univer cannot be disposed and re-mounted into the same DOM element. `mountSheet` always creates a fresh child div per instance and removes it on `dispose`. The caller's stable `container` ref is never touched.

- **The post-mount baseline is critical.** Univer fires `CommandExecuted` events during its own mount sequence (selection setup, render pass). If `lastWrittenText` is not immediately baselined to `serializeSnapshot(handle.getSnapshot())` after mount, those internal events would look like user edits and trigger a spurious disk write on every open, bumping the server version and potentially causing flicker.

- **The snapshot-equality check also clears `dirty`.** When `save()` fires and `text === lastWrittenText`, `dirty` is explicitly set to `false`. If this were skipped, the `dirty` flag would remain `true` indefinitely after a no-op command, permanently blocking external reloads.

- **`LocaleType.EN_US` not `En_US`.** The Univer enum member is `EN_US`. Passing `En_US` (wrong casing) silently registers the locale under the wrong key, causing raw `ui.ribbon.*` key strings to appear in the toolbar rather than translated labels.

- **No `.sheet` graph nodes.** Unlike `.md` notes, `.sheet` files are not parsed by the vault graph builder and do not appear as nodes in the knowledge graph or generate wikilink edges.

- **HTML export is first-sheet only.** `snapshotToHtmlTable` reads only the first sheet (by `sheetOrder` or key order) and only raw `v` values. Cell formatting, formulas, and additional sheets are not included.

---

`Source: app/src/SheetView.tsx, app/src/sheet/snapshot.ts, app/src/sheet/sync.ts, app/src/sheet/univerSheet.ts, app/src/sheet/univer-theme.css, app/src/sheet/univer-icons.css, app/src/sheet/snapshot.test.ts, app/src/sheet/sync.test.ts, app/src/export/sheetHtml.ts, app/src/export/formats.test.ts, app/src/App.tsx, app/src/PaneContent.tsx`
