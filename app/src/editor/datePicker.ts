// app/src/editor/datePicker.ts
// Calendar autocomplete for `date` / `datetime` frontmatter properties.
//
// When the caret sits in the VALUE of a note-frontmatter property whose registered
// type is `date` or `datetime` (the `properties:` section of settings.yaml, surfaced
// to the editor as the propertyRegistry), a small popover opens: a native date input
// (plus a time input for datetime) defaulting to today — the SAME native controls the
// calendar EventModal uses — with the quick relative-date options (today, tomorrow, in
// a week…) listed below it.
//
// Why a custom `showTooltip` tooltip rather than a CodeMirror autocomplete source: the
// autocomplete popup closes the moment the editor loses focus, so a focusable native
// <input type="date"> inside it would be dismissed the instant you click it to open the
// OS calendar. A `showTooltip` tooltip is STATE-driven (tied to the cursor/selection,
// not focus), so the native input can take focus freely. The relative-date rows still
// apply on `mousedown`+preventDefault, so clicking them never blurs the editor at all.
//
// Pure helpers (findDateTarget / parseDateValue / composeDateValue) live in
// datePickerCore.ts so they're unit-testable without the CSS / CodeMirror imports here;
// import them directly from there (they are intentionally NOT re-exported from this file).
import { showTooltip, keymap, EditorView, type Tooltip, type TooltipView } from "@codemirror/view";
import { StateField, StateEffect, Prec, type Extension, type EditorState } from "@codemirror/state";
import type { Schema } from "../../../core/src/schema/types";
import { todayISO } from "../../../core/src/dates";
import { relativeDateOptions } from "./taskComplete";
import {
  findDateTarget,
  parseDateValue,
  composeDateValue,
  nowHHMM,
  type DateKind,
  type DateTarget,
} from "./datePickerCore";
import "./datePicker.css";

// Force the picker closed (Escape, or after a pick). The dismissed target's sig is held in
// the field so it stays closed while the caret remains on the same property.
const dismissPicker = StateEffect.define<null>();

/** Imperative handle to the mounted popover, kept in a per-view map so the keymap
 *  commands (which only get the EditorView) can drive highlight + selection. */
interface PickerController {
  rows: HTMLElement[];
  index: number;
  setHighlight(i: number): void;
  pick(i: number): void;
}

interface PickerState {
  /** The live target is kept here so insertValue + the refresh hook read it without
   *  re-deriving from the whole document on every interaction. `tooltip` identity is
   *  preserved across keystrokes (same key + valueFrom) so the native inputs don't remount. */
  open: { tooltip: Tooltip; target: DateTarget } | null;
  /** Sig the user dismissed; suppresses reopening until the caret leaves that property. */
  dismissed: string | null;
}

