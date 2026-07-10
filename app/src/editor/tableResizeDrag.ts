// app/src/editor/tableResizeDrag.ts
// The pure lifecycle of a table COLUMN-resize drag (editor/tableWidget.ts), extracted so the
// "always releases" guarantee is unit-testable headlessly (the widget's own DOM drag can't be).
//
// The bug this hardens (the "resize gets stuck" report): the widget used to end the drag ONLY on a
// window `mouseup`. In the packaged app's WebKit/WKWebView a button released OUTSIDE the window — or
// an alt-tab / OS focus-steal / pointercancel mid-drag — never delivers that `mouseup`, so the
// cleanup (reset `document.body.style.cursor`, drop the `cm-col-resize--dragging` class, remove the
// move/up listeners, persist) never ran: the col-resize cursor stayed stuck and the drag never
// ended. The fix wires EVERY plausible end event (pointerup / pointercancel / mouseup / window blur,
// plus pointer capture) to this controller's `end()`, which is IDEMPOTENT — whichever fires first
// runs the single cleanup, the rest no-op. This module owns that idempotency + the (also pure) width
// math; the widget owns the DOM listener wiring that calls in.

/** Clamp a resized column width: never below `min`. Pure. */
export function computeResizeWidth(startWidth: number, dx: number, min: number): number {
  const w = startWidth + dx;
  return w < min ? min : w;
}

/** A live resize drag: feed it pointer x as the pointer moves, `end()` it exactly once. */
export interface ResizeDrag {
  /** Recompute + apply the width for the current pointer x. No-op once ended. */
  move(clientX: number): void;
  /** Run the one-shot cleanup (listeners/cursor/persist). Safe to call any number of times — the
   *  cleanup fires only on the FIRST call, so wiring it to several end events can't double-clean. */
  end(): void;
  /** True until `end()` has run — lets the caller skip re-entrant starts. */
  readonly active: boolean;
}

/** Create a resize-drag controller. `onWidth` applies a computed width (pointer-driven); `onEnd` is
 *  the single cleanup, guaranteed to run at most once no matter how many end events call `end()`. */
export function createResizeDrag(opts: {
  originX: number;
  startWidth: number;
  min: number;
  onWidth: (width: number) => void;
  onEnd: () => void;
}): ResizeDrag {
  let active = true;
  return {
    get active() {
      return active;
    },
    move(clientX: number): void {
      if (!active) return;
      opts.onWidth(computeResizeWidth(opts.startWidth, clientX - opts.originX, opts.min));
    },
    end(): void {
      if (!active) return;
      active = false;
      opts.onEnd();
    },
  };
}
