import type { Component, JSX } from 'solid-js'
import { Show, splitProps } from 'solid-js'
import { Icon } from '../icons/Icon'
import styles from './ChipToggle.module.css'

export type ChipToggleTone = 'teal' | 'blue' | 'violet' | 'green' | 'gold' | 'rose'

export type ChipToggleProps = {
    selected?: boolean
    onToggle?: () => void
    /** Tints the SELECTED state to a category color (14% fill / 45% border) instead of
     *  the default accent. Unset = accent. */
    tone?: ChipToggleTone
    /** Icon name from the registry, rendered before the label (Chip's old `icon`). */
    icon?: string
    iconSize?: number
    class?: string
    /** Optional so an icon-only chip (e.g. a Regex toggle with just a title) needs no label —
     *  Chip.tsx's `children` was optional for the same reason. */
    children?: JSX.Element
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>

/**
 * A selectable `[label]` bracket toggle — export options, search toggles, the vault-intro
 * power-up toggles. No box: the brackets are generated content in ChipToggle.module.css,
 * tinted with the label (selected = accent or `tone`, unselected = `--faint`), the same
 * register as SegmentedToggle's bracket look. `.chip-toggle` (+ `.selected`, `.tone-<x>`) are
 * hashed module locals — nothing outside this file reaches them; a caller composing its own
 * look layers a class onto the `class` prop instead (see KanbanCard.module.css's
 * `.kbMetaBoolChipToggle`). This merges the former `ui/Chip.tsx` (deleted, ds-bridges Task 3) —
 * `icon`/`iconSize` render an `<Icon>` before `children`, same order and gap Chip used.
 * Remaining native button attributes (`title`, `aria-*`, …) pass through via `splitProps` onto
 * the underlying `<button>` — but `onClick` is NOT forwarded: click is owned via `onToggle`, so
 * a caller-supplied `onClick` is overridden by the component's own handler and never fires.
 */
const ChipToggle: Component<ChipToggleProps> = props => {
    const [local, rest] = splitProps(props, [
        'selected',
        'onToggle',
        'tone',
        'icon',
        'iconSize',
        'class',
        'children',
    ])
    return (
        <button
            type="button"
            {...rest}
            class={[
                styles['chip-toggle'],
                local.selected ? styles.selected : '',
                local.tone ? styles[`tone-${local.tone}`] : '',
                local.class ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
            aria-pressed={!!local.selected}
            data-tone={local.tone}
            onClick={() => local.onToggle?.()}
        >
            <Show when={local.icon}>
                {i => <Icon value={i()} size={local.iconSize} />}
            </Show>
            {local.children}
        </button>
    )
}

export default ChipToggle
