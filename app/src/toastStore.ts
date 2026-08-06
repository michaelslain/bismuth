// app/src/toastStore.ts
// Pure toast state + actions, split out of Toast.tsx (which additionally renders <ToastHost/>, a
// real Solid/JSX component). A module that only needs to push/dismiss a toast — like
// serverVersion.ts — imports this instead, so its module graph never pulls in JSX. See
// docs/contributing/testing.md's "cwd-dependent JSX-resolution trap" and app/src/pickResult.ts
// (split out of appWindow.ts for the identical reason): `bun test app/` — how the commit/push
// gate invokes it — breaks if a *.test.ts's import graph reaches a real .tsx file, and
// serverVersion.ts gained runtime test coverage in task 2 (seam B, github issues #3/#8).
import { createSignal } from "solid-js";

export type Toast = {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
};

const [toasts, setToasts] = createSignal<Toast[]>([]);
let nextId = 1;
// Auto-dismiss timer handles, keyed by toast id, so an early dismiss (action
// click / external dismiss) can cancel the pending timeout instead of leaking it.
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Add a toast; auto-dismisses after `ttl` ms. Returns its id so callers can replace/dismiss it.
 *  Pass `ttl <= 0` (or a non-finite value) to make the toast PERSISTENT — no auto-dismiss timer.
 *  That's the mode progress toasts use: push once, mutate via updateToast, dismissToast when done.
 *  (A literal 0 would otherwise schedule setTimeout(…, 0) and the toast would vanish on the next
 *  tick, before any awaited work resolves — so guard the timer here.) */
export function pushToast(message: string, action?: Toast["action"], ttl = 5000): number {
  const id = nextId++;
  setToasts((prev) => [...prev, { id, message, action }]);
  if (ttl > 0 && Number.isFinite(ttl)) timers.set(id, setTimeout(() => dismissToast(id), ttl));
  return id;
}

/** Replace a live toast's message in place (e.g. progress updates). No-op if it's gone.
 *  Replaces the toast object so the keyed <For> re-renders the row; there's no enter
 *  animation (Toast.css is static), so the text just swaps with no flicker. */
export function updateToast(id: number, message: string) {
  setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, message } : t)));
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

export { toasts };
