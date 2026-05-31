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
    // Baseline for the no-op skip: an empty file has no prior snapshot to match.
    lastWrittenText = raw.trim() === "" ? null : raw;
    const { mountSheet } = await import("./sheet/univerSheet");
    handle = mountSheet({ container, data, onChange: () => save() });
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
