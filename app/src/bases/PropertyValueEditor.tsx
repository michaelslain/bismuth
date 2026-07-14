// app/src/bases/PropertyValueEditor.tsx
// The type-aware control a kanban meta chip swaps in on click (KanbanCard.tsx): a
// `Select` for an enum / known-values property, a chip-based add/remove picker for a
// declared `multiselect` (#101), a comma-separated box for a plain (undeclared) tag
// list, a multiline textarea for a declared `markdown` property (#100), and a plain
// (text/number/date-typed) input otherwise. Boolean properties never reach this
// component — the caller toggles those directly via a `Chip`, so there is no boolean
// branch here.
//
// Commits on blur or Enter (markdown: Enter inserts a newline like any textarea — only
// blur/Escape leave it); Escape reverts the draft to the ORIGINAL value first, then
// blurs — so the no-op comparison in the caller's commit handler (KanbanCard's
// `commitMeta`) skips the write, matching the title/description editors' idiom above it
// in the same file. `multiselect` is the one kind that stays open across several writes
// (add/remove is naturally multi-step) — see its own doc below for how it signals "keep
// editing" vs. "done".
//
// A `number` kind carries its declared format (`plain`/`unit`/`currency`/`percent`) +
// unit label — the edit box always shows/accepts the EDIT-space value (percent scales
// ×100; see numberFormat.ts's module doc for the storage convention), converted back to
// the canonical stored number on commit via `parseNumberEdit`.
import { Show, createSignal, createMemo, For, onCleanup } from "solid-js";
import { Select } from "../ui/Select";
import { Chip } from "../ui/Chip";
import type { PropertyEditKind } from "./propertyEdit";
import { multiselectAvailable, multiselectCommitValue, multiselectValues, selectOptionsWithCurrent } from "./propertyEdit";
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
  // `opts.keepOpen` (set by the multiselect branch below, for its add/remove writes) tells
  // the caller (KanbanCard's `commitMeta`) to persist the value WITHOUT closing the editor —
  // every other kind commits exactly once and always closes, so they simply omit it.
  onCommit: (value: unknown, opts?: { keepOpen?: boolean }) => void;
  onCancel: () => void;
  // Whether the control grabs focus on mount. Defaults to true (the kanban chip swaps this
  // editor in already-focused). A multi-field form (CardEditModal) sets false and manages
  // focus itself, so several editors mounting at once don't all fight to steal focus.
  autofocus?: boolean;
}) {
  const autofocus = () => props.autofocus !== false;
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
  const multiKind = () => (props.kind.kind === "multiselect" ? props.kind : null);

  // Legacy tolerance (#101): a stored value the base's `options:` list doesn't (or no
  // longer) declare must still show up as the CURRENT selection rather than silently
  // reading as "(clear)" — so a hand-edited or since-removed option is prepended to the
  // menu, still chosen, still one click from being replaced or cleared.
  const selectOptions = () => {
    const sk = selectKind();
    if (!sk) return [];
    const current = props.value == null ? "" : String(props.value);
    const opts = selectOptionsWithCurrent(sk.options, current);
    return [{ value: "", label: "(clear)" }, ...opts.map((v) => ({ value: v, label: v }))];
  };

  return (
    <Show
      when={multiKind()}
      fallback={
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
                  autofocus={autofocus()}
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
                autofocus={autofocus()}
                ref={(el) => queueMicrotask(() => { if (autofocus()) el.focus(); autoGrow(el); })}
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
          <div class={styles.kbMetaSelect}>
            <Select
              value={props.value == null ? "" : String(props.value)}
              options={selectOptions()}
              onChange={(v) => props.onCommit(v === "" ? null : v)}
              onDismiss={props.onCancel}
            />
          </div>
        </Show>
      }
    >
      {(mk) => <MultiSelectEditor options={mk().options} value={props.value} onCommit={props.onCommit} onCancel={props.onCancel} />}
    </Show>
  );
}

/**
 * The `multiselect` (#101) editor: a chip per currently-selected value (click a chip to
 * remove it) plus a "+ Add" `Select` offering the declared options NOT already picked
 * (choosing one adds it and re-collapses, ready to add another). Legacy tolerance: a
 * stored value outside `options` still renders as a removable chip — it's simply absent
 * from the "add" menu (it's already selected, and re-declaring it isn't this editor's job).
 *
 * Unlike every other kind, each add/remove writes IMMEDIATELY (`keepOpen: true` — there's
 * no natural "blur" for a set of chip buttons) and the editor stays mounted so more than
 * one change can be made per click-in. It closes on Escape or on a pointerdown OUTSIDE its
 * own DOM — including outside the Select's portaled popover/backdrop, which live outside
 * this component's subtree, so both are explicitly exempted — calling `onCancel` (a plain
 * close: every value change already committed, so there's nothing left to write).
 */
function MultiSelectEditor(props: {
  options: string[];
  value: unknown;
  onCommit: (value: unknown, opts?: { keepOpen?: boolean }) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = createSignal<string[]>(multiselectValues(props.value));

  // The "add" menu only offers declared options not already picked — an already-selected
  // legacy value (outside `options`) stays out of this list (it has nowhere else to go;
  // it's removed via its own chip, not re-added here).
  const available = createMemo(() => multiselectAvailable(props.options, selected()));

  function write(next: string[]): void {
    setSelected(next);
    props.onCommit(multiselectCommitValue(next), { keepOpen: true });
  }
  const remove = (v: string) => write(selected().filter((s) => s !== v));
  const add = (v: string) => { if (v && !selected().includes(v)) write([...selected(), v]); };

  let rootRef: HTMLDivElement | undefined;
  // A click anywhere outside this editor's own DOM closes it — EXCEPT inside the "+ Add"
  // Select's portaled chrome (`.bismuth-popover` menu / `.ui-select-backdrop`), which is
  // rendered to <body>, not under `rootRef`, so it would otherwise read as "outside".
  function onDocPointerDown(e: PointerEvent): void {
    const target = e.target;
    if (!(target instanceof Node)) return;
    if (rootRef?.contains(target)) return;
    if (target instanceof Element && target.closest(".bismuth-popover, .ui-select-backdrop")) return;
    props.onCancel();
  }
  document.addEventListener("pointerdown", onDocPointerDown, true);
  onCleanup(() => document.removeEventListener("pointerdown", onDocPointerDown, true));

  return (
    <div
      class={styles.kbMetaMultiselect}
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); props.onCancel(); }
      }}
    >
      <For each={selected()}>
        {(v) => (
          <Chip selected icon="X" iconSize={11} title="Remove" onClick={() => remove(v)}>
            {v}
          </Chip>
        )}
      </For>
      <Show when={available().length > 0}>
        <Select
          value=""
          placeholder="+ Add"
          options={available().map((o) => ({ value: o, label: o }))}
          onChange={add}
          class={styles.kbMetaMultiselectAdd}
        />
      </Show>
    </div>
  );
}