export function datePropertyPicker(getSchema: () => Schema): Extension {
  // One active controller per view (only one picker shows at a time).
  const controllers = new WeakMap<EditorView, PickerController>();

  function makeTooltip(target: DateTarget): Tooltip {
    return {
      pos: target.valueFrom,
      above: false,
      arrow: false,
      create: (view) => buildPicker(view, target.kind, target.current),
    };
  }

  function buildPicker(view: EditorView, kind: DateKind, initial: string): TooltipView {
    const prefill = parseDateValue(initial);
    const dom = document.createElement("div");
    // `.oa-popover` supplies the menu chrome; datePicker.css restores the themed surface
    // (CM stamps `cm-tooltip` onto this element, whose default light bg would otherwise win).
    dom.className = "oa-popover oa-datepicker";

    // header — native date (+ time) inputs, defaulting to today / now.
    const head = document.createElement("div");
    head.className = "oa-datepicker-head";
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.className = "ui-input oa-datepicker-date";
    dateInput.value = prefill.date || todayISO();
    head.appendChild(dateInput);

    let timeInput: HTMLInputElement | null = null;
    if (kind === "datetime") {
      timeInput = document.createElement("input");
      timeInput.type = "time";
      timeInput.className = "ui-input oa-datepicker-time";
      timeInput.value = prefill.time || nowHHMM();
      head.appendChild(timeInput);
    }
    dom.appendChild(head);

    // relative-date quick options.
    const list = document.createElement("div");
    list.className = "oa-datepicker-list";
    dom.appendChild(list);

    const options = relativeDateOptions();

    // Replace the property's value with `value`. The live range comes from the field's stored
    // target (kept current by the StateField), so no re-derivation from the whole doc here.
    function insertValue(dateStr: string, close: boolean): void {
      const value = composeDateValue(kind, dateStr, timeInput?.value ?? "");
      if (!value) return;
      const t = view.state.field(field, false)?.open?.target;
      if (!t) {
        if (close) view.dispatch({ effects: dismissPicker.of(null) });
        return;
      }
      view.dispatch({
        changes: { from: t.valueFrom, to: t.valueTo, insert: value },
        selection: { anchor: t.valueFrom + value.length },
        ...(close ? { effects: dismissPicker.of(null) } : {}),
      });
      // Only pull focus back to the editor when we're done. For a datetime the popover stays
      // open after the date is set, so focus is left on the inputs to set the time next.
      if (close) view.focus();
    }

    const ctrl: PickerController = {
      rows: [],
      index: -1,
      setHighlight(i: number) {
        this.index = i;
        this.rows.forEach((r, idx) => r.classList.toggle("oa-popover-row--selected", idx === i));
      },
      pick(i: number) {
        const opt = options[i];
        if (opt) insertValue(opt.date, true);
      },
    };

    options.forEach((opt, i) => {
      const row = document.createElement("div");
      row.className = "oa-popover-row";
      const label = document.createElement("span");
      label.className = "oa-popover-label";
      label.textContent = opt.label;
      row.appendChild(label);
      const detail = document.createElement("span");
      detail.className = "oa-popover-detail";
      detail.textContent = opt.date;
      row.appendChild(detail);
      // mousedown + preventDefault → applying a row never blurs the editor.
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        insertValue(opt.date, true);
      });
      row.addEventListener("mouseenter", () => ctrl.setHighlight(i));
      list.appendChild(row);
      ctrl.rows.push(row);
    });

    // Native picker: applying immediately. A bare date closes; a datetime keeps the popover
    // open after the date so the time can still be set (and vice-versa).
    dateInput.addEventListener("change", () => insertValue(dateInput.value, kind === "date"));
    timeInput?.addEventListener("change", () => insertValue(dateInput.value, true));

    controllers.set(view, ctrl);
    return {
      dom,
      mount() {}, // don't scroll/reposition the editor when the popover mounts
      // The tooltip is reused (not remounted) while the caret stays on the same property, so
      // refresh the inputs in place when the underlying value is edited — but never steal
      // focus from an input the user is actively using.
      update(u) {
        if (!u.docChanged) return;
        const target = u.state.field(field, false)?.open?.target;
        if (!target) return;
        const pf = parseDateValue(target.current);
        if (document.activeElement !== dateInput) dateInput.value = pf.date || todayISO();
        if (timeInput && document.activeElement !== timeInput) timeInput.value = pf.time || nowHHMM();
      },
      destroy() {
        if (controllers.get(view) === ctrl) controllers.delete(view);
      },
    };
  }

  const field = StateField.define<PickerState>({
    create() {
      return { open: null, dismissed: null };
    },
    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(dismissPicker)) {
          return { open: null, dismissed: value.open?.target.sig ?? value.dismissed };
        }
      }
      // Only recompute when the caret or document actually changed.
      if (!tr.docChanged && !tr.selection) return value;

      const target = findDateTarget(
        tr.state.doc.toString(),
        tr.state.selection.main.head,
        getSchema(),
      );
      if (!target) return { open: null, dismissed: null };
      if (target.sig === value.dismissed) return { open: null, dismissed: value.dismissed };
      // Caret is on a fresh (un-dismissed) date property. Reuse the tooltip (no remount → the
      // native inputs keep focus/value) while it's the same property AT the same anchor; only
      // rebuild when the value's start position shifts so the tooltip's `pos` stays accurate.
      if (value.open && value.open.target.sig === target.sig && value.open.target.valueFrom === target.valueFrom) {
        return { open: { tooltip: value.open.tooltip, target }, dismissed: null };
      }
      return { open: { tooltip: makeTooltip(target), target }, dismissed: null };
    },
    provide: (f) => showTooltip.from(f, (v) => v.open?.tooltip ?? null),
  });

  const isOpen = (state: EditorState) => !!state.field(field, false)?.open;

  function move(view: EditorView, delta: number): boolean {
    if (!isOpen(view.state)) return false;
    const ctrl = controllers.get(view);
    if (!ctrl || ctrl.rows.length === 0) return false;
    const n = ctrl.rows.length;
    let i = ctrl.index + delta;
    if (i < 0) i = n - 1;
    else if (i >= n) i = 0;
    ctrl.setHighlight(i);
    return true;
  }

  const dateKeymap = Prec.highest(
    keymap.of([
      {
        key: "Escape",
        run: (view) => {
          if (!isOpen(view.state)) return false;
          view.dispatch({ effects: dismissPicker.of(null) });
          return true;
        },
      },
      { key: "ArrowDown", run: (view) => move(view, 1) },
      { key: "ArrowUp", run: (view) => move(view, -1) },
      {
        key: "Enter",
        run: (view) => {
          if (!isOpen(view.state)) return false;
          const ctrl = controllers.get(view);
          if (!ctrl || ctrl.index < 0) return false; // nothing highlighted → normal Enter
          ctrl.pick(ctrl.index);
          return true;
        },
      },
    ]),
  );

  return [field, dateKeymap];
}
