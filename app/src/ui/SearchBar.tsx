import { splitProps, type JSX } from 'solid-js'
import Text from './Text'
import { isConfirmKey } from './widgetKeys'
import styles from './SearchBar.module.css'

export type SearchBarSize = 'compact' | 'default' | 'large'

export type SearchBarProps = {
    value: string
    onInput: (value: string) => void
    placeholder?: string
    /** Density: `compact` (panels, popovers, find bars), `default`, `large` (palette + switcher). */
    size?: SearchBarSize
    /** The terminal prompt glyph leading the input — `/` by default, `>` for command entry. */
    prompt?: string
    /** Convenience: called on the confirm key (Enter by default, settings.keybindings['ui-confirm']).
     *  Ignored if `onKeyDown` is provided (use that for full key handling). */
    onEnter?: () => void
    /** Full keydown passthrough on the input — for list-navigation search boxes (arrows/escape/enter). Takes precedence over `onEnter`. */
    onKeyDown?: (e: KeyboardEvent) => void
    autofocus?: boolean
    inputRef?: (el: HTMLInputElement) => void
    /** Accessible name for the input, when the placeholder alone isn't enough (e.g. a find-in-file
     *  bar whose placeholder is the terse "Find"). Passed straight through to the `<input>`. */
    'aria-label'?: string
    /** Trailing adornments (toggles, buttons) rendered after the input. */
    children?: JSX.Element
    /** Class on the outer `.search-bar` wrapper. Layout only (position, width, margin) — never
     *  font, colour, padding, border or background; the field's own look lives in this
     *  component's stylesheet. */
    class?: string
}

function SearchBar(props: SearchBarProps) {
    const [local] = splitProps(props, [
        'value',
        'onInput',
        'placeholder',
        'size',
        'prompt',
        'onEnter',
        'onKeyDown',
        'autofocus',
        'inputRef',
        'aria-label',
        'children',
        'class',
    ])
    return (
        <div
            class={`${styles['search-bar']} ${local.class ?? ''}`.trim()}
            data-size={local.size ?? 'default'}
        >
            <Text
                as="span"
                size="inherit"
                tone="inherit"
                weight="inherit"
                class={styles['search-bar-lead']}
                aria-hidden="true"
            >
                {local.prompt ?? '/'}
            </Text>
            <input
                ref={local.inputRef}
                class={styles['search-bar-input']}
                placeholder={local.placeholder}
                aria-label={local['aria-label']}
                value={local.value}
                autofocus={local.autofocus}
                onInput={e => local.onInput(e.currentTarget.value)}
                onKeyDown={e => {
                    if (local.onKeyDown) local.onKeyDown(e)
                    else if (isConfirmKey(e)) local.onEnter?.()
                }}
            />
            {local.children && (
                <div class={styles['search-bar-trailing']}>
                    {local.children}
                </div>
            )}
        </div>
    )
}

export default SearchBar
