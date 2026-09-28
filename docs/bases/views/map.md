# Map View

The map view renders base rows as geographic markers on an interactive world map. It is a fully offline, self-contained renderer — no tile server or internet connection is required. The basemap is a coarse vector world map drawn entirely in SVG using hardcoded polygon outlines for the major landmasses (North America, South America, Africa, Europe, Asia, Australia) plus a graticule grid. Markers are positioned using the Web Mercator projection and can be panned by dragging and zoomed by scroll wheel or the on-screen +/− buttons.

## Configuring a Map View

Set `type: map` in a view entry inside a `type: base` file. The only required fields are `lat` and `lng` (or rows that have bare `lat`/`lng` frontmatter keys, which are the defaults).

```yaml
---
type: base
views:
  - type: map
    name: Atlas
---
```

## View Config Fields

All map-specific fields live on the `ViewConfig` object alongside the standard fields (`name`, `limit`, `filters`, `sort`, `source`, etc.). See [bases overview](../overview.md) for shared fields.

| Field | Type | Default | Description |
|---|---|---|---|
| `lat` | string, optional | `"lat"` | Property id whose value is the latitude in decimal degrees. Defaults to the bare `lat` frontmatter key. Any property namespace is valid: `"note.latitude"`, `"formula.computed_lat"`, etc. |
| `lng` | string, optional | `"lng"` | Property id whose value is the longitude in decimal degrees. Same namespacing rules as `lat`. |
| `zoom` | number, optional | — | Seed zoom level for the initial framing. Range 1–18 (enforced at interaction time, not parse time). Only used when `center` is also provided — set alone, it's ignored and auto-fit runs instead. |
| `center` | object, optional | — | Seed map center for the initial framing. Must be `{ lat: <number>, lng: <number> }`. Only active when `zoom` is also provided. Together, `center` + `zoom` bypass the auto-fit logic entirely. |

```yaml
views:
  - type: map
    name: Atlas
    lat: latitude
    lng: longitude
    zoom: 6
    center: { lat: 40.7, lng: -74 }
```

## Marker Rendering

A row becomes a marker only when both its resolved `lat` and `lng` values are valid numeric coordinates. The filtering rules, applied in order, are:

1. The resolved property value must be a JavaScript `number` or a string that `Number()` can parse without producing `NaN`.
2. Latitude must be in `[-85, 85]` (Web Mercator clamped range, inclusive — rows are dropped only when `< -85 || > 85`).
3. Longitude must be in `[-180, 180]`.

Rows that fail any of these checks are silently skipped and never appear as markers. There is no error or warning for skipped rows.

Each marker renders as a pin with a label chip. The label text comes from the first column in `result.columns` (which defaults to `"file.name"` when no explicit `order:` is given). Clicking a marker calls `onOpen` with the row's `file.path`, opening that note in the editor — unless the click was actually the end of a drag (see [Placing, Moving and Removing Pins](#placing-moving-and-removing-pins) below), in which case it relocates the pin instead.

## Initial Framing Logic

The view chooses an initial center and zoom according to the following priority:

1. **Explicit `center` + `zoom` in the view config** — used as-is, no auto-fit.
2. **Zero markers** — falls back to `{ lat: 20, lng: 0 }` at the `graph.mapDefaultZoom` setting (default: 2).
3. **Exactly one marker** — centers on that marker at zoom 10.
4. **Multiple markers** — computes the bounding box of all marker coordinates, picks the highest zoom from 14 down to 1 at which the bounding box fits within an 800×600 reference viewport at 80% padding. Falls back to `graph.mapDefaultZoom` if nothing fits (i.e., all zoom levels have too-large a bbox).

The view re-runs this framing only when the VIEW changes (switching views, or its configured `center`/`zoom`) and once when the first markers arrive — never merely because a marker moved. Placing or dragging a pin writes its note and the rows refetch; re-fitting on that used to jerk the whole map out from under the pin just put down. The **locate** button still re-fits on demand.

## Interaction

