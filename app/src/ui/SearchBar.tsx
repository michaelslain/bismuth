import { splitProps, type JSX } from 'solid-js'
import { Icon } from '../icons/Icon'
import { isIconName } from '../icons/registry'
import { warnBadIcon } from './devWarn'
import { isConfirmKey } from './widgetKeys'
import styles from './SearchBar.module.css'

export type SearchBarProps = {
    value: string
    onInput: (value: string) => void
    placeholder?: string
    /** Convenience: called on the confirm key (Enter by default, settings.keybindings['ui-confirm']).
     *  Ignored if `onKeyDown` is provided (use that for full key handling). */
    onEnter?: () => void
    /** Full keydown passthrough on the input — for list-navigation search boxes (arrows/escape/enter). Takes precedence over `onEnter`. */
    onKeyDown?: (e: KeyboardEvent) => void
    leadingIcon?: string
    autofocus?: boolean
    inputRef?: (el: HTMLInputElement) => void
    /** Accessible name for the input, when the placeholder alone isn't enough (e.g. a find-in-file
     *  bar whose placeholder is the terse "Find"). Passed straight through to the `<input>`. */
    'aria-label'?: string
    /** Trailing adornments (toggles, buttons) rendered after the input. */
    children?: JSX.Element
    /** Class on the outer `.search-bar` wrapper. */
    class?: string
    /** Extra class on the leading icon (for call-site-specific lead styling). */
    leadClass?: string
    /** Extra class on the inner `<input>` (for call-site-specific input styling). */
    inputClass?: string
    /** Inline style on the inner `<input>`. */
    inputStyle?: JSX.CSSProperties | string
}

function SearchBar(props: SearchBarProps) {
    const [local] = splitProps(props, [
        'value',
        'onInput',
        'placeholder',
        'onEnter',
        'onKeyDown',
        'leadingIcon',
        'autofocus',
        'inputRef',
        'aria-label',
        'children',
        'class',
        'leadClass',
        'inputClass',
        'inputStyle',
    ])
    if (
        import.meta.env?.DEV &&
        local.leadingIcon &&
        !isIconName(local.leadingIcon)
    ) {
        warnBadIcon('SearchBar', local.leadingIcon)
    }
    return (
        <div class={`${styles['search-bar']} ${local.class ?? ''}`.trim()}>
            <Icon
                value={local.leadingIcon ?? 'Search'}
                size={14}
                class={`${styles['search-bar-lead']} ${local.leadClass ?? ''}`.trim()}
            />
            <input
                ref={local.inputRef}
                class={`${styles['search-bar-input']} ${local.inputClass ?? ''}`.trim()}
                style={local.inputStyle}
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
            {local.children}
        </div>
    )
}

export default SearchBar
