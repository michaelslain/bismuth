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
import { api, apiBase } from "./api";
import type { NativeDragDetail } from "./nativeDrop";

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

// Derive the WebSocket base from the SAME runtime-resolved backend api.ts uses.
// apiBase() honors ?api= > window.__BISMUTH_API__ > VITE_API_BASE > :4321, so the bundled
// app's free-port sidecar (injected as __BISMUTH_API__) is reached too — not just :4321.
// Computed at connect time, since __BISMUTH_API__/?api= are only known at runtime.
const wsBase = () => apiBase().replace(/^http/, "ws"); // http→ws, https→wss

// Fix 3: Hoist TextEncoder to module scope — avoids a per-keystroke allocation.
const enc = new TextEncoder();

// --- Drag-and-drop file paths into the terminal -----------------------------------
// The absolute vault path is the terminal's cwd; we fetch it once (cached across all
// terminal tabs) to turn a file dragged from the tree (a vault-relative path) into an
// absolute path to insert at the prompt.
let _vaultRoot: Promise<string> | undefined;
function vaultRoot(): Promise<string> {
  if (!_vaultRoot) _vaultRoot = api.terminalInfo().then((i) => i.vault).catch(() => "");
  return _vaultRoot;
}

// POSIX shell-quote a path: paths made only of safe characters paste as-is (readable);
// anything with a space/special is single-quoted (embedded quotes escaped) so it stays
// a single shell argument.
function shellQuote(p: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(p)) return p;
  return "'" + p.replace(/'/g, "'\\''") + "'";
}

// Vault-relative destination for an attachment dropped onto the terminal, honoring
// settings.attachments.folder (mirrors Editor.tsx's attachmentTarget, minus the "."
// = current-note case — the terminal has no note context). Leading/trailing slashes
// are stripped so a stray `folder: /attachments` still lands vault-relative.
function terminalAttachmentTarget(fileName: string): string {
  const folder = (settings.attachments?.folder ?? "attachments").trim().replace(/^\/+|\/+$/g, "");
  return folder ? `${folder}/${fileName}` : fileName;
}

// Upload an OS/browser-dropped File's bytes into the vault attachment folder and return
// its ABSOLUTE path (the terminal's cwd is the vault root, so we prefix the returned
// vault-relative path with it). dataTransfer File objects expose only a basename — never
// a real filesystem path — so the only way to hand Claude Code a usable path is to
// materialize the bytes inside the vault first. Returns "" on failure so the caller skips it.
async function uploadDroppedFile(file: File): Promise<string> {
  try {
    const bytes = await file.arrayBuffer();
    const rel = await api.uploadAsset(terminalAttachmentTarget(file.name), bytes);
    const root = (await vaultRoot()).replace(/\/+$/, "");
    return root ? `${root}/${rel}` : rel;
  } catch {
    return "";
  }
}

// True if a drag carries something we can turn into a path. Read from `types` (the only
// dataTransfer field readable during dragover; getData is blocked there).
function dragHasPath(e: DragEvent): boolean {
  const t = e.dataTransfer?.types;
  return !!t && (t.includes("application/x-bismuth-path") || t.includes("Files") || t.includes("text/uri-list"));
}

// Extract droppable paths. Reads dataTransfer SYNCHRONOUSLY (valid only during the event)
// before any await — including snapshotting `dt.files` into a real array up front, since the
// FileList is detached the moment the event handler returns and the first `await` below would
// otherwise read it too late. Sources, in priority order: an in-app tree drag (vault-relative →
// absolute), OS file: URIs, then a browser/OS file drop (B20: upload the bytes into the vault
// and use the absolute path, since the File object exposes only a basename, not a real path).
async function pathsFromDrop(e: DragEvent): Promise<string[]> {
  const dt = e.dataTransfer;
  if (!dt) return [];
  // Snapshot the FileList synchronously, before any await invalidates dataTransfer.
  const files = dt.files ? [...dt.files] : [];
  const rel = dt.getData("application/x-bismuth-path");
  if (rel) {
    const root = (await vaultRoot()).replace(/\/+$/, "");
    return [root ? `${root}/${rel}` : rel];
  }
  const uriList = dt.getData("text/uri-list");
  if (uriList) {
    const paths = uriList
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.startsWith("file:"))
      .map((u) => { try { return decodeURIComponent(new URL(u).pathname); } catch { return ""; } })
      .filter(Boolean);
    if (paths.length) return paths;
  }
  // OS/browser file drop: the File exposes no real filesystem path, so upload each one's
  // bytes into the vault and hand back the absolute path it landed at.
  if (files.length) {
    const uploaded = await Promise.all(files.map(uploadDroppedFile));
    return uploaded.filter(Boolean);
  }
  return [];
}

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

