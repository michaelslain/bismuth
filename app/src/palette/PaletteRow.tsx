// app/src/palette/PaletteRow.tsx
// One row's anatomy — icon, label (with fuzzy-match highlighting), optional description,
// optional sublabel, optional shortcut — shared by the command/template palette
// (PaletteModal.tsx) and the in-window Cmd+O switcher's file rows (SwitcherBar.tsx). Extracted
// out of the former Palette.module.css so neither importer needs that stylesheet directly (one
// stylesheet, one importer): both compose THIS component instead.
import { Show, createMemo, For, type JSX } from 'solid-js'
import { Icon } from '../icons/Icon'
import Label from '../ui/Label'
import Text from '../ui/Text'
import { toSegments } from './rankItems'
import styles from './PaletteRow.module.css'

export type PaletteRowProps = {
    icon?: string
    label: JSX.Element
    desc?: JSX.Element
    sublabel?: JSX.Element
    shortcut?: JSX.Element
    selected?: boolean
    testid?: string
    class?: string
    onClick?: () => void
    onMouseMove?: (e: MouseEvent) => void
}

/** A single palette/switcher row: icon + label/desc column + sublabel + shortcut, all optional
 *  except `label`. `selected` drives the app-wide bare `.selected` keyboard-highlight class (see
 *  this module's stylesheet header for why it never hashes). */
function PaletteRow(props: PaletteRowProps) {
    return (
        <div
            class={`${styles['palette-row']} ${props.class ?? ''}`}
            classList={{ selected: props.selected }}
            data-testid={props.testid}
            onMouseMove={e => props.onMouseMove?.(e)}
            onClick={() => props.onClick?.()}
        >
            <Show when={props.icon}>
                <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    weight="inherit"
                    class={styles['palette-icon']}
                >
                    <Icon value={props.icon!} size={14} />
                </Text>
            </Show>
            <Text
                as="span"
                size="inherit"
                tone="inherit"
                weight="inherit"
                class={styles['palette-text']}
            >
                <Label fill class={styles['palette-label']}>
                    {props.label}
                </Label>
                <Show when={props.desc}>
                    <Text
                        as="span"
                        size="inherit"
                        tone="inherit"
                        weight="inherit"
                        class={styles['palette-desc']}
                    >
                        {props.desc}
                    </Text>
                </Show>
            </Text>
            <Show when={props.sublabel}>
                <Label tone="faint" class={styles['palette-sub']}>
                    {props.sublabel}
                </Label>
            </Show>
            <Show when={props.shortcut}>
                <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    weight="inherit"
                    class={`${styles['palette-shortcut']} row-kbd`}
                >
                    {props.shortcut}
                </Text>
            </Show>
        </div>
    )
}

export default PaletteRow

/** The row's own hashed class, for the one caller (PaletteModal.tsx) that needs to build a CSS
 *  selector string (`scrollSelectedIntoView`'s `.${paletteRowClass}.selected`) rather than apply
 *  the class directly — keeps that caller from importing PaletteRow.module.css itself. */
export const paletteRowClass = styles['palette-row']

/** Render a label with its fuzzy-matched characters highlighted. Shared by PaletteModal.tsx and
 *  SwitcherBar.tsx so both render identical highlighted rows. */
export function Highlight(p: { text: string; indices: number[] }) {
    const segments = createMemo(() => toSegments(p.text, p.indices))
    return (
        <For each={segments()}>
            {s =>
                s.match ? (
                    <Text
                        as="span"
                        size="inherit"
                        tone="inherit"
                        weight="inherit"
                        class={styles['palette-match']}
                    >
                        {s.text}
                    </Text>
                ) : (
                    <>{s.text}</>
                )
            }
        </For>
    )
}
