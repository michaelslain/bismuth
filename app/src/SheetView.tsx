import { onMount, onCleanup, createSignal, Show } from "solid-js";
import { api } from "./api";
import { parseSnapshot, SheetParseError } from "./sheet/snapshot";
import type { SheetHandle } from "./sheet/univerSheet";

export function SheetView(props: { path: string; onSaved?: () => void }) {
  let container!: HTMLDivElement;
  const [error, setError] = createSignal<string | null>(null);
  let handle: SheetHandle | undefined;

  onMount(async () => {
    let data;
    try {
      data = parseSnapshot(await api.read(props.path));
    } catch (e) {
      setError(e instanceof SheetParseError ? e.message : String(e));
      return;
    }
    const { mountSheet } = await import("./sheet/univerSheet"); // lazy: Univer chunk loads here
    handle = mountSheet({ container, data, onChange: () => {} }); // autosave wired in a later task
  });

  onCleanup(() => handle?.dispose());

  return (
    <Show
      when={!error()}
      fallback={<div style={{ padding: "16px", color: "var(--danger, #c00)" }}>{error()}</div>}
    >
      <div ref={container} style={{ width: "100%", height: "100%" }} />
    </Show>
  );
}
