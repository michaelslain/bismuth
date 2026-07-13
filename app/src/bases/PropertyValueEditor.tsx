// app/src/bases/PropertyValueEditor.tsx
// The type-aware control a kanban meta chip swaps in on click (KanbanCard.tsx): a
// `Select` for an enum / known-values property, a comma-separated box for a tag list, a
// multiline textarea for a declared `markdown` property (#100), and a plain (text/
// number/date-typed) input otherwise. Boolean properties never reach this component —
// the caller toggles those directly via a `Chip`, so there is no boolean branch here.
//
// Commits on blur or Enter (markdown: Enter inserts a newline like any textarea — only
// blur/Escape leave it); Escape reverts the draft to the ORIGINAL value first, then
// blurs — so the no-op comparison in the caller's commit handler (KanbanCard's
// `commitMeta`) skips the write, matching the title/description editors' idiom above it
// in the same file.
//
// A `number` kind carries its declared format (`plain`/`unit`/`currency`/`percent`) +
// unit label — the edit box always shows/accepts the EDIT-space value (percent scales
// ×100; see numberFormat.ts's module doc for the storage convention), converted back to
// the canonical stored number on commit via `parseNumberEdit`.
import { Show, createSignal } from "solid-js";
import { Select } from "../ui/Select";
import type { PropertyEditKind } from "./propertyEdit";
import { numberEditValue, parseNumberEdit } from "./numberFormat";
import styles from "./BaseView.module.css";

/** Grow a textarea to fit its content (no scrollbar) — duplicated from KanbanCard.tsx's
 *  identical helper (not imported: that file is the caller, not a shared module, and this
 *  is a 3-line DOM tweak, matching the codebase's small-pure-duplication idiom elsewhere). */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

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
    if (k.kind === "number") {
      const n = typeof props.value === "number" ? props.value : Number(props.value);
      return Number.isFinite(n) ? String(numberEditValue(n, k.format)) : String(props.value);
    }
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
      const n = parseNumberEdit(raw, k.format);
      // Unparseable input keeps the raw string rather than silently dropping the edit —
      // KanbanCard's commitMeta coerces through the declared type as a second pass.
      props.onCommit(n === null ? raw : n);
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
        <Show
          when={props.kind.kind === "markdown"}
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
          <textarea
            class={styles.kbMetaMarkdownArea}
            value={draft()}
            rows={1}
            autofocus
            ref={(el) => queueMicrotask(() => { el.focus(); autoGrow(el); })}
            onInput={(e) => { setDraft(e.currentTarget.value); autoGrow(e.currentTarget); }}
            onBlur={commit}
            onKeyDown={(e) => {
              // Enter inserts a newline (multiline body) — only Escape/blur leave the editor.
              if (e.key === "Escape") {
                e.stopPropagation();
                setDraft(toDraft());
                e.currentTarget.blur();
              }
            }}
          />
        </Show>
      }
    >
      {(sk) => (
        <div class={styles.kbMetaSelect}>
          <Select
            value={props.value == null ? "" : String(props.value)}
            options={[{ value: "", label: "(clear)" }, ...sk().options.map((v) => ({ value: v, label: v }))]}
            onChange={(v) => props.onCommit(v === "" ? null : v)}
            onDismiss={props.onCancel}
          />
        </div>
      )}
    </Show>
  );
}
