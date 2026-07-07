// app/src/nativeDrop.ts
// Bridges Tauri v2's NATIVE OS file drag-drop into a DOM CustomEvent the surfaces can hit-test.
//
// Why this exists: a browser `drop` DataTransfer only exposes a file's BASENAME, never its real
// on-disk path (browser security). Tauri's native drag-drop handler is the only source of real
// absolute paths — but it's a window-level all-or-nothing handler that, when enabled (lib.rs no
// longer calls `.disable_drag_drop_handler()`), SUPPRESSES the webview's HTML5 `drop` event for
// EXTERNAL OS files. Internal HTML5 drags (file-tree / pane / block reorder via the custom
// `application/x-bismuth-path` MIME) never produce an OS file drop, so they keep working untouched.
//
// We forward every native drag event as a `bismuth-native-drag` CustomEvent carrying the dropped
// paths + the cursor position in CSS client pixels. Each surface (Terminal, Editor) listens and
// handles the drop only when the cursor is over its own element — so the terminal inserts the real
// path at the prompt, and the editor copies+embeds the real file, without round-tripping bytes
// through the vault. In a plain browser build (no Tauri) this is a no-op and the existing HTML5
// drop handlers remain the path.

import { isTauri } from "./nativeMenu";

/** A forwarded native drag event. `x`/`y` are CSS client pixels (already divided by DPR), so
 *  `elementFromPoint` / `getBoundingClientRect` containment tests work directly. `paths` is
 *  populated only on `enter`/`drop`. */
export type NativeDragDetail = {
  type: "enter" | "over" | "drop" | "leave";
  paths: string[];
  x: number;
  y: number;
};

// Tauri's DragDropEvent payload, typed loosely so we don't couple to a specific @tauri-apps/api
// minor (the union's exact field set has shifted across 2.x). `leave` carries no position/paths.
type DropPayload = {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
  position?: { x: number; y: number };
};

// ── Shared routing / classification helpers (pure, unit-tested in nativeDrop.test.ts) ─────────
// A native drop is a WINDOW-level event; EVERY surface (chat / editor / terminal) receives it and
// must decide whether the drop belongs to IT. These pure helpers make that routing decision testable
// in isolation, so "which pane claims the drop at (x,y)" is verified without a DOM.

/** The minimal rect the drop hit-test needs (satisfied by a DOMRect / getBoundingClientRect()). */
export type DropRect = { left: number; right: number; top: number; bottom: number; width: number; height: number };

/** The pane-routing decision for a forwarded native drop: does the cursor (already in CSS px) fall
 *  inside `rect`? Each surface calls this with its OWN element's rect, so exactly the pane under the
 *  cursor claims the drop. A hidden (display:none) pane has a 0×0 rect at the viewport origin, and a
 *  drop is forwarded at (0,0) when Tauri reports no position — treat a 0×0 rect as NEVER-inside so
 *  such a drop can't hit every backgrounded pane at once. */
export function pointInDropRect(rect: DropRect, x: number, y: number): boolean {
  if (rect.width === 0 && rect.height === 0) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// A native drop hands over a filesystem PATH, never a MIME type — so a surface that only accepts
// certain kinds (the chat composer accepts png/jpeg/gif/webp as SDK image blocks) classifies by
// file extension. Deliberately NARROWER than the editor's embeddable set (no svg/pdf — those aren't
// valid `image` content blocks).
const CHAT_IMAGE_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/** The image MIME type for a dropped OS path, by extension, restricted to the set the chat composer
 *  accepts. Returns null for a non-image (or extension-less) path so callers can skip it. Handles
 *  both `/` and `\` separators and is case-insensitive. */
export function imageMimeFromPath(path: string): string | null {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return null;
  return CHAT_IMAGE_EXT[base.slice(dot + 1).toLowerCase()] ?? null;
}

let installed = false;
let unlisten: (() => void) | undefined;

/** Subscribe to Tauri's native drag-drop and re-broadcast as `bismuth-native-drag`. Idempotent;
 *  a no-op outside Tauri. Safe to call once at app startup. */
export async function installNativeDrop(): Promise<void> {
  if (installed || !isTauri()) return;
  installed = true;
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    unlisten = await getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload as unknown as DropPayload;
      const type = p?.type;
      if (type !== "enter" && type !== "over" && type !== "drop" && type !== "leave") return;
      const hasPos = !!p.position && typeof p.position.x === "number" && typeof p.position.y === "number";
      // Runtime shape guard: the @tauri-apps/api DragDropEvent union has drifted across 2.x and we
      // read it through a loose cast, so validate before trusting it. A `drop` MUST carry a paths
      // array AND a valid position — if a future version changes the shape, degrade to "no native
      // drop" rather than dispatching a drop routed to the viewport corner (0,0).
      if (type === "drop" && (!Array.isArray(p.paths) || !hasPos)) return;
      // position is a PhysicalPosition (physical px); convert to CSS px so client-rect hit-tests
      // line up with the DOM. devicePixelRatio is 1 on non-HiDPI displays (division is a no-op).
      const dpr = window.devicePixelRatio || 1;
      const x = hasPos ? p.position!.x / dpr : 0;
      const y = hasPos ? p.position!.y / dpr : 0;
      const paths = type === "drop" ? p.paths! : [];
      window.dispatchEvent(
        new CustomEvent<NativeDragDetail>("bismuth-native-drag", { detail: { type, paths, x, y } }),
      );
    });
  } catch (e) {
    // A missing capability / API surface mustn't crash startup — the HTML5 fallback still works.
    installed = false;
    console.error("native drag-drop wiring failed", e);
  }
}

/** Tear down the native drag-drop subscription (e.g. HMR). Rarely needed; the listener lives for
 *  the window's lifetime in normal use. */
export function uninstallNativeDrop(): void {
  unlisten?.();
  unlisten = undefined;
  installed = false;
}
