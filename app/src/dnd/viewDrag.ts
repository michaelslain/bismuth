// app/src/dnd/viewDrag.ts
// One pointer-events drag controller for any "view" — a top-level tab or a pane.
// On pointerdown we arm; once the pointer crosses a small threshold we commit to a
// drag, show a floating ghost, and resolve the drop target under the cursor on
// every move (via elementFromPoint + data-* attributes, so we never depend on
// cached rects that the animating tab strip would invalidate). On pointerup we
// hand (descriptor, target) to the caller. Escape or a drop on nothing cancels.
//
// The pure geometry (which pane zone, which insertion slot) lives in geometry.ts;
// this module is just the stateful glue and is exercised live in the browser.
import { createSignal, type Accessor } from "solid-js";
import { dropZoneForPoint, insertionIndexForX, type Zone } from "./geometry";

export type DragDescriptor =
  | { kind: "tab"; tabId: string; label: string; width: number }
  | { kind: "pane"; tabId: string; leafId: string; label: string; width: number };

export type DropTarget =
  | { kind: "tabstrip"; index: number }
  | { kind: "pane"; leafId: string; zone: Zone };

export type DragState = {
  active: boolean; // past the threshold → ghost visible, neighbors react
  descriptor: DragDescriptor | null;
  x: number; // pointer position (viewport)
  y: number;
  grabDX: number; // cursor offset within the grabbed element, so the ghost
  grabDY: number; // sits where you picked it up rather than snapping to center
  target: DropTarget | null;
};

const IDLE: DragState = {
  active: false, descriptor: null, x: 0, y: 0, grabDX: 0, grabDY: 0, target: null,
};

const THRESHOLD = 5; // px of travel before a press becomes a drag (vs a click)

export type ViewDrag = {
  state: Accessor<DragState>;
  // `onTap` fires on pointerup when the press never crossed the drag threshold —
  // i.e. it was a click. Activating a tab on tap (not on press) keeps the
  // previously-active tab's panes as the drop target, so dragging a background
  // tab into the current view works instead of no-op'ing on its own panes.
  startTab: (e: PointerEvent, tabId: string, label: string, onTap?: () => void) => void;
  startPane: (e: PointerEvent, tabId: string, leafId: string, label: string) => void;
};

export function createViewDrag(
  onDrop: (descriptor: DragDescriptor, target: DropTarget) => void,
): ViewDrag {
  const [state, setState] = createSignal<DragState>(IDLE);

  let origin = { x: 0, y: 0 };
  let grab = { dx: 0, dy: 0 };
  let pending: DragDescriptor | null = null;
  let tap: (() => void) | null = null;

  // Find the drop target under (x, y). The ghost is pointer-events:none, so
  // elementFromPoint sees through it to the strip / pane below.
  function resolveTarget(x: number, y: number): DropTarget | null {
    const el = document.elementFromPoint(x, y) as Element | null;
    if (!el) return null;

    const strip = el.closest("[data-tabstrip]");
    if (strip) {
      const chips = [...strip.querySelectorAll("[data-tab-chip]")].map((c) => {
        const r = c.getBoundingClientRect();
        return { x: r.left, w: r.width };
      });
      return { kind: "tabstrip", index: insertionIndexForX(chips, x) };
    }

    const pane = el.closest("[data-pane-leaf]");
    if (pane) {
      const leafId = pane.getAttribute("data-pane-leaf");
      if (leafId) {
        const r = pane.getBoundingClientRect();
        const zone = dropZoneForPoint({ x: r.left, y: r.top, w: r.width, h: r.height }, x, y);
        return { kind: "pane", leafId, zone };
      }
    }
    return null;
  }

  function setDraggingClass(on: boolean): void {
    document.documentElement.classList.toggle("view-dragging", on);
  }

  function onMove(e: PointerEvent): void {
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    const wasActive = state().active;
    if (!wasActive && Math.hypot(dx, dy) < THRESHOLD) return; // still just a press
    if (!wasActive) setDraggingClass(true);
    e.preventDefault(); // suppress text selection mid-drag
    const target = resolveTarget(e.clientX, e.clientY);
    setState({
      active: true, descriptor: pending,
      x: e.clientX, y: e.clientY, grabDX: grab.dx, grabDY: grab.dy, target,
    });
  }

  function cleanup(): void {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey);
    setDraggingClass(false);
    pending = null;
    tap = null;
    setState(IDLE);
  }

  function onUp(): void {
    const s = state();
    if (s.active) {
      if (s.descriptor && s.target) onDrop(s.descriptor, s.target);
    } else {
      tap?.(); // never crossed the threshold → treat as a click
    }
    cleanup();
  }

  // The OS can steal the pointer mid-drag (touch/pen gesture takeover, swipe-back,
  // a system menu) and fire pointercancel INSTEAD of pointerup. Abort cleanly so we
  // never leak the window listeners or leave the ghost stuck on screen.
  function onCancel(): void {
    cleanup();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") cleanup();
  }

  function arm(e: PointerEvent, descriptor: DragDescriptor, rect: DOMRect, onTap?: () => void): void {
    if (e.button !== 0) return; // primary button only
    origin = { x: e.clientX, y: e.clientY };
    grab = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    pending = descriptor;
    tap = onTap ?? null;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
  }

  return {
    state,
    startTab(e, tabId, label, onTap) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      arm(e, { kind: "tab", tabId, label, width: rect.width }, rect, onTap);
    },
    startPane(e, tabId, leafId, label) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      arm(e, { kind: "pane", tabId, leafId, label, width: rect.width }, rect);
    },
  };
}
