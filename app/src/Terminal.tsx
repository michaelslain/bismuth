// app/src/Terminal.tsx
// Mounts an xterm.js terminal and connects it to the backend WebSocket PTY.
import { onMount, onCleanup, createEffect } from "solid-js";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";
import { settings } from "./settings";

// Derive the WebSocket base URL from the same env var that the HTTP api.ts uses,
// so that VITE_API_BASE overrides work for ws:// too.
const HTTP_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4321";
const WS_BASE = HTTP_BASE.replace(/^http/, "ws"); // http→ws, https→wss

// Fix 3: Hoist TextEncoder to module scope — avoids a per-keystroke allocation.
const enc = new TextEncoder();

export function TerminalTab(props: { id: string; active: () => boolean }) {
  let container!: HTMLDivElement;
  // Fix 1: Declare mutable refs at component scope so the top-level createEffect
  // can close over them without being nested inside onMount.
  let fit: FitAddon | undefined;
  let ws: WebSocket | undefined;
  let term: Xterm | undefined;

  const sendResize = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !term) return;
    const frame = new Uint8Array(5);
    const view = new DataView(frame.buffer);
    frame[0] = 0x01;
    view.setUint16(1, term.cols, true);
    view.setUint16(3, term.rows, true);
    ws.send(frame);
  };

  // Fix 1: createEffect at component top level — properly owned by the component's
  // reactive context and auto-disposed on cleanup. Inside onMount it would be
  // unowned and never collected.
  createEffect(() => {
    if (props.active()) {
      queueMicrotask(() => {
        try {
          fit?.fit();
          sendResize();
          term?.focus();
        } catch {
          /* ignore during teardown */
        }
      });
    }
  });

  onMount(async () => {
    // xterm.js measures font metrics at construction time. If Monaspace Xenon
    // hasn't loaded yet, the grid is sized for the fallback font and characters
    // drift out of their cells. Wait for the actual font to be ready.
    try {
      await document.fonts.load(`13px 'Monaspace Xenon'`);
    } catch { /* font load failed; we'll render with fallback */ }

    // Read CSS variables for terminal theme colors.
    const style = getComputedStyle(document.documentElement);
    const bg = style.getPropertyValue("--bg").trim() || "#1e1e2e";
    const fg = style.getPropertyValue("--fg").trim() || "#cdd6f4";

    term = new Xterm({
      cursorBlink: false,
      fontFamily: "'Monaspace Xenon', 'FiraCode Nerd Font', 'Symbols Nerd Font', 'MesloLGS NF', 'JetBrainsMono Nerd Font', ui-monospace, 'Menlo', monospace",
      fontSize: 13,
      theme: {
        background: bg,
        foreground: fg,
        cursor: fg, // match the editor's caretColor (var(--fg))
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
    const cursorEl = document.createElement("div");
    cursorEl.className = "xterm-custom-cursor";
    container.appendChild(cursorEl);

    const updateCursor = () => {
      if (!term) return;
      const rowsEl = container.querySelector(".xterm-rows") as HTMLElement | null;
      if (!rowsEl) return;
      const cellW = rowsEl.clientWidth / term.cols;
      const cellH = rowsEl.clientHeight / term.rows;
      // cursorX/Y are in cell units relative to the visible viewport.
      const x = term.buffer.active.cursorX * cellW;
      const y = term.buffer.active.cursorY * cellH;
      cursorEl.style.transform = `translate(${x}px, ${y}px)`;
      cursorEl.style.height = `${cellH}px`;
    };

    const renderSub = term.onRender(() => updateCursor());
    const cursorMoveSub = term.onCursorMove(() => updateCursor());
    updateCursor();

    // Fix 3: Click-to-position cursor on the current prompt line (Warp-style).
    // Track mousedown position so we only treat single-point clicks as cursor jumps,
    // not drag-to-select.
    let mdX = -1, mdY = -1;
    const downHandler = (e: MouseEvent) => { mdX = e.clientX; mdY = e.clientY; };
    const upHandler = (e: MouseEvent) => {
      if (Math.abs(e.clientX - mdX) > 3 || Math.abs(e.clientY - mdY) > 3) return; // dragged → ignore
      if (!ws || ws.readyState !== WebSocket.OPEN || !term) return;
      const rowsEl = container.querySelector(".xterm-rows") as HTMLElement | null;
      if (!rowsEl) return;
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
      const bytes = enc.encode(seq);
      const frame = new Uint8Array(1 + bytes.length);
      frame[0] = 0x00;
      frame.set(bytes, 1);
      ws.send(frame);
    };
    container.addEventListener("mousedown", downHandler);
    container.addEventListener("mouseup", upHandler);

    // Open WebSocket to backend PTY endpoint.
    ws = new WebSocket(
      `${WS_BASE}/terminal?cols=${term.cols}&rows=${term.rows}`
    );
    ws.binaryType = "arraybuffer";

    // Backend → terminal: raw PTY output.
    ws.onmessage = (ev) => {
      term!.write(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = () => {
      try { term?.write("\r\n\x1b[2m[connection closed]\x1b[0m\r\n"); } catch {}
    };
    ws.onerror = () => {
      try { term?.write("\r\n\x1b[31m[backend unavailable]\x1b[0m\r\n"); } catch {}
    };

    // Terminal → backend: stdin frames prefixed with 0x00.
    // Fix 3: use module-scoped `enc` instead of allocating per keystroke.
    const dataListener = term.onData((s) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const encoded = enc.encode(s);
      const frame = new Uint8Array(1 + encoded.length);
      frame[0] = 0x00;
      frame.set(encoded, 1);
      ws.send(frame);
    });

    // Observe container size changes and refit the terminal.
    // Fix 2: guard against zero-size rect (fired when container is display:none)
    // to avoid propagating degenerate dimensions to the PTY.
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      try {
        fit?.fit();
        sendResize();
      } catch {
        /* ignore during teardown */
      }
    });
    ro.observe(container);

    onCleanup(() => {
      ro.disconnect();
      dataListener.dispose();
      renderSub.dispose();
      cursorMoveSub.dispose();
      try { cursorEl.remove(); } catch {}
      container.removeEventListener("mousedown", downHandler);
      container.removeEventListener("mouseup", upHandler);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      term?.dispose();
    });
  });

  // Render a single container div. The parent controls visibility via display:none;
  // this component is mounted once and stays mounted for the tab's lifetime.
  return <div ref={container!} style={{ width: "100%", height: "100%", position: "relative" }} />;
}
