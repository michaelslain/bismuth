import { createSignal, For, Show } from "solid-js";
import { api } from "../api";
import type { BaseConfig, ViewType } from "../../../core/src/bases/types";

interface FieldDef {
  key: string;
  label: string;
  def: string;
}

// Per-view-type settings. Notion-style: the panel is dynamic by the active view's type.
// (The spaced-repetition algorithm is fixed/academic and intentionally NOT editable here.)
const FIELDS_BY_TYPE: Partial<Record<ViewType, FieldDef[]>> = {
  flashcards: [
    { key: "frontField", label: "Front column", def: "front" },
    { key: "backField", label: "Back column", def: "back" },
    { key: "dueField", label: "Due column", def: "due" },
  ],
  calendar: [
    { key: "dateField", label: "Date column", def: "date" },
    { key: "startTimeField", label: "Start-time column", def: "startTime" },
    { key: "endTimeField", label: "End-time column", def: "endTime" },
    { key: "recurrenceField", label: "Recurrence column", def: "recurrence" },
    { key: "categoryField", label: "Category column", def: "category" },
  ],
};

const TITLE: Partial<Record<ViewType, string>> = {
  flashcards: "Flashcard deck settings",
  calendar: "Calendar settings",
};

/**
 * Settings panel for a base view. Content is dynamic by view type. Field bindings persist to
 * the base's top-level frontmatter via /set-property; the default view reads them on reload.
 */
export function BaseSettings(props: {
  type: ViewType;
  config: BaseConfig;
  basePath?: string;
  onSaved: () => void;
}) {
  const view = () => props.config.views[0];
  const fields = () => FIELDS_BY_TYPE[props.type] ?? [];

  const seed = (): Record<string, string> => {
    const v = (view() ?? {}) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const f of fields()) out[f.key] = (v[f.key] as string) ?? f.def;
    return out;
  };
  const [form, setForm] = createSignal<Record<string, string>>(seed());

  const save = async () => {
    if (props.basePath) {
      for (const f of fields()) await api.setProperty(props.basePath, f.key, form()[f.key]);
    }
    props.onSaved();
  };

  return (
    <div class="srs-panel">
      <h3>{TITLE[props.type] ?? `${props.type[0].toUpperCase()}${props.type.slice(1)} settings`}</h3>

      <Show
        when={fields().length > 0}
        fallback={<p class="deck-empty">No extra settings for this view type yet.</p>}
      >
        <div class="srs-grid">
          <For each={fields()}>
            {(f) => (
              <label class="srs-field">
                <span>{f.label}</span>
                <input
                  type="text"
                  value={form()[f.key]}
                  placeholder={f.def}
                  onInput={(e) => setForm({ ...form(), [f.key]: e.currentTarget.value })}
                />
              </label>
            )}
          </For>
        </div>
        <Show when={props.type === "flashcards"}>
          <p class="deck-empty" style={{ "font-size": "12px" }}>
            Scheduling uses the standard SM-2 algorithm (fixed, not configurable). Use <strong>Cram</strong> in
            the deck to review everything without affecting scheduling.
          </p>
        </Show>
      </Show>

      <div class="grade-row">
        <Show when={fields().length > 0}>
          <button class="card-btn good" onClick={save}>Save</button>
        </Show>
        <button class="card-btn" onClick={props.onSaved}>Close</button>
      </div>
    </div>
  );
}
