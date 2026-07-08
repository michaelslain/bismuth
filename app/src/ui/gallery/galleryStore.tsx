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
    // Clear the flag BEFORE resolving, so the resolver's deferred `applyInsert` + `view.focus()`
    // (which runs on a microtask) sees the gallery as closed and a subsequent cell blur tears down
    // normally again (#49).
    setGalleryOpen(false);
    p?.resolve(value);
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
