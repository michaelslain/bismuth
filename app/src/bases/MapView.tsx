import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { Plus, Minus, Compass, LocateFixed, WifiOff } from "lucide-solid";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { resolveProperty } from "../../../core/src/bases/query";
import { renderValue } from "./renderValue";
import { settings } from "../settings";
import styles from "./BaseView.module.css";

// Web Mercator: convert (lat, lng) at zoom level z to world-pixel coords.
// Standard slippy-map projection — one tile = 256px, 2^z tiles per axis.
function project(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n * 256;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n * 256;
  return { x, y };
}

// Inverse: world-pixel (x, y) at zoom z back to (lat, lng).
function unproject(x: number, y: number, z: number): { lat: number; lng: number } {
  const n = 2 ** z;
  const lng = (x / (n * 256)) * 360 - 180;
  const t = Math.PI - (2 * Math.PI * y) / (n * 256);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t)));
  return { lat, lng };
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isNaN(n) ? NaN : n;
  }
  return NaN;
}

interface Marker { row: Row; lat: number; lng: number; }

// Offline vector basemap. Continents are coarse lng/lat polygon outlines —
// enough to read as a world map without any network tiles. Each ring is a
// list of [lng, lat] vertices; we project them at the current zoom and draw
// them in the same world-pixel space as the markers so they pan/zoom together.
const LANDMASSES: [number, number][][] = [
  // North America
  [[-168, 65], [-140, 70], [-95, 72], [-60, 60], [-55, 47], [-70, 42], [-81, 25],
   [-97, 18], [-105, 23], [-117, 32], [-125, 40], [-130, 55], [-150, 60], [-168, 65]],
  // South America
  [[-80, 9], [-60, 11], [-50, 0], [-35, -8], [-40, -22], [-58, -34], [-70, -52],
   [-75, -45], [-72, -30], [-81, -15], [-80, -5], [-80, 9]],
  // Africa
  [[-17, 21], [0, 35], [11, 37], [32, 31], [43, 12], [51, 12], [40, -5], [40, -18],
   [33, -28], [20, -35], [16, -28], [9, -2], [-8, 5], [-17, 12], [-17, 21]],
  // Europe
  [[-10, 36], [-9, 44], [-2, 49], [2, 51], [8, 54], [12, 56], [22, 60], [30, 62],
   [40, 55], [30, 45], [20, 40], [12, 38], [-10, 36]],
  // Asia
  [[30, 62], [55, 70], [90, 73], [140, 72], [160, 68], [180, 65], [170, 55], [140, 52],
   [135, 40], [122, 30], [108, 18], [97, 9], [80, 8], [72, 20], [60, 25], [48, 30],
   [40, 40], [42, 50], [35, 58], [30, 62]],
  // Australia
  [[114, -22], [130, -12], [142, -11], [153, -25], [150, -38], [137, -36], [128, -32],
   [115, -34], [114, -22]],
];

// Coarse graticule spacing in degrees.
const GRAT_LNG = 30;
const GRAT_LAT = 20;

