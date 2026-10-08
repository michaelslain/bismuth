# Sheets

A sheet is a spreadsheet that lives in your vault as a `.sheet` file. You edit it in the app with the Univer spreadsheet editor, and the file on disk is plain JSON that diffs cleanly in git. This page is for anyone who keeps tables, budgets or calculations in a vault, and for engineers who read or write `.sheet` files.

An empty `.sheet` file is a valid, blank workbook. A small one looks like this:

```json
{
  "id": "wb1",
  "name": "Budget",
  "sheetOrder": ["s1"],
  "sheets": {
    "s1": {
      "name": "Sheet1",
      "cellData": { "0": { "0": { "v": "Item" }, "1": { "v": "Cost" } } }
    }
  }
}
```

## Create and open a sheet

Right-click a folder in the file tree and choose **New Spreadsheet** to make `Untitled.sheet` there, ready to rename. The **New spreadsheet** command (command palette, the `+` menu or a toolbar button) makes `Spreadsheet.sheet` at the vault root and opens it. If that name is taken the command adds a six-character suffix, as in `Spreadsheet-1a2b3c.sheet`. Click any `.sheet` file in the tree to open it. Its tab shows the file name without the extension, with a table icon.

## Edit a sheet

The editor has the usual ribbon and formula bar, with cell editing, formulas, formatting, sorting and column filters. Cell text uses Monaspace Xenon, and the editor's colours follow your app theme, switching live when you change it.

Edits save by themselves 750 ms after you stop typing. Opening a sheet and clicking around without changing anything writes nothing.

If another program changes the file while you have it open and you have no unsaved edits, the sheet reloads from disk. The reload is skipped while you have edits in flight, so your changes are never overwritten. If the new content is not valid JSON, or the file is deleted, the sheet keeps showing the last good workbook.

If the file cannot be read or is not valid JSON when you open it, the pane shows the error in red and the editor does not start.

## Export a sheet

A sheet exports to `html`, `pdf` and `png` from the export pane (Mod+Shift+P) or with `bismuth export Budget.sheet --format html`. See [export](../export/overview.md). The export contains the first sheet only, as a plain table of raw cell values: formatting, formulas and any later sheets are not included. Cell text renders inline markdown and `$math$`, the same as it does on screen.

## Where sheets show up

A `.sheet` file is an ordinary vault file. The file tree lists it next to notes, and you can move, rename and delete it there. The change watcher picks up edits from other programs. A sheet is not a note, so it never becomes a node in the [knowledge graph](../graph/overview.md) and its text is not scanned for links.

## The `.sheet` file format

A `.sheet` file is a Univer `IWorkbookData` object written as JSON with 2-space indentation, which keeps git diffs readable. The fields Bismuth itself reads are these:

| Field | Type | Meaning |
|---|---|---|
| `sheets` | `Record<sheetId, SheetData>` | Map of sheet id to sheet |
| `sheetOrder` | `string[]` | Sheet ids in tab order |
| `sheets[id].name` | `string` | Tab name |
| `sheets[id].cellData` | `Record<row, Record<col, { v }>>` | Sparse cells; row and column keys are numeric strings; `v` is the raw value |

Univer writes more fields (`id`, `name`, styles and so on), and the file holds whatever Univer's `save()` returns.

`parseSnapshot("")` and whitespace-only text return `{}`, which Univer opens as a fresh blank workbook. Invalid JSON throws `SheetParseError` with the message `Invalid .sheet contents: <cause>`, and the pane shows that message. `serializeSnapshot` is `JSON.stringify(data, null, 2)`, so the same object always produces the same text, and `parseSnapshot(serializeSnapshot(data))` equals `data`.

## How it works

`SheetView.tsx` owns the Solid lifecycle, `sheet/univerSheet.ts` adapts Univer, `sheet/snapshot.ts` parses and serialises, and `sheet/sync.ts` guards reloads. `snapshot.ts` has no Univer, canvas or DOM dependency, so Bun tests it directly.

### Code-split bundle

