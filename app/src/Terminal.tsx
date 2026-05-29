// app/src/Terminal.tsx
// Mounts an xterm.js terminal and connects it to the backend WebSocket PTY.
import { onMount, onCleanup, createEffect } from "solid-js";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { settings, FONT_STACKS } from "./settings";

// Derive the WebSocket base URL from the same env var that the HTTP api.ts uses,
// so that VITE_API_BASE overrides work for ws:// too.
const HTTP_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4321";
const WS_BASE = HTTP_BASE.replace(/^http/, "ws"); // http→ws, https→wss

export function TerminalTab(props: { id: string; active: () => boolean }) {
  let container!: HTMLDivElement;

  onMount(() => {
    // Read CSS variables for terminal theme colors.
    const style = getComputedStyle(document.documentElement);
    const bg = style.getPropertyValue("--bg").trim() || "#1e1e2e";
    const fg = style.getPropertyValue("--fg").trim() || "#cdd6f4";
    const accent = style.getPropertyValue("--accent").trim() || "#6496ff";

    const term = new Xterm({
      fontFamily: FONT_STACKS[settings.appearance.editorFont] ?? "monospace",
      fontSize: settings.appearance.editorFontSize ?? 14,
      theme: {
        background: bg,
        foreground: fg,
        cursor: accent,
      },
      cursorBlink: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    // Open WebSocket to backend PTY endpoint.
    const ws = new WebSocket(
      `${WS_BASE}/terminal?cols=${term.cols}&rows=${term.rows}`
    );
    ws.binaryType = "arraybuffer";

    // Backend → terminal: raw PTY output.
    ws.onmessage = (ev) => {
      term.write(new Uint8Array(ev.data as ArrayBuffer));
    };

    // Terminal → backend: stdin frames prefixed with 0x00.
    const dataListener = term.onData((s) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const encoded = new TextEncoder().encode(s);
      const frame = new Uint8Array(1 + encoded.length);
      frame[0] = 0x00;
      frame.set(encoded, 1);
      ws.send(frame);
    });

    // Send a resize frame: 0x01 prefix + cols (uint16 LE) + rows (uint16 LE).
    const sendResize = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const frame = new Uint8Array(5);
      const view = new DataView(frame.buffer);
      frame[0] = 0x01;
      view.setUint16(1, term.cols, true);
      view.setUint16(3, term.rows, true);
      ws.send(frame);
    };

    // Observe container size changes and refit the terminal.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        sendResize();
      } catch {
        /* ignore during teardown */
      }
    });
    ro.observe(container);

    // When the tab becomes active (unhidden), refit so xterm picks up the real
    // dimensions — the container was display:none while the tab was inactive.
    createEffect(() => {
      if (props.active()) {
        queueMicrotask(() => {
          try {
            fit.fit();
            sendResize();
          } catch {
            /* ignore during teardown */
          }
        });
      }
    });

    onCleanup(() => {
      ro.disconnect();
      dataListener.dispose();
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      term.dispose();
    });
  });

  // Render a single container div. The parent controls visibility via display:none;
  // this component is mounted once and stays mounted for the tab's lifetime.
  return <div ref={container!} style="width:100%; height:100%" />;
}
