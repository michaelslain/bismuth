# map

An offline, self-contained vector world map plotting rows as pins by lat/lng. No tile server or network dependency.

## Working example

```yaml
---
type: base
source: notes where "#location"
views:
  - type: map
    name: Places
---
```

Custom field names + fixed framing:

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

Formula-derived coordinates:

```yaml
---
type: base
formulas:
  computed_lat: "note.geo_lat * 1"
  computed_lng: "note.geo_lng * 1"
views:
  - type: map
    lat: formula.computed_lat
    lng: formula.computed_lng
---
```

## Config keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `lat` | `string` (property id) | `"lat"` | Latitude in decimal degrees. |
| `lng` | `string` (property id) | `"lng"` | Longitude in decimal degrees. |
| `zoom` | `number` | none | Initial zoom (1–18). Only takes effect together with `center`. |
| `center` | `{ lat: number, lng: number }` | none | Initial center. Only takes effect together with `zoom`. |

## Failure modes

- **`lat`/`lng` default to the bare frontmatter keys `"lat"`/`"lng"`.** A row without those exact keys (and no `lat:`/`lng:` config pointing elsewhere) is silently skipped as a marker — no error, no warning.
- **Both `zoom` AND `center` must be set together** for fixed initial framing; setting only one is ignored and the view falls back to auto-fit.
- **Latitude is clamped to ±85, not ±90** (Web Mercator can't represent the poles) — rows outside `[-85, 85]` lat or `[-180, 180]` lng never render, again with no error.

Full reference: `docs/bases/views/map.md`