export function MapView(props: {
  result: ViewResult;
  config: BaseConfig;
  onOpen?: (path: string) => void;
}) {
  const latKey = () => props.result.view.lat ?? "lat";
  const lngKey = () => props.result.view.lng ?? "lng";
  const titleCol = () => props.result.columns[0] ?? "file.name";

  // Collect markers with valid numeric lat/lng (done once per result; pan/zoom don't reflow).
  const markers = createMemo<Marker[]>(() => {
    const lk = latKey();
    const lnk = lngKey();
    const out: Marker[] = [];
    for (const group of props.result.groups) {
      for (const row of group.rows) {
        const lat = toNum(resolveProperty(lk, row));
        const lng = toNum(resolveProperty(lnk, row));
        if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
        if (lat < -85 || lat > 85 || lng < -180 || lng > 180) continue;
        out.push({ row, lat, lng });
      }
    }
    return out;
  });

  // Initial framing: use view.center/zoom if given; else center+fit on the markers
  // we have; else fall back to a low-zoom world view.
  const initialView = createMemo(() => {
    const v = props.result.view;
    if (v.center && typeof v.zoom === "number") return { center: v.center, zoom: v.zoom };
    const ms = markers();
    if (ms.length === 0) return { center: { lat: 20, lng: 0 }, zoom: settings.graph.mapDefaultZoom };
    if (ms.length === 1) return { center: { lat: ms[0].lat, lng: ms[0].lng }, zoom: 10 };
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const m of ms) {
      if (m.lat < minLat) minLat = m.lat;
      if (m.lat > maxLat) maxLat = m.lat;
      if (m.lng < minLng) minLng = m.lng;
      if (m.lng > maxLng) maxLng = m.lng;
    }
    // Rough zoom-fit: pick a zoom whose viewport covers the bbox at 800×600.
    // Iterate down from max zoom to find the first that fits with 80% padding.
    const cLat = (minLat + maxLat) / 2;
    const cLng = (minLng + maxLng) / 2;
    for (let z = 14; z >= 1; z--) {
      const a = project(maxLat, minLng, z);
      const b = project(minLat, maxLng, z);
      if (Math.abs(b.x - a.x) < 800 * 0.8 && Math.abs(b.y - a.y) < 600 * 0.8) {
        return { center: { lat: cLat, lng: cLng }, zoom: z };
      }
    }
    return { center: { lat: cLat, lng: cLng }, zoom: settings.graph.mapDefaultZoom };
  });

  const [center, setCenter] = createSignal(initialView().center);
  const [zoom, setZoom] = createSignal(initialView().zoom);
  // Re-frame when the result changes (e.g. switching views).
  createEffect(() => {
    const iv = initialView();
    setCenter(iv.center);
    setZoom(iv.zoom);
  });

  let mapEl: HTMLDivElement | undefined;
  const [size, setSize] = createSignal({ w: 800, h: 600 });

  onMount(() => {
    if (!mapEl) return;
    const ro = new ResizeObserver(() => {
      const r = mapEl!.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(mapEl);
    onCleanup(() => ro.disconnect());
  });

  // World-pixel coords of the map center at the current zoom — the anchor for
  // both basemap geometry and marker placement.
  const centerWorld = createMemo(() => project(center().lat, center().lng, zoom()));

  // Convert a world-pixel coord into screen-pixel coords inside the map element.
  function toScreen(wx: number, wy: number) {
    const { w, h } = size();
    const c = centerWorld();
    return { x: w / 2 + (wx - c.x), y: h / 2 + (wy - c.y) };
  }

  // Project a geographic point to screen pixels at the current view.
  function geoToScreen(lat: number, lng: number) {
    const p = project(lat, lng, zoom());
    return toScreen(p.x, p.y);
  }

  // Landmass polygons as screen-space SVG path strings.
  const landPaths = createMemo(() => {
    // Touch zoom()/centerWorld() (via geoToScreen) so the memo recomputes on pan/zoom.
    return LANDMASSES.map((ring) => {
      let d = "";
      for (let i = 0; i < ring.length; i++) {
        const [lng, lat] = ring[i];
        const s = geoToScreen(lat, lng);
        d += (i === 0 ? "M" : "L") + s.x.toFixed(1) + " " + s.y.toFixed(1) + " ";
      }
      return d + "Z";
    });
  });

  // Graticule: meridians (vertical) + parallels (horizontal) as screen lines.
  // Equator + prime meridian are flagged bold.
  const graticule = createMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; bold: boolean }[] = [];
    for (let lng = -180; lng <= 180; lng += GRAT_LNG) {
      const a = geoToScreen(85, lng);
      const b = geoToScreen(-85, lng);
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, bold: lng === 0 });
    }
    for (let lat = -80; lat <= 80; lat += GRAT_LAT) {
      const a = geoToScreen(lat, -180);
      const b = geoToScreen(lat, 180);
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, bold: lat === 0 });
    }
    return lines;
  });

  // Scale bar: how many km does a fixed on-screen segment represent, rounded
  // to a "nice" number. Uses the meters-per-pixel at the map center.
  const scaleBar = createMemo(() => {
    const z = zoom();
    const lat = center().lat;
    // Web-Mercator ground resolution (m/px) at this lat & zoom.
    const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    const targetPx = 70;
    const rawKm = (mPerPx * targetPx) / 1000;
    // Round down to 1/2/5 × 10^n.
    const pow = 10 ** Math.floor(Math.log10(rawKm));
    const mult = rawKm / pow;
    const nice = mult >= 5 ? 5 : mult >= 2 ? 2 : 1;
    const km = nice * pow;
    const widthPx = (km * 1000) / mPerPx;
    const label = km >= 1 ? `${km} km` : `${Math.round(km * 1000)} m`;
    return { widthPx, label };
  });

  // Pan via mouse drag. Track in world-pixel deltas, then unproject the new center.
  let dragging = false;
  let dragLastX = 0;
  let dragLastY = 0;

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    dragging = true;
    dragLastX = e.clientX;
    dragLastY = e.clientY;
    (e.currentTarget as HTMLElement).style.cursor = "grabbing";
  }

  function onMouseMove(e: MouseEvent): void {
    if (!dragging) return;
    const dx = e.clientX - dragLastX;
    const dy = e.clientY - dragLastY;
    dragLastX = e.clientX;
    dragLastY = e.clientY;
    const c = centerWorld();
    setCenter(unproject(c.x - dx, c.y - dy, zoom()));
  }

  function onMouseUp(e: MouseEvent): void {
    dragging = false;
    (e.currentTarget as HTMLElement).style.cursor = "";
  }

  // Zoom keeping a screen point anchored. `anchor` is screen-px within the map;
  // defaults to the map center (used by the +/- buttons).
  function zoomBy(delta: number, anchor?: { x: number; y: number }): void {
    const z0 = zoom();
    const z1 = Math.max(1, Math.min(18, z0 + delta));
    if (z1 === z0) return;
    const { w, h } = size();
    const ax = anchor ? anchor.x : w / 2;
    const ay = anchor ? anchor.y : h / 2;

    const c0 = centerWorld();
    const wx0 = c0.x + (ax - w / 2);
    const wy0 = c0.y + (ay - h / 2);
    const scale = 2 ** (z1 - z0);
    const wx1 = wx0 * scale;
    const wy1 = wy0 * scale;

    setZoom(z1);
    setCenter(unproject(wx1 - (ax - w / 2), wy1 - (ay - h / 2), z1));
  }

  // Zoom on wheel. Scroll up → zoom in; cursor's world point stays anchored under cursor.
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = mapEl!.getBoundingClientRect();
    zoomBy(-Math.sign(e.deltaY), { x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  // Compass: reset to a north-up world view.
  function resetNorth(): void {
    const iv = initialView();
    setCenter(iv.center);
    setZoom(iv.zoom);
  }

  // Locate: recenter (and fit) on the markers we have.
  function locate(): void {
    const iv = initialView();
    setCenter(iv.center);
    setZoom(iv.zoom);
  }

  return (
    <div class={styles.mapWrap}>
      <div
        class={styles.map}
        ref={mapEl}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        {/* Offline vector basemap: sea bg + graticule + landmasses. */}
        <svg class={styles.mapVector} width={size().w} height={size().h}>
          <rect class={styles.mapSea} x="0" y="0" width={size().w} height={size().h} />
          <g>
            <For each={graticule()}>
              {(l) => (
                <line
                  class={l.bold ? styles.mapGridBold : styles.mapGrid}
                  x1={l.x1}
                  y1={l.y1}
                  x2={l.x2}
                  y2={l.y2}
                />
              )}
            </For>
          </g>
          <g>
            <For each={landPaths()}>
              {(d) => <path class={styles.mapLand} d={d} />}
            </For>
          </g>
        </svg>

        <div class={styles.mapMarkers}>
          <For each={markers()}>
            {(m) => {
              const p = project(m.lat, m.lng, zoom());
              const s = toScreen(p.x, p.y);
              const title = String(renderValue(titleCol(), m.row));
              return (
                <div
                  class={styles.mapPin}
                  style={{ left: `${s.x}px`, top: `${s.y}px` }}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onOpen?.(m.row.file.path);
                  }}
                >
                  <span class={styles.mapPinChip}>{title}</span>
                  <span class={styles.mapPinTeardrop} />
                </div>
              );
            }}
          </For>
        </div>

        {/* Floating controls, top-right. */}
        <div class={styles.mapControls}>
          <div class={styles.mapZoomStack}>
            <button
              type="button"
              class={styles.mapCtrlBtn}
              title="Zoom in"
              onClick={() => zoomBy(1)}
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              class={styles.mapCtrlBtn}
              title="Zoom out"
              onClick={() => zoomBy(-1)}
            >
              <Minus size={15} />
            </button>
          </div>
          <button
            type="button"
            class={`${styles.mapCtrlBtn} ${styles.mapCtrlSolo}`}
            title="Reset north"
            onClick={resetNorth}
          >
            <Compass size={16} />
          </button>
          <button
            type="button"
            class={`${styles.mapCtrlBtn} ${styles.mapCtrlSolo}`}
            title="Locate notes"
            onClick={locate}
          >
            <LocateFixed size={15} />
          </button>
        </div>

        {/* Scale bar. */}
        <div class={styles.mapScale}>
          <span class={styles.mapScaleBar} style={{ width: `${scaleBar().widthPx}px` }} />
          <span class={styles.mapScaleLabel}>{scaleBar().label}</span>
        </div>

        {/* Offline-vector attribution badge. */}
        <div class={styles.mapAttribution}>
          <span class={styles.mapOfflineBadge}>
            <WifiOff size={11} />
            Offline vector
          </span>
          <Show when={markers().length > 0}>
            <span class={styles.mapAttrCount}>
              {markers().length} {markers().length === 1 ? "place" : "places"}
            </span>
          </Show>
        </div>

        <Show when={markers().length === 0}>
          <div class={styles.mapEmpty}>
            No notes have valid <code>{latKey()}</code> / <code>{lngKey()}</code> properties.
          </div>
        </Show>
      </div>
    </div>
  );
}
