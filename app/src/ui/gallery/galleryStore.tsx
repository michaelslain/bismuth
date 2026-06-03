// app/src/ui/gallery/galleryStore.tsx
// A global, promise-based launcher for the SymbolGallery — so imperative call sites
// that live OUTSIDE the Solid reactive tree (notably CodeMirror completion `apply`
// handlers) can pop a gallery and await the picked value. Mirrors the Toast pattern:
// a single global signal drives one host mounted near the app root.
import { createSignal, Show } from "solid-js";
import { SymbolGallery } from "./SymbolGallery";
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
