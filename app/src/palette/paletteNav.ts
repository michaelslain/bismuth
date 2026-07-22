// app/src/palette/paletteNav.ts
// The keyboard-nav glue shared by the two palette surfaces — the Cmd+P command/file palette
// (PaletteModal.tsx) and the in-window Cmd+O switcher (SwitcherBar.tsx). Both wrap the same
// createMenuNav hook and need three identical bits of plumbing around it: a stationary-pointer
// guard so a still cursor can't steal the keyboard selection, a reset-to-top effect when the
// query (etc.) changes, and a scroll-the-selected-row-into-view effect. Extracted here so the
// two stay in lockstep. What differs per surface is parameterized (extra reset deps, the
// scroll selector's specificity).
import { createEffect } from "solid-js";

// Hover must not steal the selection from the keyboard default until the cursor genuinely
// moves: the palette often opens (or scrolls during Up/Down nav) under a stationary pointer,
// and the browser fires mouseenter on whatever row sits beneath it. We bind the returned
// handler on mousemove — which doesn't fire on open or on wheel-scroll under a still cursor —
// and ignore events whose coordinates haven't changed, so the top result lingers until the
// user actually moves the mouse. Call the returned handler with the row index and event.
export function createPointerGuard(setActive: (i: number) => void) {
  let lastPointer: { x: number; y: number } | undefined;
  return (i: number, e: MouseEvent) => {
    if (lastPointer && lastPointer.x === e.clientX && lastPointer.y === e.clientY) return;
    lastPointer = { x: e.clientX, y: e.clientY };
    setActive(i);
  };
}

// Reset the highlighted row (to the top) whenever `deps` change. `deps` is a thunk that reads
// the reactive signals to track — the query, plus anything else that should restart the walk
// (the switcher also tracks its AI phase).
export function resetActiveOnChange(deps: () => void, reset: () => void) {
  createEffect(() => {
    deps();
    reset();
  });
}

// Keep the highlighted row scrolled into view. `deps` tracks the selection plus whatever
// signal marks the row set as changed (results/count); `list` returns the scroll container;
// `selector` matches the selected row — its specificity differs per surface, hence a param.
export function scrollSelectedIntoView(
  deps: () => void,
  list: () => HTMLElement | undefined,
  selector: string,
) {
  createEffect(() => {
    deps();
    list()?.querySelector<HTMLElement>(selector)?.scrollIntoView({ block: "nearest" });
  });
}
