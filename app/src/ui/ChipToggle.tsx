import type { Component, JSX } from 'solid-js'
import { Show, splitProps } from 'solid-js'
import { Button } from './Button'
import { Icon } from '../icons/Icon'
import styles from './ChipToggle.module.css'

export type ChipToggleTone = 'teal' | 'blue' | 'violet' | 'green' | 'gold' | 'rose'

export type ChipToggleProps = {
    selected?: boolean
    onToggle?: () => void
    /** Tints the SELECTED state's brackets + label to a category color instead of the default
     *  accent. Unset = accent. Passed through as Button's `accent` prop (a `var(--…)` token). */
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
 * power-up toggles. Composes `ui/Button` (`kind="text"`, the default) instead of rendering its
 * own `<button>` (one-button Task 8): the bracket glyphs, `--faint` unselected / accent selected
 * colouring and hover all come from Button.module.css now, none of it from a rule of ChipToggle's
 * own. `selected` maps to Button's `state` — always `"selected"` or `"unselected"`, never
 * `"normal"`, since a chip is always a toggle member — and `tone` maps to Button's `accent` prop
 * as a `var(--<tone>)` token, which `.btn--text.btn--selected` reads in place of the default
 * `--accent`. This merges the former `ui/Chip.tsx` (deleted, ds-bridges Task 3) — `icon`/
 * `iconSize` still render an `<Icon>` before `children`, same order Chip used; Button wraps both
 * inside its own `.textLabel` span (the `[icon label]` gap), same as `IconTextButton`.
 * Remaining native button attributes (`title`, `aria-*`, …) pass through onto the underlying
 * `<button>` — but `onClick` is NOT forwarded: click is owned via `onToggle`, so a caller-supplied
 * `onClick` is overridden by the component's own handler and never fires.
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
        <Button
            {...rest}
            state={local.selected ? 'selected' : 'unselected'}
            accent={local.tone ? `var(--${local.tone})` : undefined}
            class={[styles['chip-toggle'], local.class ?? ''].filter(Boolean).join(' ')}
            aria-pressed={!!local.selected}
            data-tone={local.tone}
            onClick={() => local.onToggle?.()}
        >
            <Show when={local.icon}>
                {i => <Icon value={i()} size={local.iconSize} />}
            </Show>
            {local.children}
        </Button>
    )
}

export default ChipToggle
