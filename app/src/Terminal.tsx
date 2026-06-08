// app/src/Terminal.tsx
// Mounts an xterm.js terminal and connects it to the backend WebSocket PTY.
import { onMount, onCleanup, createEffect } from "solid-js";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";
import { settings, DEFAULT_ACCENT_PALETTE } from "./settings";
import { paletteToInts } from "./themeColors";
import { resolveAppearance } from "./themes";

// The active node palette (centralized Oxide accentPalette) as 0xRRGGBB ints.
function activePaletteInts(): number[] {
  const ap = resolveAppearance(settings.appearance).accentPalette;
  return paletteToInts(ap?.length ? ap : DEFAULT_ACCENT_PALETTE);
}

// Build a 16-color ANSI palette from the accent palette + theme bg/fg.
// Cycles palette colors through the hue slots; black/white come from CSS vars.
function buildAnsiPalette(palette: number[], fg: string, bg: string) {
  const hexes = palette.map((n) => "#" + n.toString(16).padStart(6, "0"));
  // Cycle 5 palette colors (mod) across 6 hue slots: red, green, yellow, blue, magenta, cyan.
  const cycle = (i: number) => hexes[i % hexes.length];
  const lighten = (hex: string, pct: number) => {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    r = Math.min(255, Math.round(r + (255 - r) * pct));
    g = Math.min(255, Math.round(g + (255 - g) * pct));
    b = Math.min(255, Math.round(b + (255 - b) * pct));
    return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
  };
  return {
    black: bg,
    red: cycle(0),
    green: cycle(1),
    yellow: cycle(2),
    blue: cycle(3),
    magenta: cycle(4),
    cyan: cycle(5),
    white: fg,
    brightBlack: lighten(bg, 0.4),
    brightRed: lighten(cycle(0), 0.2),
    brightGreen: lighten(cycle(1), 0.2),
    brightYellow: lighten(cycle(2), 0.2),
    brightBlue: lighten(cycle(3), 0.2),
    brightMagenta: lighten(cycle(4), 0.2),
    brightCyan: lighten(cycle(5), 0.2),
    brightWhite: fg,
  };
}

// Build the 240-entry extendedAnsi array (slots 16-255) tinted toward the
// active palette. Preserves brightness/contrast from the standard 256-color
// scheme so prompts/themes that use 256-color escapes still read structurally,
// but pulls hues into the palette's family.
function buildExtendedAnsi(paletteInts: number[]): string[] {
  // Convert palette to {r,g,b} once.
  const palette = paletteInts.map((n) => ({ r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }));
  const stops = [0, 95, 135, 175, 215, 255];
  const out: string[] = [];

  const closest = (r: number, g: number, b: number) => {
    let best = palette[0], bestD = Infinity;
    for (const p of palette) {
      const d = (p.r - r) ** 2 + (p.g - g) ** 2 + (p.b - b) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  };
  const mix = (a: number, b: number, t: number) => Math.round(a * (1 - t) + b * t);
  const hex = (r: number, g: number, b: number) =>
    "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");

  // 6×6×6 RGB cube (slots 16-231 → array indices 0-215).
  for (let r6 = 0; r6 < 6; r6++) {
    for (let g6 = 0; g6 < 6; g6++) {
      for (let b6 = 0; b6 < 6; b6++) {
        const r = stops[r6], g = stops[g6], b = stops[b6];
        const c = closest(r, g, b);
        // 25% original, 75% palette tint.
        out.push(hex(mix(r, c.r, 0.75), mix(g, c.g, 0.75), mix(b, c.b, 0.75)));
      }
    }
  }
  // Grayscale (slots 232-255 → array indices 216-239). Tint slightly toward
  // the average palette color so it doesn't feel disjoint.
  const avg = palette.reduce(
    (a, p) => ({ r: a.r + p.r / palette.length, g: a.g + p.g / palette.length, b: a.b + p.b / palette.length }),
    { r: 0, g: 0, b: 0 },
  );
  for (let i = 0; i < 24; i++) {
    const v = 8 + 10 * i;
    out.push(hex(mix(v, Math.round(avg.r), 0.5), mix(v, Math.round(avg.g), 0.5), mix(v, Math.round(avg.b), 0.5)));
  }
  return out;
}