- **Pan**: left-click drag anywhere on the map. The cursor changes to `grabbing` during drag.
- **Zoom wheel**: scroll up to zoom in, scroll down to zoom out. The world point under the cursor stays anchored (cursor-anchored zoom).
- **Zoom buttons**: `+` and `−` buttons in the top-right controls panel zoom around the map center.
- **Reset (`RotateCcw` icon button, "Reset view")**: resets center and zoom back to the computed initial framing.
- **Locate button (`Pin` icon button, "Locate notes")**: same as Reset — re-centers and re-fits on the current markers. (Both buttons call the same `initialView()` logic.)
- Zoom is clamped to `[1, 18]`.

## Placing, Moving and Removing Pins

Rows are no longer only readable off hand-written frontmatter — a pin can be placed, dragged to a new spot, or removed straight from the map, as long as the view's `lat`/`lng` fields resolve to a real frontmatter key (a bare name or an explicit `note.*` id). A `formula.*`, `file.*` or `this.*` coordinate has nothing to write back to, so on a view configured that way the map is **read-only**: the "unplaced" control is hidden and a pin's context menu offers only "open note".

### Placing a row with no coordinates yet

Any row whose resolved `lat`/`lng` is missing, unparseable, or out of Web Mercator's valid range (`lat` outside `[-85, 85]`, `lng` outside `[-180, 180]`) is **unplaced** rather than silently dropped. When there is at least one, a `[ unplaced (N) ]` button appears at the top-left of the map. Clicking it opens a menu listing every unplaced row by its title (the same first-column label a marker's chip shows); picking one **arms placement** — the map shows a "placing `<title>` — esc to cancel" hint that follows the cursor, and the *next click anywhere on the map* writes that row's coordinates at the clicked point and disarms. Pressing `Escape` disarms without writing.

### Moving a pin

A placed pin can be dragged to a new position: press and drag it, and its coordinates update on drop. A pointer-down/up with no real movement is still a plain **click**, which opens the row's note exactly as before — dragging never interferes with the click-to-open behavior. The same "move" is also reachable from a pin's context menu (see below), which re-arms placement for that row instead of requiring a drag.

### Removing a pin from the map

