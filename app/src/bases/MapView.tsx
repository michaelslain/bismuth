import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import type { ViewResult, BaseConfig, Row } from "../../../core/src/bases/types";
import { resolveProperty } from "../../../core/src/bases/query";
import { renderValue } from "./renderValue";
import { Button } from "../ui/Button";
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
    if (ms.length === 0) return { center: { lat: 20, lng: 0 }, zoom: 2 };
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
    return { center: { lat: cLat, lng: cLng }, zoom: 2 };
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
  // both tile placement and marker placement.
  const centerWorld = createMemo(() => project(center().lat, center().lng, zoom()));

  // Convert a world-pixel coord into screen-pixel coords inside the map element.
  function toScreen(wx: number, wy: number) {
    const { w, h } = size();
    const c = centerWorld();
    return { x: w / 2 + (wx - c.x), y: h / 2 + (wy - c.y) };
  }

  // The visible tile grid at the current zoom + center.
  const tiles = createMemo(() => {
    const z = zoom();
    const { w, h } = size();
    const c = centerWorld();
    const left = c.x - w / 2;
    const top = c.y - h / 2;
    const right = c.x + w / 2;
    const bottom = c.y + h / 2;
    const tx0 = Math.floor(left / 256);
    const ty0 = Math.floor(top / 256);
    const tx1 = Math.ceil(right / 256);
    const ty1 = Math.ceil(bottom / 256);
    const max = 2 ** z;
    const out: { z: number; x: number; y: number; left: number; top: number }[] = [];
    for (let ty = ty0; ty < ty1; ty++) {
      if (ty < 0 || ty >= max) continue;
      for (let tx = tx0; tx < tx1; tx++) {
        // Horizontal wrap: tiles repeat east-west at all zoom levels.
        const wx = ((tx % max) + max) % max;
        out.push({
          z, x: wx, y: ty,
          left: tx * 256 - left,
          top: ty * 256 - top,
        });
      }
    }
    return out;
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

  // Zoom on wheel. Scroll up → zoom in; cursor's world point stays anchored under cursor.
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const z0 = zoom();
    const delta = -Math.sign(e.deltaY);
    const z1 = Math.max(1, Math.min(18, z0 + delta));
    if (z1 === z0) return;

    const rect = mapEl!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // World coord under cursor at old zoom.
    const c0 = centerWorld();
    const wx0 = c0.x + (cx - size().w / 2);
    const wy0 = c0.y + (cy - size().h / 2);

    // Same lat/lng at new zoom; scales geometrically.
    const scale = 2 ** (z1 - z0);
    const wx1 = wx0 * scale;
    const wy1 = wy0 * scale;

    // New center keeps cursor's world point fixed on screen.
    setZoom(z1);
    setCenter(unproject(wx1 - (cx - size().w / 2), wy1 - (cy - size().h / 2), z1));
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
        <div class={styles.mapTiles}>
            <For each={tiles()}>
              {(t) => (
                <img
                  class={styles.mapTile}
                  src={`https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`}
                  style={{ left: `${t.left}px`, top: `${t.top}px` }}
                  alt=""
                  draggable={false}
                />
              )}
            </For>
          </div>
          <div class={styles.mapMarkers}>
            <For each={markers()}>
              {(m) => {
                const p = project(m.lat, m.lng, zoom());
                const s = toScreen(p.x, p.y);
                return (
                  <Button
                    variant="plain"
                    class={styles.mapMarker}
                    style={{ left: `${s.x}px`, top: `${s.y}px` }}
                    title={String(renderValue(titleCol(), m.row))}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onOpen?.(m.row.file.path);
                    }}
                  />
                );
              }}
            </For>
          </div>
          <div class={styles.mapAttribution}>
            © <a href="https://openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
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
