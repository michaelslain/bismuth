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

### `lat` (string, optional)

The property id whose value is the latitude in decimal degrees. Defaults to `"lat"` when omitted, which resolves to the bare `lat` frontmatter key. Any property namespace is valid: `"note.latitude"`, `"formula.computed_lat"`, etc.

### `lng` (string, optional)

The property id whose value is the longitude in decimal degrees. Defaults to `"lng"` when omitted. Same namespacing rules as `lat`.

### `zoom` (number, optional)

Seed zoom level for the initial framing. Range 1–18 (enforced at interaction time, not parse time). Only used when `center` is also provided; if only `zoom` is set without `center` it is ignored and auto-fit runs instead.

### `center` (object, optional)

Seed map center for the initial framing. Must be `{ lat: <number>, lng: <number> }`. Only active when `zoom` is also provided. Together `center` + `zoom` bypass the auto-fit logic entirely.

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
2. Latitude must be in `[-85, 85]` (Web Mercator clamped range, exclusive of ±85 but checked as `< -85 || > 85`).
3. Longitude must be in `[-180, 180]`.

Rows that fail any of these checks are silently skipped and never appear as markers. There is no error or warning for skipped rows.

Each marker renders as a pin with a label chip. The label text comes from the first column in `result.columns` (which defaults to `"file.name"` when no explicit `order:` is given). Clicking a marker calls `onOpen` with the row's `file.path`, opening that note in the editor.

## Initial Framing Logic

The view chooses an initial center and zoom according to the following priority:

1. **Explicit `center` + `zoom` in the view config** — used as-is, no auto-fit.
2. **Zero markers** — falls back to `{ lat: 20, lng: 0 }` at the `graph.mapDefaultZoom` setting (default: 2).
3. **Exactly one marker** — centers on that marker at zoom 10.
4. **Multiple markers** — computes the bounding box of all marker coordinates, picks the highest zoom from 14 down to 1 at which the bounding box fits within an 800×600 reference viewport at 80% padding. Falls back to `graph.mapDefaultZoom` if nothing fits (i.e., all zoom levels have too-large a bbox).

The view re-runs this framing logic reactively whenever `result` changes (e.g., when switching views), resetting center and zoom to the new initial values.

## Interaction

- **Pan**: left-click drag anywhere on the map. The cursor changes to `grabbing` during drag.
- **Zoom wheel**: scroll up to zoom in, scroll down to zoom out. The world point under the cursor stays anchored (cursor-anchored zoom).
- **Zoom buttons**: `+` and `−` buttons in the top-right controls panel zoom around the map center.
- **Reset (Compass button)**: resets center and zoom back to the computed initial framing.
- **Locate button**: same as Reset — re-centers and re-fits on the current markers. (Both buttons call the same `initialView()` logic.)
- Zoom is clamped to `[1, 18]`.

## Settings Integration

Two `.settings` entries affect the map view — `mapDefaultZoom` lives under `graph:`, and `mapMinHeight` lives under `ui:`:

| Setting | Default | Range | Description |
|---|---|---|---|
| `graph.mapDefaultZoom` | `2` | 1–18 | Zoom level used when no markers are present or the bbox zoom-fit fails. |
| `ui.mapMinHeight` | `480` | 300–800 | Minimum height of the map element in pixels (applied via the `--map-min-height` CSS variable). |

## UI Elements

The map renders several overlaid elements:

- **SVG basemap** — sea background, graticule grid (30° meridians, 20° parallels; equator and prime meridian drawn bolder), and landmass polygons.
- **Marker layer** — absolutely positioned `<div>` pins above the SVG. Each pin has a text label chip and a teardrop indicator.
- **Controls panel** (top-right) — zoom stack (`+`/`−`) and two solo buttons (Compass / LocateFixed icon).
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

Source: `app/src/bases/MapView.tsx`, `core/src/bases/types.ts`, `core/test/bases/parse.test.ts`, `core/src/schema/settingsSchema.ts`, `core/src/settings.ts`, `app/src/bases/BaseView.module.css`