Right-clicking a pin (or pressing `Shift+F10` — or the `ContextMenu` key — while it's focused) opens a menu with three actions:

- **open note** — same as a plain click.
- **move…** — arms placement for that row (the same armed state the unplaced menu starts), so the next map click relocates it.
- **remove from map** — deletes the row's `lat`/`lng` fields, turning it back into an unplaced row. It does not delete the note or any other property.

### How the write lands

- A **note row** (an ordinary vault note, read straight off its frontmatter) writes/clears its coordinates via `PATCH`-style property writes — both fields in one request when setting, one request per field when clearing.
- An **own-rows row** (an inline row stored in the base file's own body — e.g. a base with no `source:`) writes back by row index instead, the same write handle every other stored-row action in Bases uses (kanban drag, task status, …). A row with no write handle (a placeholder row mid-creation) gets no placement affordance.
- Written coordinates are rounded to 6 decimal places (roughly 11cm of precision) — enough for any note's purposes, and short enough that a placed or dragged pin doesn't leave 17 significant digits of float noise in the note's frontmatter.
- A write's mutation already invalidates the base's cache and pushes an SSE update, so the view refetches on its own; nothing further is required to see the pin move.

## Settings Integration

The `lat`, `lng`, `zoom` and `center` fields above are set per-view, in the view's own entry inside the base file's frontmatter — the base's own **settings panel** (opened from the view's config affordance) exposes fields for all four, so a map view's coordinate source and initial framing no longer require hand-editing the base file's YAML.

Two `.settings` entries additionally affect the map view — `mapDefaultZoom` lives under `graph:`, and `mapMinHeight` lives under `ui:`:

| Setting | Default | Range | Description |
|---|---|---|---|
| `graph.mapDefaultZoom` | `2` | 1–18 | Zoom level used when no markers are present or the bbox zoom-fit fails. |
| `ui.mapMinHeight` | `480` | 300–800 | Minimum height of the map element in pixels (applied via the `--map-min-height` CSS variable). |

## UI Elements

The map renders several overlaid elements:

- **SVG basemap** — sea background, graticule grid (30° meridians, 20° parallels; equator and prime meridian drawn bolder), and landmass polygons.
- **Marker layer** — each pin is a `<PlainButton class={styles.mapPin}>` (a real `<button type="button">`) positioned above the SVG, with a text label chip and a teardrop indicator. Draggable, right-clickable and (when focused) `Shift+F10`-able when the view's coordinates are writable — see [Placing, Moving and Removing Pins](#placing-moving-and-removing-pins).
- **Controls panel** (top-right) — zoom stack (`+`/`−`) and two solo `IconButton`s (`RotateCcw` reset / `Pin` locate).
- **Unplaced-rows control** (top-left) — a `[ unplaced (N) ]` button, shown only when at least one row lacks valid coordinates and the view's fields are writable; opens a menu that arms placement for the picked row.
- **Placing hint** — a small floating label reading "placing `<title>` — esc to cancel", shown while a row is armed for placement.
- **Scale bar** (bottom-left) — shows a dynamically computed "nice" distance (1/2/5 × 10^n km or m) representing approximately 70 screen pixels at the current zoom and latitude. Uses the Web Mercator ground resolution formula.
- **Attribution badge** (bottom-right) — `WifiOff` icon + "Offline vector" label, plus a marker count (`N places`) when markers are present.
- **Empty state** — shown when zero markers are valid; displays `"No notes have valid <lat> / <lng> properties."` using the configured (or default) field names.

## CSS Variables

The map respects these theme CSS variables for colors:

- `--map-sea` — sea/ocean background fill
- `--map-land` — landmass polygon fill
- `--map-coast` — landmass stroke and bold graticule color
- `--map-grid` — regular graticule line color
- `--map-min-height` — controlled by the `ui.mapMinHeight` setting

## Example: Minimal (uses default `lat`/`lng` keys)

```yaml
---
type: base
source: notes where #location
views:
  - type: map
    name: Places
---
```

Notes tagged `#location` with `lat` and `lng` in their frontmatter will appear as markers.

## Example: Custom field names + fixed framing

```yaml
---
type: base
views:
  - type: map
    name: Atlas
    lat: latitude
    lng: longitude
    zoom: 6
    center: { lat: 40.7, lng: -74 }
---
```

Reads `latitude` and `longitude` from each row's frontmatter (or formula namespace) and opens the map pre-centered on New York at zoom 6.

## Example: Formula-derived coordinates

```yaml
---
type: base
formulas:
  computed_lat: "note.geo_lat * 1"
  computed_lng: "note.geo_lng * 1"
views:
  - type: map
    name: Atlas
    lat: formula.computed_lat
    lng: formula.computed_lng
---
```

## Gotchas

- **Both `center` and `zoom` must be present** to use fixed framing. Providing only one silently falls through to auto-fit behavior.
- **Latitude is clamped to ±85**, not ±90, because Web Mercator cannot represent the poles. Rows with `lat` outside `[-85, 85]` are dropped.
- **String coordinates work**: the `lat`/`lng` values may be stored as strings in frontmatter — the renderer calls `Number()` on them. A value like `"40.7"` is accepted; `"40.7N"` is not (produces `NaN`).
- **The title chip uses the first resolved column**, not necessarily `file.name`. If a view declares `order: [status, file.name]`, markers will be labeled with `status` values.
- **No tile network dependency**: the basemap is entirely self-contained vector geometry hardcoded in the component. Markers will render correctly in air-gapped environments.
- **ResizeObserver drives the map size**: the component observes its container and re-projects on resize. Initial SSR/static size assumptions (800×600) are replaced once the element mounts.
- **A `formula.*`, `file.*` or `this.*` `lat`/`lng` makes the map read-only**: there is no frontmatter key to write those back to, so the "unplaced" control never appears and a pin's context menu drops "move…"/"remove from map" down to "open note" only.
- **Written coordinates are rounded to 6 decimal places**, whether from a placement click or a drag — a base whose notes carry more precise hand-written coordinates keeps them until a pin over that row is placed/moved again.

Source: `app/src/bases/MapView.tsx`, `app/src/bases/mapCoords.ts` (pure projection + coordinate-write math, unit-tested in `app/src/bases/mapCoords.test.ts`), `app/src/bases/taskWrite.ts` (`canWriteStoredRow`/`storedNote`, shared with the rest of Bases' row-index write seam), `core/src/bases/types.ts`, `core/test/bases/parse.test.ts`, `core/src/schema/settingsSchema.ts`, `core/src/settings.ts`, `app/src/bases/MapView.module.css`
