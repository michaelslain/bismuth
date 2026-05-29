// app/src/Terminal.tsx
// Mounts an xterm.js terminal and connects it to the backend WebSocket PTY.
import { onMount, onCleanup, createEffect } from "solid-js";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
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

  onMount(() => {
    // Read CSS variables for terminal theme colors.
    const style = getComputedStyle(document.documentElement);
    const bg = style.getPropertyValue("--bg").trim() || "#1e1e2e";
    const fg = style.getPropertyValue("--fg").trim() || "#cdd6f4";
    const accent = style.getPropertyValue("--accent").trim() || "#6496ff";

    term = new Xterm({
      fontFamily: "'Monaspace Xenon', ui-monospace, 'Cascadia Code', 'Menlo', monospace",
      fontSize: settings.appearance.editorFontSize ?? 14,
      theme: {
        background: bg,
        foreground: fg,
        cursor: accent,
      },
      cursorBlink: true,
    });

    fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    term.focus();

    // Open WebSocket to backend PTY endpoint.
    ws = new WebSocket(
      `${WS_BASE}/terminal?cols=${term.cols}&rows=${term.rows}`
    );
    ws.binaryType = "arraybuffer";

    // Backend → terminal: raw PTY output.
    ws.onmessage = (ev) => {
      term!.write(new Uint8Array(ev.data as ArrayBuffer));
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
  return <div ref={container!} style="width:100%; height:100%" />;
}