export function TerminalTab(props: { id: string; active: () => boolean; onExit?: () => void }) {
  let container!: HTMLDivElement;
  // Fix 1: Declare mutable refs at component scope so the top-level createEffect
  // can close over them without being nested inside onMount.
  let fit: FitAddon | undefined;
  let ws: WebSocket | undefined;
  let term: Xterm | undefined;
  // Timestamp (performance.now) of the most recent successful ws open — used to tell
  // a real "shell exited after use" (close the tab) from a shell that died instantly
  // on spawn (keep the tab so the startup error stays readable).
  let lastOpenAt = 0;
  // B8/B20: Hoist the remaining post-await resources to component scope so the
  // synchronous onCleanup (registered before the font-load await) can tear them
  // down even if the tab is closed mid-await.
  let ro: ResizeObserver | undefined;
  let cursorEl: HTMLDivElement | undefined;
  let downHandler: ((e: MouseEvent) => void) | undefined;
  let upHandler: ((e: MouseEvent) => void) | undefined;
  // Drag-and-drop file handlers (added in onMount, removed on cleanup).
  let dragOverHandler: ((e: DragEvent) => void) | undefined;
  let dragLeaveHandler: ((e: DragEvent) => void) | undefined;
  let dropHandler: ((e: DragEvent) => void) | undefined;
  // Tauri native OS-file drop (window-level event; removed on cleanup).
  let nativeDragHandler: ((e: Event) => void) | undefined;
  // Reconnection state — exponential backoff, cleared on successful open.
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  // rAF handle for debounced resize — collapses bursts during divider drag.
  let resizeRafId = 0;
  // Whether the viewport is "following" the bottom of the output. True while the
  // terminal is pinned to the latest line; flips to false only when the user
  // deliberately scrolls up into the scrollback (and back to true when they return
  // to the bottom). We use it to keep the viewport pinned on new output even while
  // the tab is hidden (display:none) — xterm suspends its own auto-scroll then, so a
  // terminal you leave running on another tab would otherwise be stuck at a stale
  // scroll position when you come back.
  let following = true;

  // Cached cursor-overlay geometry. The custom cursor div is repositioned on every
  // xterm render (onRender fires per output frame), so reading layout there forced a
  // synchronous reflow each frame — with several terminals streaming at once (e.g.
  // animating Claude TUIs) that thrashed layout and made the whole app sluggish. The
  // cell size + rows-element offset only change on resize, so compute them once per
  // fit/resize and have updateCursor read these cached values (no layout reads).
  let cellW = 0, cellH = 0, rowOffX = 0, rowOffY = 0;
  // Cache the rows element to avoid a querySelector per render; re-query lazily if
  // xterm swaps it out (reflow / addon reset) so the cursor keeps tracking the grid.
  let rowsEl: HTMLElement | null = null;
  const getRowsEl = (): HTMLElement | null => {
    if (!rowsEl || !rowsEl.isConnected) rowsEl = container?.querySelector(".xterm-rows") as HTMLElement | null;
    return rowsEl;
  };
  // Recompute the cached geometry from the live grid. Called only on fit/resize/focus,
  // NOT per render. This is the only place that reads layout for the cursor overlay.
  const recomputeCursorMetrics = (): void => {
    const rows = getRowsEl();
    if (!term || !rows || !container) return;
    const cRect = container.getBoundingClientRect();
    const rRect = rows.getBoundingClientRect();
    rowOffX = rRect.left - cRect.left;
    rowOffY = rRect.top - cRect.top;
    if (term.cols > 0) cellW = rRect.width / term.cols;
    if (term.rows > 0) cellH = rRect.height / term.rows;
  };

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
        recomputeCursorMetrics();
        // Re-show: if the user was following the bottom, snap to the latest output
        // that streamed in while the tab was hidden (xterm's viewport refresh was
        // suspended under display:none, so the scroll position can be stale).
        if (following) term?.scrollToBottom();
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
    let scrollSub: { dispose: () => void } | undefined;
    let dataListener: { dispose: () => void } | undefined;
    onCleanup(() => {
      disposed = true;
      clearTimeout(reconnectTimer);
      cancelAnimationFrame(resizeRafId);
      try { ro?.disconnect(); } catch {}
      try { dataListener?.dispose(); } catch {}
      try { renderSub?.dispose(); } catch {}
      try { cursorMoveSub?.dispose(); } catch {}
      try { scrollSub?.dispose(); } catch {}
      try { cursorEl?.remove(); } catch {}
      if (downHandler) try { container.removeEventListener("mousedown", downHandler); } catch {}
      if (upHandler) try { container.removeEventListener("mouseup", upHandler); } catch {}
      if (dragOverHandler) try { container.removeEventListener("dragover", dragOverHandler); } catch {}
      if (dragLeaveHandler) try { container.removeEventListener("dragleave", dragLeaveHandler); } catch {}
      if (dropHandler) try { container.removeEventListener("drop", dropHandler); } catch {}
      if (nativeDragHandler) try { window.removeEventListener("bismuth-native-drag", nativeDragHandler); } catch {}
      // Close with code 1000 so the backend treats this as an intentional teardown
      // and kills the PTY immediately (vs. keeping it alive for reattach on a drop).
      try { ws?.close(1000, "dispose"); } catch {}
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
      "#C7CCE0"; // exact --term-fg token value (App.css); this last-resort fallback is reachable-never

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

    // Custom cursor overlay that glides smoothly between positions — xterm's native
    // cursor is a class transferred between inline spans, so CSS transitions don't
    // apply. We render our own absolutely-positioned div and animate transform.
    cursorEl = document.createElement("div");
    cursorEl.className = "xterm-custom-cursor";
    container.appendChild(cursorEl);

    // Reposition the cursor overlay. Runs on EVERY xterm render, so it must do NO
    // layout reads — cellW/cellH and the rows-element offset come from the cached
    // metrics (recomputed only on fit/resize). Only buffer coordinates (cheap, no
    // reflow) and style writes happen here.
    const updateCursor = () => {
      if (!term || !cursorEl) return;
      // Hide the overlay while the user is scrolled up into the scrollback — the real
      // cursor sits on the (now off-screen) prompt line, so a floating block would be
      // misleading. onRender fires on scroll, so this toggles promptly.
      const buf = term.buffer.active;
      if (buf.viewportY !== buf.baseY) { cursorEl.style.opacity = "0"; return; }
      cursorEl.style.opacity = "";
      // First paint (or after an xterm reflow that left the metrics at 0): measure once.
      if (cellH === 0) recomputeCursorMetrics();
      // cursorX/Y are in cell units relative to the visible viewport; offset by the
      // padded rows element's position within the container.
      const x = rowOffX + buf.cursorX * cellW;
      const y = rowOffY + buf.cursorY * cellH;
      cursorEl.style.transform = `translate(${x}px, ${y}px)`;
      cursorEl.style.height = `${cellH}px`;
    };

    recomputeCursorMetrics();
    renderSub = term.onRender(() => updateCursor());
    cursorMoveSub = term.onCursorMove(() => updateCursor());
    // Track whether we're pinned to the bottom. The user scrolling up into the
    // scrollback flips `following` off (so we stop yanking them down on new output);
    // scrolling back to the latest line flips it on. Programmatic scrollToBottom
    // keeps viewportY === baseY, so it leaves `following` true.
    scrollSub = term.onScroll(() => {
      const b = term!.buffer.active;
      following = b.viewportY >= b.baseY;
    });
    updateCursor();

    // Fix 3: Click-to-position cursor on the current prompt line (Warp-style).
    // Track mousedown position so we only treat single-point clicks as cursor jumps,
    // not drag-to-select.
    let mdX = -1, mdY = -1;
    downHandler = (e: MouseEvent) => { mdX = e.clientX; mdY = e.clientY; };
    upHandler = (e: MouseEvent) => {
      if (Math.abs(e.clientX - mdX) > 3 || Math.abs(e.clientY - mdY) > 3) return; // dragged → ignore
      const rows = getRowsEl();
      if (!ws || ws.readyState !== WebSocket.OPEN || !term || !rows) return;
      // Only do click-to-position on the NORMAL screen buffer (a shell prompt). In a
      // full-screen TUI (vim, htop, less, the Claude TUI) the app owns the alternate
      // buffer and interprets arrow keys itself — synthesizing \x1b[C/\x1b[D there would
      // scrub through history, move a vim cursor, etc. Bail so clicks stay harmless.
      if (term.buffer.active.type !== "normal") return;
      const rect = rows.getBoundingClientRect();
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

    // Drag a file (from the file tree, or the OS) onto the terminal → insert its path at
    // the prompt. stopPropagation so the host pane doesn't also treat it as a drop-to-split.
    dragOverHandler = (e: DragEvent) => {
      if (!dragHasPath(e)) return;
      e.preventDefault(); // allow the drop
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      container.classList.add("term-drop-active");
    };
    dragLeaveHandler = (e: DragEvent) => {
      // Ignore leaves into a child element — only clear when the cursor exits the host.
      if (e.relatedTarget && container.contains(e.relatedTarget as Node)) return;
      container.classList.remove("term-drop-active");
    };
    dropHandler = (e: DragEvent) => {
      if (!dragHasPath(e)) return;
      e.preventDefault();
      e.stopPropagation();
      container.classList.remove("term-drop-active");
      void pathsFromDrop(e).then((paths) => {
        if (!paths.length || !ws || ws.readyState !== WebSocket.OPEN) return;
        // Trailing space so the next path/arg (or a command typed after) stays separated.
        ws.send(stdinFrame(enc.encode(paths.map(shellQuote).join(" ") + " ")));
        term?.focus();
      });
    };
    container.addEventListener("dragover", dragOverHandler);
    container.addEventListener("dragleave", dragLeaveHandler);
    container.addEventListener("drop", dropHandler);

    // Tauri native OS file drop: nativeDrop.ts forwards real absolute paths + cursor position as a
    // window-level `bismuth-native-drag` event (the HTML5 drop above only sees a basename under
    // Tauri). Insert the real path(s) at the prompt — like a native terminal — when the cursor is
    // over THIS terminal. No-op in the browser (the event never fires there). Coexists with the
    // HTML5 handlers, which still serve the browser build and internal file-tree drags.
    nativeDragHandler = (e: Event) => {
      const d = (e as CustomEvent<NativeDragDetail>).detail;
      if (!d) return;
      const r = container.getBoundingClientRect();
      // A hidden (display:none) terminal tab has a 0×0 rect at (0,0); the `width||height` guard
      // keeps a drop forwarded at the viewport corner (0,0) from writing to every backgrounded PTY.
      const inside =
        (r.width !== 0 || r.height !== 0) &&
        d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom;
      if (d.type === "drop") {
        container.classList.remove("term-drop-active");
        if (!inside || d.paths.length === 0 || !ws || ws.readyState !== WebSocket.OPEN) return;
        // Trailing space so the next path/arg (or a command typed after) stays separated.
        ws.send(stdinFrame(enc.encode(d.paths.map(shellQuote).join(" ") + " ")));
        term?.focus();
      } else if (d.type === "leave") {
        container.classList.remove("term-drop-active");
      } else {
        // enter / over: show the drop affordance only while the cursor is over this terminal.
        container.classList.toggle("term-drop-active", inside);
      }
    };
    window.addEventListener("bismuth-native-drag", nativeDragHandler);

    // Wire up the WebSocket to the backend PTY. We pass our stable term id so that on
    // an ABNORMAL close (reload / network drop) the reconnect REATTACHES to the same
    // live shell instead of spawning a fresh one — the backend keeps the PTY alive for
    // a grace window keyed by this id. A CLEAN close (code 1000) means the shell process
    // exited (the user typed `exit`, Claude quit, etc.): we do NOT reconnect — we close
    // the tab, so a terminal you exit actually goes away instead of respawning.
    const termIdParam = encodeURIComponent(props.id);
    const connectWs = () => {
      ws = new WebSocket(`${wsBase()}/terminal?cols=${term!.cols}&rows=${term!.rows}&termId=${termIdParam}`);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        reconnectAttempt = 0;
        lastOpenAt = performance.now();
        sendResize();
      };

      // Backend → terminal: raw PTY output, COALESCED to one term.write() per animation frame.
      // A burst (build output, `ls -R`, an animating TUI) arrives as rapid-fire small WS frames;
      // writing each individually queues a per-frame parse in xterm's WriteBuffer whose
      // setTimeout-chained drain monopolizes the timer queue — the "terminal laggy, then fine"
      // backlog. Byte-concatenating frames is stream-identical for a PTY byte stream, and one
      // write per frame lets xterm time-slice cleanly. rAF is paused while the WINDOW is hidden
      // (an inactive in-app tab is display:none — document stays visible, rAF still fires), so
      // a timeout fallback + a byte cap keep a background window's queue bounded and flushing.
      // After the flush parses, re-pin to the bottom if we're following — keeps the viewport
      // tracking new output even while the tab is hidden, where xterm's auto-scroll is
      // suspended. A no-op when already at the bottom.
      let pending: Uint8Array[] = [];
      let pendingBytes = 0;
      let flushScheduled = false;
      let flushFallback: ReturnType<typeof setTimeout> | undefined;
      const FLUSH_MAX_BYTES = 512 * 1024; // cap the queue: force a flush mid-burst
      const flushWrites = () => {
        flushScheduled = false;
        clearTimeout(flushFallback);
        flushFallback = undefined;
        if (disposed || !pending.length || !term) return; // a flush can land after unmount
        let data: Uint8Array;
        if (pending.length === 1) {
          data = pending[0];
        } else {
          data = new Uint8Array(pendingBytes);
          let off = 0;
          for (const c of pending) { data.set(c, off); off += c.length; }
        }
        pending = [];
        pendingBytes = 0;
        term.write(data, () => {
          if (following) term?.scrollToBottom();
        });
      };
      ws.onmessage = (ev) => {
        pending.push(new Uint8Array(ev.data as ArrayBuffer));
        pendingBytes += (ev.data as ArrayBuffer).byteLength;
        if (pendingBytes >= FLUSH_MAX_BYTES) { flushWrites(); return; }
        if (flushScheduled) return;
        flushScheduled = true;
        requestAnimationFrame(flushWrites);
        // rAF never fires while the window is hidden — keep a running terminal draining there.
        flushFallback = setTimeout(flushWrites, 50);
      };

      ws.onclose = (ev) => {
        if (disposed) return;
        // Clean exit (code 1000): the shell process ended. Don't respawn.
        if (ev.code === 1000) {
          // If the shell died almost immediately after connecting, it likely failed to
          // start (bad shell/rc) — keep the tab so the error stays visible. Otherwise
          // the user deliberately exited a working shell: close the tab.
          const livedMs = lastOpenAt ? performance.now() - lastOpenAt : Infinity;
          if (livedMs < 750) {
            try { term?.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n"); } catch {}
          } else {
            props.onExit?.();
          }
          return;
        }
        // Abnormal close: connection dropped but the shell may still be alive on the
        // backend. Reconnect with exponential backoff; the reattach restores it.
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
          recomputeCursorMetrics();
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
