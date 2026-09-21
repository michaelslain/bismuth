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
import {
    showTooltip,
    keymap,
    EditorView,
    type Tooltip,
    type TooltipView,
} from '@codemirror/view'
import {
    StateField,
    StateEffect,
    Prec,
    type Extension,
    type EditorState,
} from '@codemirror/state'
import type { Schema } from '../../../core/src/schema/types'
import { todayISO } from '../../../core/src/dates'
import { relativeDateOptions } from './taskComplete'
import {
    findDateTarget,
    parseDateValue,
    composeDateValue,
    nowHHMM,
    type DateKind,
    type DateTarget,
} from './datePickerCore'
import { mountSolid, disposeSolid } from './solidWidget'
import DatePicker, { type DatePickerHandle } from './DatePicker'

// Force the picker closed (Escape, or after a pick). The dismissed target's sig is held in
// the field so it stays closed while the caret remains on the same property.
const dismissPicker = StateEffect.define<null>()

interface PickerState {
    /** The live target is kept here so insertValue + the refresh hook read it without
     *  re-deriving from the whole document on every interaction. `tooltip` identity is
     *  preserved across keystrokes (same key + valueFrom) so the native inputs don't remount. */
    open: { tooltip: Tooltip; target: DateTarget } | null
    /** Sig the user dismissed; suppresses reopening until the caret leaves that property. */
    dismissed: string | null
}

export function datePropertyPicker(getSchema: () => Schema): Extension {
    // One active handle per view (only one picker shows at a time) — the keymap commands below
    // only get the EditorView from CodeMirror, so they reach the rendered component through this.
    const handles = new WeakMap<EditorView, DatePickerHandle>()

    function makeTooltip(target: DateTarget): Tooltip {
        return {
            pos: target.valueFrom,
            above: false,
            arrow: false,
            create: view => buildPicker(view, target.kind, target.current),
        }
    }

    function buildPicker(
        view: EditorView,
        kind: DateKind,
        initial: string,
    ): TooltipView {
        const prefill = parseDateValue(initial)
        const options = relativeDateOptions()
        let lastDate = prefill.date || todayISO()
        let lastTime = prefill.time || nowHHMM()

        // Replace the property's value with `value`. The live range comes from the field's stored
        // target (kept current by the StateField), so no re-derivation from the whole doc here.
        function insertValue(dateStr: string, close: boolean): void {
            const value = composeDateValue(
                kind,
                dateStr,
                kind === 'datetime' ? lastTime : '',
            )
            if (!value) return
            const t = view.state.field(field, false)?.open?.target
            if (!t) {
                if (close) view.dispatch({ effects: dismissPicker.of(null) })
                return
            }
            view.dispatch({
                changes: { from: t.valueFrom, to: t.valueTo, insert: value },
                selection: { anchor: t.valueFrom + value.length },
                ...(close ? { effects: dismissPicker.of(null) } : {}),
            })
            // Only pull focus back to the editor when we're done. For a datetime the popover stays
            // open after the date is set, so focus is left on the inputs to set the time next.
            if (close) view.focus()
        }

        const dom = document.createElement('div')
        mountSolid(dom, () => (
            <DatePicker
                kind={kind}
                initialDate={prefill.date || todayISO()}
                initialTime={lastTime}
                options={options}
                onDateChange={(v, close) => {
                    lastDate = v
                    insertValue(v, close)
                }}
                onTimeChange={v => {
                    lastTime = v
                    insertValue(lastDate, true)
                }}
                onPick={i => {
                    const opt = options[i]
                    if (opt) insertValue(opt.date, true)
                }}
                handleRef={h => handles.set(view, h)}
            />
        ))

        return {
            dom,
            mount() {}, // don't scroll/reposition the editor when the popover mounts
            // The tooltip is reused (not remounted) while the caret stays on the same property, so
            // refresh the inputs in place when the underlying value is edited — but never steal
            // focus from an input the user is actively using (DatePicker.refresh enforces that).
            update(u) {
                if (!u.docChanged) return
                const target = u.state.field(field, false)?.open?.target
                if (!target) return
                const pf = parseDateValue(target.current)
                lastDate = pf.date || todayISO()
                lastTime = pf.time || lastTime
                handles.get(view)?.refresh(lastDate, lastTime)
            },
            destroy() {
                disposeSolid(dom)
                if (handles.get(view)) handles.delete(view)
            },
        }
    }

    const field = StateField.define<PickerState>({
        create() {
            return { open: null, dismissed: null }
        },
        update(value, tr) {
            for (const e of tr.effects) {
                if (e.is(dismissPicker)) {
                    return {
                        open: null,
                        dismissed: value.open?.target.sig ?? value.dismissed,
                    }
                }
            }
            // Only recompute when the caret or document actually changed.
            if (!tr.docChanged && !tr.selection) return value

            const target = findDateTarget(
                tr.state.doc.toString(),
                tr.state.selection.main.head,
                getSchema(),
            )
            if (!target) return { open: null, dismissed: null }
            if (target.sig === value.dismissed)
                return { open: null, dismissed: value.dismissed }
            // Caret is on a fresh (un-dismissed) date property. Reuse the tooltip (no remount → the
            // native inputs keep focus/value) while it's the same property AT the same anchor; only
            // rebuild when the value's start position shifts so the tooltip's `pos` stays accurate.
            if (
                value.open &&
                value.open.target.sig === target.sig &&
                value.open.target.valueFrom === target.valueFrom
            ) {
                return {
                    open: { tooltip: value.open.tooltip, target },
                    dismissed: null,
                }
            }
            return {
                open: { tooltip: makeTooltip(target), target },
                dismissed: null,
            }
        },
        provide: f => showTooltip.from(f, v => v.open?.tooltip ?? null),
    })

    const isOpen = (state: EditorState) => !!state.field(field, false)?.open

    function move(view: EditorView, delta: number): boolean {
        if (!isOpen(view.state)) return false
        return handles.get(view)?.moveHighlight(delta) ?? false
    }

    const dateKeymap = Prec.highest(
        keymap.of([
            {
                key: 'Escape',
                run: view => {
                    if (!isOpen(view.state)) return false
                    view.dispatch({ effects: dismissPicker.of(null) })
                    return true
                },
            },
            { key: 'ArrowDown', run: view => move(view, 1) },
            { key: 'ArrowUp', run: view => move(view, -1) },
            {
                key: 'Enter',
                run: view => {
                    if (!isOpen(view.state)) return false
                    // false (nothing highlighted) → fall through to normal Enter.
                    return handles.get(view)?.pickHighlighted() ?? false
                },
            },
        ]),
    )

    return [field, dateKeymap]
}
