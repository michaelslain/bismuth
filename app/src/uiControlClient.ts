// app/src/uiControlClient.ts
// Client half of the core→frontend control channel (core/src/uiControl.ts). Opens a per-window
// WebSocket to /ui, answers inbound {type:"command"} frames by calling App-supplied handlers, and
// heartbeats a tab snapshot (piggybacked on App's existing tab-persistence effect) so
// GET /ui/windows can list this window. Reconnects on drop, serverVersion.ts-style.
//
// This is the browser end of `bismuth app …` / MCP app control. It enforces the same guards as the
// server (defense in depth): opening a `::chat:` tab is refused, and a blocklisted run-command id is
// refused — a live recursive Agent-SDK chat is a deliberately different trust boundary.
import { apiBase } from "./api";
import { UI_CONTROL_BLOCKLIST } from "../../core/src/commands";
import { CHAT_PREFIX } from "./tabIds";
import type { UiTabsSnapshot } from "../../core/src/uiControl";

export type { UiTabsSnapshot };

/** The App-side handlers each control action maps to. Every handler is synchronous + returns a
 *  small result object; a thrown error is caught and reported as `{ok:false}`. */
export interface UiControlHandlers {
  listTabs(): UiTabsSnapshot;
  openTab(args: { content: string; newTab?: boolean }): { ok: boolean; error?: string; opened?: string };
  closeTab(args: { tabId: string }): { ok: boolean; error?: string };
  focusTab(args: { tabId: string }): { ok: boolean; error?: string };
  runCommand(args: { id: string }): { ok: boolean; error?: string };
}

export interface UiControlHandle {
  /** Push the latest tab snapshot (the heartbeat — App calls this from its tab-persistence effect). */
  heartbeat(snapshot: UiTabsSnapshot): void;
  /** Tear the socket down (component cleanup). Suppresses reconnect. */
  disconnect(): void;
}

function wsUrl(windowId: string): string {
  const base = apiBase().replace(/^http/, "ws");
  return `${base}/ui?w=${encodeURIComponent(windowId)}`;
}

const RECONNECT_MS = 2000;

export function connectUiControl(windowId: string, handlers: UiControlHandlers): UiControlHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSnapshot: UiTabsSnapshot | null = null;

  const send = (frame: unknown): void => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        /* socket died mid-send */
      }
    }
  };

  const dispatch = (action: string, args: Record<string, unknown> | undefined): { ok: boolean; result?: unknown; error?: string } => {
    try {
      switch (action) {
        case "list-tabs":
          return { ok: true, result: handlers.listTabs() };
        case "open-tab": {
          const content = args?.content;
          if (typeof content !== "string" || !content) return { ok: false, error: "open-tab requires a content id" };
          if (content.startsWith(CHAT_PREFIX)) return { ok: false, error: "opening chat tabs via app control is disabled" };
          return handlers.openTab({ content, newTab: args?.newTab === true });
        }
        case "close-tab": {
          const tabId = args?.tabId;
          if (typeof tabId !== "string" || !tabId) return { ok: false, error: "close-tab requires a tabId" };
          return handlers.closeTab({ tabId });
        }
        case "focus-tab": {
          const tabId = args?.tabId;
          if (typeof tabId !== "string" || !tabId) return { ok: false, error: "focus-tab requires a tabId" };
          return handlers.focusTab({ tabId });
        }
        case "run-command": {
          const id = args?.id;
          if (typeof id !== "string" || !id) return { ok: false, error: "run-command requires an id" };
          if (UI_CONTROL_BLOCKLIST.includes(id)) return { ok: false, error: `command "${id}" is not allowed via app control` };
          return handlers.runCommand({ id });
        }
        default:
          return { ok: false, error: `unknown action: ${action}` };
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  };

  const scheduleReconnect = (): void => {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      open();
    }, RECONNECT_MS);
  };

  const open = (): void => {
    if (closed) return;
    try {
      ws = new WebSocket(wsUrl(windowId));
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      // A reconnect: re-seed the heartbeat so /ui/windows re-lists this window immediately.
      if (lastSnapshot) send({ type: "tabs", snapshot: lastSnapshot });
    };
    ws.onmessage = (e) => {
      let msg: { type?: string; reqId?: string; action?: string; args?: Record<string, unknown> };
      try {
        msg = JSON.parse(typeof e.data === "string" ? e.data : "");
      } catch {
        return;
      }
      if (!msg || msg.type !== "command" || typeof msg.reqId !== "string" || typeof msg.action !== "string") return;
      const reply = dispatch(msg.action, msg.args);
      send({ type: "reply", reqId: msg.reqId, ok: reply.ok, result: reply.result, error: reply.error });
    };
    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        /* */
      }
    };
  };

  open();

  return {
    heartbeat(snapshot) {
      lastSnapshot = snapshot;
      send({ type: "tabs", snapshot });
    },
    disconnect() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close(1000);
      } catch {
        /* */
      }
      ws = null;
    },
  };
}
