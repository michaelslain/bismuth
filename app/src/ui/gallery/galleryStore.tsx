// app/src/ui/gallery/galleryStore.tsx
// A global, promise-based launcher for the SymbolGallery — so imperative call sites
// that live OUTSIDE the Solid reactive tree (notably CodeMirror completion `apply`
// handlers) can pop a gallery and await the picked value. Mirrors the Toast pattern:
// a single global signal drives one host mounted near the app root.
import { createSignal, Show } from "solid-js";
import { SymbolGallery } from "./SymbolGallery";
import { setGalleryOpen } from "./galleryState";
import type { GallerySource } from "./types";

type Pending = {
  source: GallerySource;
  current?: string;
  title?: string;
  resolve: (value: string | null) => void;
};

const [pending, setPending] = createSignal<Pending | null>(null);

/**
 * Open a gallery and resolve with the picked value, or `null` if dismissed.
 * Safe to call from anywhere (no Solid owner required) — it just sets a signal.
 * Only one gallery shows at a time; opening a second resolves the first as dismissed.
 */
export function openGallery(opts: { source: GallerySource; current?: string; title?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    // Set the Solid-free flag BEFORE `setPending` renders the modal. `setPending` runs Solid's
    // render synchronously, and SymbolGallery's `onMount` steals focus (its search box) IN THAT SAME
    // call — blurring the table cell's nested editor and firing its `focusout` before control returns
    // here. The cell's teardown guard reads `isGalleryOpen()` in that focusout, so the flag must
    // already be true or the cell tears down (destroying the editor the deferred insert targets) —
    // the whole point of the guard (#49). Setting it first makes the ordering race-free.
    setGalleryOpen(true);
    setPending((prev) => {
      prev?.resolve(null);
      return { ...opts, resolve };
    });
  });
}

/** Renders the active gallery, if any. Mount once near the app root (like ToastHost). */
export function GalleryHost() {
  const settle = (value: string | null) => {
    const p = pending();
    setPending(null);
    // Resolve FIRST, and keep `isGalleryOpen()` TRUE until AFTER the resolver has run its insert
    // (#67). The resolver (autocomplete.ts's emoji `apply`) does `applyInsert(cellView, …)` +
    // `view.focus()` on the promise's microtask. If we cleared the flag synchronously here (the old
    // order), the focus churn from unmounting the modal could fire the table cell's `focusout` with
    // the guard already down → `leaveEdit` commits + DESTROYS the nested cell editor the insert
    // targets, so the picked emoji (top result / Enter) landed nowhere. Deferring the clear to the
    // NEXT MACROTASK keeps the teardown guard up across the whole synchronous+microtask insert;
    // by the time the user's NEXT real blur fires (a later macrotask) the flag is false again, so
    // the cell tears down normally then (#49).
    p?.resolve(value);
    if (typeof setTimeout !== "undefined") setTimeout(() => setGalleryOpen(false), 0);
    else setGalleryOpen(false);
  };
  return (
    <Show when={pending()}>
      {(p) => (
        <SymbolGallery
          source={p().source}
          current={p().current}
          title={p().title}
          onPick={(v) => settle(v)}
          onClose={() => settle(null)}
        />
      )}
    </Show>
  );
}
