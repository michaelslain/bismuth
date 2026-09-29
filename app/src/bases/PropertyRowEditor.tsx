import { createEffect, Show, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import Select from '../ui/Select'
import Text from '../ui/Text'
import { TextInput } from '../ui/TextInput'
import { IconButton } from '../ui/IconButton'
import PlainButton from '../ui/PlainButton'
import RemoveRowButton from '../ui/RemoveRowButton'
import SettingsField from '../ui/SettingsField'
import SettingsHint from '../ui/SettingsHint'
import {
    BASE_PROPERTY_KINDS,
    NUMBER_FORMATS,
} from '../../../core/src/bases/types'
import type {
    BasePropertyKind,
    NumberFormat,
} from '../../../core/src/bases/types'
import { capitalize } from './columnKinds'
import type { PropertyFormRow } from './basePropertiesForm'
import styles from './PropertyRowEditor.module.css'

export type PropertyRowEditorProps = {
    row: PropertyFormRow
    /** The row's expanded editor is showing. */
    open: boolean
    /** Another row above shares this row's name — only the first is saved. */
    duplicate: boolean
    isFirst: boolean
    isLast: boolean
    onToggleOpen: () => void
    onChange: (patch: Partial<PropertyFormRow>) => void
    onMove: (dir: -1 | 1) => void
    onRemove: () => void
    class?: string
}

const KIND_OPTS = BASE_PROPERTY_KINDS.map(k => ({
    value: k,
    label: capitalize(k),
}))
const NUMBER_FORMAT_OPTS = NUMBER_FORMATS.map(f => ({
    value: f,
    label: capitalize(f),
}))

/** One declared property: a quiet name / type / visibility line that expands into its full editor
 *  (name, kind, type-specific extras, reorder, remove). */
const PropertyRowEditor: Component<PropertyRowEditorProps> = props => {
    let rowEl: HTMLDivElement | undefined
    // The list scrolls inside <ModalBody>, but nothing scrolled a newly-expanded row into that
    // window — its freshly-grown body sat under the modal's pinned footer. Scroll the row into
    // view whenever it opens. Deferred a frame: this fires as soon as `open` flips, BEFORE the
    // <Show> below has inserted and laid out the body.
    createEffect(() => {
        if (!props.open) return
        requestAnimationFrame(() => {
            if (props.open) rowEl?.scrollIntoView({ block: 'nearest' })
        })
    })
    return (
        <div
            ref={rowEl}
            class={`${styles.row} ${props.open ? styles.open : ''} ${props.class ?? ''}`}
        >
            <PlainButton
                class={styles.head}
                aria-expanded={props.open}
                onClick={() => props.onToggleOpen()}
            >
                <Icon
                    value="chevron-right"
                    class={styles.chev}
                    strokeWidth={2}
                />
                <Text
                    as="span"
                    inherit
                    class={styles.nameTxt}
                    classList={{ [styles.empty]: !props.row.name }}
                >
                    {props.row.name || 'untitled property'}
                </Text>
                <Text as="span" inherit class={styles.kind}>
                    {props.row.kind}
                </Text>
                <IconButton
                    icon={props.row.hidden ? 'eye-off' : 'eye'}
                    label={
                        props.row.hidden
                            ? `Show ${props.row.name || 'property'} on cards/table`
                            : `Hide ${props.row.name || 'property'} from cards/table`
                    }
                    title={
                        props.row.hidden
                            ? 'Hidden from cards/table — click to show'
                            : 'Visible on cards/table — click to hide'
                    }
                    class={styles.eye}
                    onClick={e => {
                        e.stopPropagation()
                        props.onChange({ hidden: !props.row.hidden })
                    }}
                />
            </PlainButton>

            <Show when={props.open}>
                <div class={styles.body}>
                    <div class={styles.fields}>
                        <SettingsField label="name" span>
                            <TextInput
                                value={props.row.name}
                                placeholder="property name"
                                onInput={v => props.onChange({ name: v })}
                            />
                            <Show when={props.duplicate}>
                                <SettingsHint class={styles.dupe}>
                                    duplicate name // only the first is saved
                                </SettingsHint>
                            </Show>
                        </SettingsField>
                        <SettingsField label="kind" span>
                            <Select
                                value={props.row.kind}
                                options={KIND_OPTS}
                                onChange={v =>
                                    props.onChange({
                                        kind: v as BasePropertyKind,
                                    })
                                }
                            />
                        </SettingsField>
                    </div>

                    <Show
                        when={
                            props.row.kind === 'select' ||
                            props.row.kind === 'multiselect'
                        }
                    >
                        <TextInput
                            class={`${styles.extra} ${styles.options}`}
                            multiline
                            value={props.row.optionsText}
                            placeholder="options — one per line or comma-separated (e.g. todo, doing, done)"
                            onInput={v => props.onChange({ optionsText: v })}
                        />
                    </Show>

                    <Show when={props.row.kind === 'number'}>
                        <div class={`${styles.extra} ${styles.numrow}`}>
                            <SettingsField
                                label="format"
                                class={styles.numrowUnit}
                            >
                                <Select
                                    value={props.row.number}
                                    options={NUMBER_FORMAT_OPTS}
                                    onChange={v =>
                                        props.onChange({
                                            number: v as NumberFormat,
                                        })
                                    }
                                />
                            </SettingsField>
                            <Show
                                when={
                                    props.row.number === 'unit' ||
                                    props.row.number === 'currency'
                                }
                            >
                                <TextInput
                                    value={props.row.unit}
                                    placeholder={
                                        props.row.number === 'currency'
                                            ? 'currency code (e.g. USD)'
                                            : 'unit label (e.g. kg)'
                                    }
                                    onInput={v => props.onChange({ unit: v })}
                                    class={styles.numrowUnit}
                                />
                            </Show>
                        </div>
                    </Show>

                    <Show when={props.row.kind === 'formula'}>
                        <TextInput
                            class={styles.extra}
                            value={props.row.expr}
                            placeholder="expression, e.g. note.qty * note.price"
                            onInput={v => props.onChange({ expr: v })}
                        />
                    </Show>

                    <Show when={props.row.kind !== 'formula'}>
                        <TextInput
                            class={styles.extra}
                            value={props.row.defaultText}
                            placeholder="default value (optional)"
                            onInput={v => props.onChange({ defaultText: v })}
                        />
                    </Show>

                    <div class={styles.foot}>
                        <IconButton
                            icon="ArrowUp"
                            label="Move up"
                            class={styles.btn}
                            disabled={props.isFirst}
                            onClick={() => props.onMove(-1)}
                        />
                        <IconButton
                            icon="ArrowDown"
                            label="Move down"
                            class={styles.btn}
                            disabled={props.isLast}
                            onClick={() => props.onMove(1)}
                        />
                        <div class={styles.spacer} />
                        <RemoveRowButton
                            label="Remove property"
                            onClick={() => props.onRemove()}
                        />
                    </div>
                </div>
            </Show>
        </div>
    )
}

export default PropertyRowEditor
