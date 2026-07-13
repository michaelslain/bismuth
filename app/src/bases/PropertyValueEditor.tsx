// app/src/bases/PropertyValueEditor.tsx
// The type-aware control a kanban meta chip swaps in on click (KanbanCard.tsx): a
// `Select` for an enum / known-values property, a comma-separated box for a tag list,
// and a plain (number/date-typed) input otherwise. Boolean properties never reach this
// component — the caller toggles those directly via a `Chip`, so there is no boolean
// branch here.
//
// Commits on blur or Enter; Escape reverts the draft to the ORIGINAL value first, then
// blurs — so the no-op comparison in the caller's commit handler (KanbanCard's
// `commitMeta`) skips the write, matching the title/description editors' idiom above it
// in the same file.
import { Show, createSignal } from "solid-js";
import { Select } from "../ui/Select";
import type { PropertyEditKind } from "./propertyEdit";
import styles from "./BaseView.module.css";

export function PropertyValueEditor(props: {
  kind: PropertyEditKind;
  value: unknown;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
}) {
  const toDraft = (): string => {
    const k = props.kind;
    if (k.kind === "tags") {
      return Array.isArray(props.value) ? props.value.map(String).join(", ") : props.value == null ? "" : String(props.value);
    }
    if (props.value == null) return "";
    if (k.kind === "date") return String(props.value).slice(0, k.time ? 16 : 10);
    return String(props.value);
  };
  const [draft, setDraft] = createSignal(toDraft());

  function commit(): void {
    const k = props.kind;
    const raw = draft().trim();
    if (k.kind === "tags") {
      const arr = raw.split(",").map((s) => s.trim()).filter((s) => s !== "");
      props.onCommit(arr.length ? arr : null);
      return;
    }
    if (k.kind === "number") {
      if (raw === "") { props.onCommit(null); return; }
      const n = Number(raw);
      props.onCommit(Number.isNaN(n) ? raw : n);
      return;
    }
    props.onCommit(raw === "" ? null : raw);
  }

  // Narrow once so the Select branch below gets a typed `options` array without an
  // inline cast — `props.kind` re-derefs on every read, which would otherwise lose the
  // discriminated-union narrowing inside JSX.
  const selectKind = () => (props.kind.kind === "select" ? props.kind : null);

  return (
    <Show
      when={selectKind()}
      fallback={
        <input
          class={styles.kbMetaInput}
          type={props.kind.kind === "number" ? "number" : props.kind.kind === "date" ? (props.kind.time ? "datetime-local" : "date") : "text"}
          value={draft()}
          autofocus
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(toDraft());
              e.currentTarget.blur();
            }
          }}
        />
      }
    >
      {(sk) => (
        <div class={styles.kbMetaSelect} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); props.onCancel(); } }}>
          <Select
            value={props.value == null ? "" : String(props.value)}
            options={[{ value: "", label: "(clear)" }, ...sk().options.map((v) => ({ value: v, label: v }))]}
            onChange={(v) => props.onCommit(v === "" ? null : v)}
          />
        </div>
      )}
    </Show>
  );
}
