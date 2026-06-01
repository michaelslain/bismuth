import { onMount, onCleanup, createSignal, Show } from "solid-js";
import { api } from "./api";
import { parseSnapshot, serializeSnapshot, SheetParseError, type WorkbookSnapshot } from "./sheet/snapshot";
import { debounce } from "./debounce";
import { onServerChange } from "./serverVersion";
import { isExternalChange } from "./sheet/sync";
import type { SheetHandle } from "./sheet/univerSheet";

export function SheetView(props: { path: string; onSaved?: () => void }) {
  let container!: HTMLDivElement;
  const [error, setError] = createSignal<string | null>(null);
  let handle: SheetHandle | undefined;
  let lastWrittenText: string | null = null;
  let dirty = false;

  // Persist the workbook on change. Debounced so a burst of edits writes once;
  // the snapshot-equality check skips no-op commands (e.g. selection changes) so
  // we don't rewrite the file or bump the server version for nothing.
  const save = debounce(async () => {
    if (!handle) return;
    const text = serializeSnapshot(handle.getSnapshot());
    if (text === lastWrittenText) {
      // No real change (e.g. Univer's mount-time selection/render commands). The
      // in-memory workbook matches disk, so we're clean — clearing dirty here is
      // essential, otherwise the flag sticks true and blocks external reloads.
      dirty = false;
      return;
    }
    lastWrittenText = text;
    await api.write(props.path, text);
    dirty = false;
    props.onSaved?.();
  }, 750);

  // Mount (or remount) Univer with `data`, then baseline `lastWrittenText` to
  // Univer's own serialization so the selection/render commands it fires during
  // mount compare equal and an unedited sheet is never written to disk.
  async function mount(data: WorkbookSnapshot) {
    const { mountSheet } = await import("./sheet/univerSheet"); // lazy: Univer chunk loads here
    handle = mountSheet({ container, data, onChange: () => { dirty = true; save(); } });
    lastWrittenText = serializeSnapshot(handle.getSnapshot());
  }

  // Reload from disk when an EXTERNAL writer changes our file while we're clean.
  // Our own debounced saves echo back over SSE; isExternalChange filters those out
  // by comparing on-disk text to what we last wrote. We never reload while dirty —
  // that would clobber in-progress edits. Registered synchronously (not inside the
  // async onMount) so its cleanup is owned by this component.
  const unsub = onServerChange(async (change) => {
    if (!handle || dirty || !change.paths.includes(props.path)) return;
    let diskText: string;
    try {
      diskText = await api.read(props.path);
    } catch {
      return; // file vanished mid-session; keep the current view
    }
    if (!isExternalChange({ path: props.path, changedPaths: change.paths, isDirty: dirty, diskText, lastWrittenText })) return;
    try {
      const data = parseSnapshot(diskText);
      handle.dispose();
      await mount(data);
    } catch {
      // external write left invalid JSON; keep showing the last good workbook
    }
  });

  onMount(async () => {
    let raw: string;
    try {
      raw = await api.read(props.path);
    } catch (e) {
      setError(String(e));
      return;
    }
    try {
      await mount(parseSnapshot(raw));
    } catch (e) {
      setError(e instanceof SheetParseError ? e.message : String(e));
    }
  });

  onCleanup(() => {
    unsub();
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
