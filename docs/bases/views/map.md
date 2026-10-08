# Map view

A map view plots a base's rows as pins on a world map, using each row's latitude and longitude. The map is drawn offline from built-in vector outlines, with no tile server or network access; for the other view kinds, start at [Bases overview](../overview.md).

```yaml
---
type: base
source: notes where file.hasTag("location")
view: map
---
```

Every note tagged `#location` with `lat` and `lng` in its frontmatter becomes a pin, labelled with its title.

## Configuring a map view

Set `view: map` in a `type: base` file. With no other keys, the map reads the bare `lat` and `lng` frontmatter properties. Point it at other properties, or fix the opening framing, with the keys below.

```yaml
---
type: base
view: map
lat: latitude
lng: longitude
zoom: 6
center: { lat: 40.7, lng: -74 }
---
```

| Key | Type | Allowed values | Default | Effect |
|---|---|---|---|---|
| `lat` | string | a property id: bare, `note.x`, `formula.x` | `lat` | Property holding the latitude in decimal degrees |
| `lng` | string | a property id: bare, `note.x`, `formula.x` | `lng` | Property holding the longitude in decimal degrees |
| `zoom` | number | 1 to 18 | none | Opening zoom; used only together with `center` |
| `center` | object | `{ lat: <number>, lng: <number> }` | none | Opening centre; used only together with `zoom` |

The base settings panel (the gear in the view bar) has fields for all four keys. A coordinate can be a number or a numeric string (`"40.7"`).

Two `.settings` keys also shape the map; both are in the [settings reference](../../settings/reference.md):

| Setting | Default | Range | Effect |
|---|---|---|---|
| `graph.mapDefaultZoom` | `2` | 1 to 18 | Zoom when there are no pins, when pins cannot be fitted, and after **Reset view** |
| `ui.mapMinHeight` | `480` | 300 to 800 | Minimum height of the map, in pixels |

## Which rows become pins

A row becomes a pin when both coordinates are numbers, latitude is within -85 to 85 and longitude within -180 to 180. Web Mercator cannot draw the poles, so the latitude range stops at ±85.

Any other row is unplaced: it draws no pin and shows no error, but the map's right-click menu offers to place it (see "Place, move and remove pins" below). When no row has a location, the map shows **no rows have a location**.

A pin's label is the row's value in the view's first column, which is `file.name` unless `order` puts another property first.

## Where the map opens

The map picks its opening framing from the first rule that applies:

1. `center` and `zoom` are both set: use them.
2. No pins: centre at latitude 20, longitude 0, at `graph.mapDefaultZoom`.
3. One pin: centre on it at zoom 10.
4. Several pins: centre on their bounding box at the highest zoom from 14 down to 1 that fits it, else `graph.mapDefaultZoom`.

The framing runs again when `center` or `zoom` changes, and once when the first pins arrive on a map you have not yet moved. Placing or dragging a pin never reframes the map.

## Move around the map

| Control | Action |
|---|---|
| Drag the map | Pan |
| Scroll wheel | Zoom in or out around the pointer |
| **Zoom in**, **Zoom out** (top right) | Zoom around the centre |
| **Reset view** | Back to latitude 20, longitude 0 at `graph.mapDefaultZoom` |
| **Fit to pins** | Re-run the opening framing on the current pins |

Zoom stays between 1 and 18. A scale bar in the bottom left shows a round distance for the current zoom and latitude.

## Place, move and remove pins

A map whose `lat` and `lng` are writable properties (bare or `note.` ids) can create and move pins. Clicking a pin opens the row editor for that row, with its title and the view's columns.

| Action | How | What is written |
|---|---|---|
| Add a new pin | Click **Add pin** (top left), then click the map | A new row at that point, then the row editor opens on it |
| Add a pin from the menu | Right-click the empty map, pick **new pin here** | Same as **Add pin** |
| Place an unplaced row | Right-click the empty map, pick **place *title* here** | That row's `lat` and `lng` |
| Move a pin | Drag it, or right-click it and pick **move pin**, then click the map | The row's `lat` and `lng` |
| Remove a pin | Right-click it, pick **remove pin** | The row's `lat` and `lng` deleted; the row stays |

While **Add pin** or **move pin** is armed, the pointer is a crosshair and a hint follows it; **Escape**, or clicking **Add pin** again, cancels. `Shift+F10` or the context-menu key opens a focused pin's menu.

A new row is a note named `Untitled` (then `Untitled 2`, and so on) beside the base's existing notes, or a row appended to the base file's own body when the base has no `source:`.

Written coordinates are rounded to six decimal places. A click past the edge of the world lands on the nearest edge.

## When the map is read-only

The map cannot write coordinates in these cases, and hides or disables the controls that would:

- `lat` or `lng` is a `formula.`, `file.` or `this.` property. The empty-map menu does not open, **Add pin** is disabled with the reason in its tooltip, and a pin's menu offers only **edit**.
- The view has no base file behind it, such as an embedded ` ```query ` block. Clicking a pin opens its note.
- The rows are stored in another base file (a `source:` that reads another base's rows). **Add pin** is disabled and names the file to add them in.
- A row is a task line. Clicking its pin opens the note.

## Silent failures

- Setting only one of `center` and `zoom` is ignored, and the map auto-fits.
- An empty-string coordinate (`lat: ""`) reads as 0, so the row is pinned at latitude 0 or longitude 0 instead of being unplaced.
- A coordinate with letters in it (`"40.7N"`) is not a number, so the row is unplaced.

## How it works

`MapView` reads `lat`, `lng`, `zoom` and `center` off the `ViewConfig` that `parse.ts`'s `normalizeView` builds (`zoom` must be a YAML number and `center` an object of two numbers, or they are dropped). The map is an SVG basemap (`MapBasemap`) of hard-coded landmass rings and a graticule, with pins (`MapPin`) and controls (`MapControls`) laid over it.

The projection and placement maths are pure functions in `mapCoords.ts`: `project`/`unproject` (Web Mercator), `toNum`, `isPlaceable`, `fitView`, `zoomAround`, `screenToLatLng` (which clamps and rounds with `round6`), `shouldReframe` and `scaleBarFor`. `writableFieldKey` decides whether a coordinate can be written.

A note row's coordinates are written with `POST /set-properties` (`api.setProperties`, both keys in one request) and cleared with two `POST /delete-property` calls. A row stored in a base file's body is written by index with `api.rowUpdate`, the branch chosen by `canWriteStoredRow`. New rows go through `createRow` in `AddRowAction.tsx`. Colours come from the `--map-sea`, `--map-land`, `--map-coast` and `--map-grid` tokens; `ui.mapMinHeight` feeds `--map-min-height`.

Source: `app/src/bases/MapView.tsx`, `app/src/bases/mapCoords.ts`, `app/src/bases/MapBasemap.tsx`, `app/src/bases/MapControls.tsx`, `app/src/bases/MapPin.tsx`, `app/src/bases/AddRowAction.tsx`, `core/src/bases/parse.ts`, `core/src/schema/settingsSchema.ts`