// Derive the WebSocket base URL from the same env var that the HTTP api.ts uses,
// so that VITE_API_BASE overrides work for ws:// too.
const HTTP_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4321";
const WS_BASE = HTTP_BASE.replace(/^http/, "ws"); // http→ws, https→wss

// Fix 3: Hoist TextEncoder to module scope — avoids a per-keystroke allocation.
const enc = new TextEncoder();

// WebSocket frame builders for the PTY protocol.
// stdin frame: 0x00 prefix + raw bytes.
function stdinFrame(bytes: Uint8Array): Uint8Array {
  const frame = new Uint8Array(1 + bytes.length);
  frame[0] = 0x00;
  frame.set(bytes, 1);
  return frame;
}
// resize frame: 0x01 prefix + cols, rows as little-endian uint16s.
function resizeFrame(cols: number, rows: number): Uint8Array {
  const frame = new Uint8Array(5);
  const view = new DataView(frame.buffer);
  frame[0] = 0x01;
  view.setUint16(1, cols, true);
  view.setUint16(3, rows, true);
  return frame;
}

// Module-scope single-entry cache for buildExtendedAnsi (240 entries, rarely changes).
let _extendedAnsiKey = "";
let _extendedAnsiResult: string[] = [];
function cachedExtendedAnsi(paletteInts: number[]): string[] {
  const key = paletteInts.join(",");
  if (key !== _extendedAnsiKey) {
    _extendedAnsiKey = key;
    _extendedAnsiResult = buildExtendedAnsi(paletteInts);
  }
  return _extendedAnsiResult;
}

