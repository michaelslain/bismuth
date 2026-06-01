import { onMount, onCleanup, createSignal, Show } from "solid-js";
import { api } from "./api";
import { parseSnapshot, serializeSnapshot, SheetParseError } from "./sheet/snapshot";
import { debounce } from "./debounce";
import type { SheetHandle } from "./sheet/univerSheet";

export function SheetView(props: { path: string; onSaved?: () => void }) {
  let container!: HTMLDivElement;
  const [error, setError] = createSignal<string | null>(null);
  let handle: SheetHandle | undefined;
  let lastWrittenText: string | null = null;

  // Persist the workbook on change. Debounced so a burst of edits writes once;
  // the snapshot-equality check skips no-op commands (e.g. selection changes)
  // so we don't rewrite the file or bump the server version for nothing.
  const save = debounce(async () => {
    if (!handle) return;
    const text = serializeSnapshot(handle.getSnapshot());
    if (text === lastWrittenText) return;
    lastWrittenText = text;
    await api.write(props.path, text);
    props.onSaved?.();
  }, 750);

  onMount(async () => {
    let raw: string;
    try {
      raw = await api.read(props.path);
    } catch (e) {
      setError(String(e));
      return;
    }
    let data;
    try {
      data = parseSnapshot(raw);
    } catch (e) {
      setError(e instanceof SheetParseError ? e.message : String(e));
      return;
    }
    const { mountSheet } = await import("./sheet/univerSheet");
    handle = mountSheet({ container, data, onChange: () => save() });
    // Baseline = Univer's own serialization of the freshly-mounted workbook. The
    // commands Univer fires during mount (selection/render) then compare equal, so
    // an unedited sheet is never written to disk (and a deleted/empty file is not
    // resurrected by merely opening it). Only a real edit diverges from this.
    lastWrittenText = serializeSnapshot(handle.getSnapshot());
  });

  onCleanup(() => {
    save.cancel();
    handle?.dispose();
  });

  return (
    <Show
      when={!error()}
      fallback={<div style={{ padding: "16px", color: "var(--danger, #c00)" }}>{error()}</div>}
    >
      <div ref={container} style={{ width: "100%", height: "100%" }} />
    </Show>
  );
}