The editor uses `@univerjs/presets` 0.25 and is large, so `SheetView` loads it with a dynamic `import("./sheet/univerSheet")` the first time a `.sheet` pane renders, and Vite puts it in its own chunk. `PaneContent.tsx` also lazy-loads `SheetView` for any path ending in `.sheet`. The presets are `UniverSheetsCorePreset`, `UniverSheetsSortPreset` and `UniverSheetsFilterPreset`, with the locale set to `LocaleType.EN_US`. The enum member must be exactly `EN_US`: the wrong casing registers the locale under a wrong key and the ribbon shows raw `ui.ribbon.*` strings.

### Mount and remount

`mountSheet({ container, data?, onChange, dark? })` returns a `SheetHandle` with `getSnapshot()` (the active workbook's `save()`), `setDark(dark)` and `dispose()` (safe to call repeatedly). Univer rendered blank when it was disposed and re-created into the same node, so each mount creates a fresh child `<div class="bismuth-sheet">` inside the caller's stable container and removes it on dispose. External-reload remounts depend on this.

After `createWorkbook`, every sheet gets the default cell style `{ ff: "Monaspace Xenon" }`. This happens before `onChange` is wired, so it counts as part of the baseline and is not a user edit.

### Load, save and reload

`SheetView` props are `{ path: string; onSaved?: () => void }`.

1. On mount it reads the file with `api.read`, parses it, and mounts. Right after mounting it sets `lastWrittenText` to `serializeSnapshot(handle.getSnapshot())`. Univer fires commands during its own mount (selection setup, render pass); with the baseline set, they compare equal and cause no write.
2. Every data-mutating Univer command sets `dirty` and calls a 750 ms debounced `save()`. The save serialises the snapshot; if the text equals `lastWrittenText` it clears `dirty` and skips the write; otherwise it calls `api.write`, updates `lastWrittenText`, clears `dirty` and calls `onSaved`. Clearing `dirty` on a skipped write matters: a flag left `true` would block every later external reload.
3. `onServerChange` is registered synchronously, not inside the async `onMount`, so the component's `onCleanup` owns its cleanup. On a change that names the file while clean, it reads the disk text and calls `isExternalChange`. A `true` result disposes the old instance and mounts a fresh one.
4. A `createEffect` over `settings.appearance` calls `handle.setDark(!resolveAppearance(settings.appearance).isLight)`.
5. Cleanup unsubscribes the listener, cancels the pending save and disposes Univer.

`isExternalChange({ path, changedPaths, isDirty, diskText, lastWrittenText })` in `sync.ts` is pure. It returns `true` only when `changedPaths` includes `path`, `isDirty` is `false`, and `diskText !== lastWrittenText` (or nothing has been written yet). The last test filters the echo: every `api.write` comes back over SSE, and without it the sheet would reload after each save.

### Theme

The Univer theme is a section of `app/src/global.css`, scoped to `.bismuth-sheet`; it is global because Univer builds its own DOM. Univer's chrome reads `var(--univer-*)` properties with `!important`, so the theme overrides those variables and maps them onto Bismuth's tokens instead of fighting specificity: `--univer-primary-*` to `--accent` and mixes of it, `--univer-red-*` to `--danger`, and in dark mode (`.bismuth-sheet .univer-dark`) the gray ramp to `--rail`, `--surface-1`, `--surface-2`, `--border` and `--border-soft`. All chrome is forced to Monaspace Xenon. Cell text is drawn on Univer's canvas, so the font reaches it only through the default cell style above.

The toolbar icons are re-skinned with Lucide glyphs through a second, generated section of `global.css`: each rule masks a stable `univerjs-icon-*-icon` class with an SVG data URI and sets `background-color: currentColor`. `scripts/gen-univer-icons.ts` generates it; do not edit it by hand.

### HTML export

`snapshotToHtmlTable()` in `export/sheetHtml.ts` picks the first id in `sheetOrder` that exists in `sheets` (falling back to key order), finds the largest populated row and column, and writes a `<table>` whose empty cells are empty `<td>`. Each value goes through `renderCellHtml` (inline markdown and math, sanitised).

Source: `app/src/SheetView.tsx`, `app/src/sheet/snapshot.ts`, `app/src/sheet/sync.ts`, `app/src/sheet/univerSheet.ts`, `app/src/global.css`, `app/src/export/sheetHtml.ts`, `app/src/export/formats.ts`, `app/src/PaneContent.tsx`, `app/src/FileTree.tsx`, `app/src/App.tsx`, `scripts/gen-univer-icons.ts`
