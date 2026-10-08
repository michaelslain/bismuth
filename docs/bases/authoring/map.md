# map

An offline vector world map that plots rows as pins by latitude and longitude. It needs no tile server or network access.

## Working example

```yaml
---
type: base
source: notes where file.hasTag("location")
view: map
---
```

Custom property names and a fixed opening framing:

```yaml
---
type: base
source: notes where file.hasTag("location")
view: map
lat: latitude
lng: longitude
zoom: 6
center: { lat: 40.7, lng: -74 }
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `lat` | `string` (property id) | `"lat"` | Latitude in decimal degrees. |
| `lng` | `string` (property id) | `"lng"` | Longitude in decimal degrees. |
| `zoom` | `number` | none | Opening zoom, 1 to 18. Used only together with `center`. |
| `center` | `{ lat: number, lng: number }` | none | Opening centre. Used only together with `zoom`. |

These four are the only map keys. There is no tile source, clustering or per-pin colour.

## Failure modes

- If a row lacks the `lat`/`lng` properties (or the ones the config names), it draws no pin and shows no error. The map's right-click menu offers **place *title* here** for it, which writes both coordinates.
- If only one of `zoom` and `center` is set, it is ignored and the map auto-fits.
- If latitude is outside -85 to 85 or longitude outside -180 to 180, the row is unplaced, again with no error.
- If a coordinate is an empty string, it reads as 0 and the row is pinned on the equator or the prime meridian instead of being unplaced. Remove the key rather than blanking it.
- If `lat` or `lng` is a `formula.` property, the map plots it but cannot place, move or remove pins.

Full reference: [docs/bases/views/map.md](../views/map.md)
