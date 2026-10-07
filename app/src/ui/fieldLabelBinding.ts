// app/src/ui/fieldLabelBinding.ts
// Binds a SettingsField's <label> to the control rendered inside it, so a screen reader reaches the
// label and a click on the label reaches the control. Plain DOM, no framework imports: the field's
// children are arbitrary (a TextInput, a Select, a raw input, a CodeMirror host), so the binding is
// made on the rendered element rather than threaded through every control's props.
//
// Two bindings, chosen by what the control is:
//  - a native text entry (input / textarea / select) gets a real `<label for>` → `control.labels`
//    resolves, the label click focuses it, and the accessible name is the label text;
//  - a Select trigger (a button whose own text is its VALUE) and a contenteditable host get
//    `aria-labelledby` — for the trigger "<label> <value>", so the value is not lost under the name.
// Ordinary buttons (a SegmentedToggle's members) are never targeted: they carry their own name.
// Only the FIRST control is bound — a field naming two controls the same would be worse than one.
// A control that already carries `aria-label`/`aria-labelledby` keeps it: the caller named it.

const TARGET =
    'input:not([type="hidden"]), textarea, select, [data-select-trigger], [contenteditable=""], [contenteditable="true"]'

const NATIVE = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** Bind `label` to the first control in `control`, and keep it bound as controls mount/unmount.
 *  `label` must already carry an `id`. Returns the cleanup. */
export function observeFieldLabel(
    label: HTMLLabelElement,
    control: HTMLElement,
    required: () => boolean,
): () => void {
    let bound: HTMLElement | null = null
    let added: string[] = []

    const release = () => {
        if (!bound) return
        for (const a of added) bound.removeAttribute(a)
        label.removeAttribute('for')
        bound = null
        added = []
    }
    const set = (el: HTMLElement, name: string, value: string) => {
        el.setAttribute(name, value)
        added.push(name)
    }
    const claim = () => {
        const target = control.querySelector<HTMLElement>(TARGET)
        if (target === bound) return
        release()
        if (!target) return
        bound = target
        const named =
            target.hasAttribute('aria-label') ||
            target.hasAttribute('aria-labelledby')
        if (!target.id && (NATIVE.has(target.tagName) || !named)) {
            target.id = `${label.id}-control`
            added.push('id')
        }
        if (NATIVE.has(target.tagName)) {
            label.htmlFor = target.id
        } else if (!named) {
            const isButton = target.tagName === 'BUTTON'
            set(
                target,
                'aria-labelledby',
                isButton ? `${label.id} ${target.id}` : label.id,
            )
        }
        if (required() && target.tagName !== 'BUTTON') {
            set(target, 'aria-required', 'true')
        }
    }

    claim()
    const mo = new MutationObserver(claim)
    mo.observe(control, { childList: true, subtree: true })
    return () => {
        mo.disconnect()
        release()
    }
}
