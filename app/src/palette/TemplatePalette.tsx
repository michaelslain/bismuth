// Option+T — a fuzzy picker of vault templates. Selecting one reads the file,
// expands its {{...}} variables, and inserts the result at the cursor of the
// last-focused note editor (caret landing where {{cursor}} was). Mirrors
// CommandPalette.tsx; the async template list is loaded with createResource.
import { createResource, Show } from "solid-js";
import { PaletteModal, type PaletteItem } from "./PaletteModal";
import { api } from "../api";
import { expandTemplate } from "../../../core/src/templates";
import { insertIntoFocusedEditor } from "../editorRegistry";
import { pushToast } from "../Toast";

type Props = { onClose: () => void; title: string };

export function TemplatePalette(props: Props) {
  const [templates] = createResource(() => api.templates());
  const onSelect = async (item: PaletteItem) => {
    try {
      const raw = await api.read(item.id); // item.id is the vault path
      const { text, cursorOffset } = expandTemplate(raw, { now: new Date(), title: props.title });
      const ok = insertIntoFocusedEditor(text, cursorOffset);
      if (!ok) pushToast("Open a note to insert a template");
    } catch (e) {
      pushToast(`Template insert failed: ${(e as Error).message}`);
    } finally {
      props.onClose();
    }
  };
  return (
    <Show when={templates()}>
      <PaletteModal
        placeholder="Insert a template..."
        items={(templates() ?? []).map((t) => ({
          id: t.path,
          label: t.name,
          sublabel: t.path,
          // Faint second-line description, only when the template carries one
          // (the /templates feed currently omits it → omitted gracefully).
          description: (t as { description?: string }).description || undefined,
        }))}
        emptyText="No templates found (set templates.folder in settings.yaml)"
        onClose={props.onClose}
        onSelect={onSelect}
      />
    </Show>
  );
}