export function TerminalTab(props: { id: string; active: () => boolean }) {
  let container!: HTMLDivElement;
  // Fix 1: Declare mutable refs at component scope so the top-level createEffect
  // can close over them without being nested inside onMount.
  let fit: FitAddon | undefined;
  let ws: WebSocket | undefined;
  let term: Xterm | undefined;
  // B8/B20: Hoist the remaining post-await resources to component scope so the
  // synchronous onCleanup (registered before the font-load await) can tear them
  // down even if the tab is closed mid-await.
  let ro: ResizeObserver | undefined;
  let cursorEl: HTMLDivElement | undefined;
  let downHandler: ((e: MouseEvent) => void) | undefined;
  let upHandler: ((e: MouseEvent) => void) | undefined;
  // Reconnection state — exponential backoff, cleared on successful open.
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  // rAF handle for debounced resize — collapses bursts during divider drag.
  let resizeRafId = 0;

  const sendResize = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !term) return;
    ws.send(resizeFrame(term.cols, term.rows));
  };

  // Fix 1: createEffect at component top level — properly owned by the component's
  // reactive context and auto-disposed on cleanup. Inside onMount it would be
  // unowned and never collected.
  createEffect(() => {
    if (!props.active()) return;
    if (!term) return; // onMount hasn't completed yet — skip silently
    queueMicrotask(() => {
      try {
        fit?.fit();
        sendResize();
        term?.focus();
      } catch {
        /* ignore during teardown */
      }
    });
  });

  onMount(async () => {
    // B8/B20: Register cleanup synchronously, BEFORE the font-load await. onMount
    // is async, so if the tab is closed while `document.fonts.load(...)` is still
    // pending, the component's owner is disposed before we'd otherwise reach the
    // onCleanup at the end of the body — Solid only runs cleanups registered while
    // the owner is alive. By registering here (synchronously, while the owner is
    // still alive) and closing over the component-scoped refs, we guarantee that
    // whatever has been created so far gets torn down. `disposed` lets the
    // post-await body bail out so it doesn't create resources after teardown.
    let disposed = false;
    // Hoisted so the synchronous cleanup below can reference them without hitting
    // a temporal-dead-zone error if it runs during the await (they stay undefined).
    let renderSub: { dispose: () => void } | undefined;
    let cursorMoveSub: { dispose: () => void } | undefined;
    let dataListener: { dispose: () => void } | undefined;
    onCleanup(() => {
      disposed = true;
      clearTimeout(reconnectTimer);
      cancelAnimationFrame(resizeRafId);
      try { ro?.disconnect(); } catch {}
      try { dataListener?.dispose(); } catch {}
      try { renderSub?.dispose(); } catch {}
      try { cursorMoveSub?.dispose(); } catch {}
      try { cursorEl?.remove(); } catch {}
      if (downHandler) try { container.removeEventListener("mousedown", downHandler); } catch {}
      if (upHandler) try { container.removeEventListener("mouseup", upHandler); } catch {}
      try { ws?.close(); } catch {}
      try { term?.dispose(); } catch {}
    });

    // xterm.js measures font metrics at construction time. If Monaspace Xenon
    // hasn't loaded yet, the grid is sized for the fallback font and characters
    // drift out of their cells. Wait for the actual font to be ready.
    try {
      await document.fonts.load(`13px 'Monaspace Xenon'`);
    } catch { /* font load failed; we'll render with fallback */ }

    // B8/B20: If the tab was closed during the await above, the synchronous
    // onCleanup has already run — bail out so we don't open a WebSocket / Xterm
    // whose teardown would never fire.
    if (disposed) return;

    // Read CSS variables for terminal theme colors. The terminal renders on the
    // deep Bismuth terminal surface (--term-bg), falling back to the app bg, with
    // --term-fg (falling back to --fg) for default text — matching the host
    // container's .term-host styling so xterm's grid sits flush on it.
    const style = getComputedStyle(document.documentElement);
    const bg =
      style.getPropertyValue("--term-bg").trim() ||
      style.getPropertyValue("--bg").trim() ||
      "#08090e";
    const fg =
      style.getPropertyValue("--term-fg").trim() ||
      style.getPropertyValue("--fg").trim() ||
      "#cdd6f4";

    const pal = activePaletteInts();
    const ansi = buildAnsiPalette(pal, fg, bg);
    const extendedAnsi = cachedExtendedAnsi(pal);
    term = new Xterm({
      cursorBlink: false,
      fontFamily: "'Monaspace Xenon', 'FiraCode Nerd Font', 'Symbols Nerd Font', 'MesloLGS NF', 'JetBrainsMono Nerd Font', ui-monospace, 'Menlo', monospace",
      fontSize: settings.terminal.fontSize,
      lineHeight: settings.terminal.lineHeight,
      theme: {
        background: bg,
        foreground: fg,
        // xterm's native cursor: make the block totally invisible. cursorAccent is
        // the text color INSIDE the cursor cell — setting it to `fg` makes the
        // underlying character render in its normal color (not the cursor accent).
        // Our `.xterm-custom-cursor` overlay draws the actual cursor.
        cursor: "rgba(0,0,0,0)",
        cursorAccent: fg,
        selectionBackground: "rgba(125,125,125,0.3)",
        ...ansi,
        extendedAnsi,
      },
    });

    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    term.focus();

    // Cache the rows element once — avoids a querySelector on every render/cursorMove event.
    const rowsEl = container.querySelector(".xterm-rows") as HTMLElement | null;

    // Custom cursor overlay that glides smoothly between positions — xterm's native
    // cursor is a class transferred between inline spans, so CSS transitions don't
    // apply. We render our own absolutely-positioned div and animate transform.
    cursorEl = document.createElement("div");
    cursorEl.className = "xterm-custom-cursor";
    container.appendChild(cursorEl);

    const updateCursor = () => {
      if (!term || !cursorEl || !rowsEl) return;
      const cellW = rowsEl.clientWidth / term.cols;
      const cellH = rowsEl.clientHeight / term.rows;
      // The host container is padded (16px 18px) so the rows element no longer
      // shares the container's origin. Offset the overlay (anchored at the
      // container's top-left) by the rows element's position within it so the
      // cursor stays aligned with the text.
      const cRect = container.getBoundingClientRect();
      const rRect = rowsEl.getBoundingClientRect();
      const offsetX = rRect.left - cRect.left;
      const offsetY = rRect.top - cRect.top;
      // cursorX/Y are in cell units relative to the visible viewport.
      const x = offsetX + term.buffer.active.cursorX * cellW;
      const y = offsetY + term.buffer.active.cursorY * cellH;
      cursorEl.style.transform = `translate(${x}px, ${y}px)`;
      cursorEl.style.height = `${cellH}px`;
    };

    renderSub = term.onRender(() => updateCursor());
    cursorMoveSub = term.onCursorMove(() => updateCursor());
    updateCursor();

    // Fix 3: Click-to-position cursor on the current prompt line (Warp-style).
    // Track mousedown position so we only treat single-point clicks as cursor jumps,
    // not drag-to-select.
    let mdX = -1, mdY = -1;
    downHandler = (e: MouseEvent) => { mdX = e.clientX; mdY = e.clientY; };
    upHandler = (e: MouseEvent) => {
      if (Math.abs(e.clientX - mdX) > 3 || Math.abs(e.clientY - mdY) > 3) return; // dragged → ignore
      if (!ws || ws.readyState !== WebSocket.OPEN || !term || !rowsEl) return;
      const rect = rowsEl.getBoundingClientRect();
      const cellW = rect.width / term.cols;
      const cellH = rect.height / term.rows;
      const targetCol = Math.floor((e.clientX - rect.left) / cellW);
      const targetRow = Math.floor((e.clientY - rect.top) / cellH);
      // Only jump on the cursor's own row (the active prompt line).
      if (targetRow !== term.buffer.active.cursorY) return;
      const delta = targetCol - term.buffer.active.cursorX;
      if (delta === 0) return;
      const seq = (delta > 0 ? "\x1b[C" : "\x1b[D").repeat(Math.abs(delta));
      ws.send(stdinFrame(enc.encode(seq)));
    };
    container.addEventListener("mousedown", downHandler);
    container.addEventListener("mouseup", upHandler);

    // Wire up WebSocket to the backend PTY endpoint with exponential-backoff reconnection.
    // Each reconnection creates a fresh PTY shell (the backend's grace period expires before
    // the first retry fires), so reconnection starts a new session rather than resuming.
    const connectWs = () => {
      ws = new WebSocket(`${WS_BASE}/terminal?cols=${term!.cols}&rows=${term!.rows}`);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        reconnectAttempt = 0;
        sendResize();
      };

      // Backend → terminal: raw PTY output.
      ws.onmessage = (ev) => {
        term!.write(new Uint8Array(ev.data as ArrayBuffer));
      };

      ws.onclose = () => {
        if (disposed) return;
        try { term?.write("\r\n\x1b[2m[reconnecting…]\x1b[0m\r\n"); } catch {}
        const delay = Math.min(500 * 2 ** reconnectAttempt, 8000);
        reconnectAttempt++;
        reconnectTimer = setTimeout(() => {
          if (disposed) return;
          // Re-wire dataListener to the new socket.
          dataListener?.dispose();
          connectWs();
          dataListener = term!.onData((s) => {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(stdinFrame(enc.encode(s)));
          });
        }, delay);
      };

      ws.onerror = () => {
        try { term?.write("\r\n\x1b[31m[backend unavailable]\x1b[0m\r\n"); } catch {}
      };
    };

    connectWs();

    // Terminal → backend: stdin frames prefixed with 0x00.
    // Fix 3: use module-scoped `enc` instead of allocating per keystroke.
    dataListener = term.onData((s) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(stdinFrame(enc.encode(s)));
    });

    // Observe container size changes and refit the terminal.
    // rAF-debounced: collapses the burst of callbacks during a divider drag into one
    // fit()+sendResize() per frame. Also guards against zero-size (display:none).
    ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        try {
          fit?.fit();
          sendResize();
        } catch {
          /* ignore during teardown */
        }
      });
    });
    ro.observe(container);

    // B8/B20: All teardown is handled by the synchronous onCleanup registered at
    // the top of onMount (before the font-load await), closing over the
    // component-scoped refs. That guarantees cleanup runs even if the tab is closed
    // while the font is still loading.
  });

  // Render a single container div. The parent controls visibility via display:none;
  // this component is mounted once and stays mounted for the tab's lifetime.
  return <div ref={container!} class="term-host" />;
}
