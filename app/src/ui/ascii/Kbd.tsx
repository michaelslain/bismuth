// app/src/ui/ascii/Kbd.tsx
// Keybinding display: the command palette, overlay footers, menu rows, and the
// status bar all build on this. A keybinding is a run of individual caps
// (`.asc-key`), not one box — adjacency is the chord. Ported from
// design-system/components/display/Kbd.jsx.
import { For, Show, type JSX } from 'solid-js'
import { parseCombo } from './parseCombo'
import styles from './Kbd.module.css'

/** One key cap. */
export function Key(props: { children?: JSX.Element }) {
    return <span class="asc-key">{props.children}</span>
}

export type KbdProps = {
    /** The app's keybinding syntax: "Mod+Shift+D", or "Mod+`, Mod+J" for alternatives (either fires). */
    combo?: string
    /** Literal cap content when you aren't passing a combo. */
    children?: JSX.Element
    muted?: boolean
}

/**
 * A keybinding. Pass `combo` in the app's syntax ("Mod+Shift+D") or literal
 * children. Chords render as adjacent caps; a comma-separated list of
 * ALTERNATIVES (either one fires the command, never press-this-then-that)
 * renders its groups separated by a faint "or".
 */
function Kbd(props: KbdProps) {
    return (
        <span class="asc-kbd" classList={{ muted: !!props.muted }}>
            <Show when={props.combo} fallback={props.children}>
                <For each={parseCombo(props.combo)}>
                    {(keys, gi) => (
                        <>
                            <Show when={gi() > 0}>
                                <span class={styles['asc-kbd-then']}>or</span>
                            </Show>
                            <For each={keys}>{k => <Key>{k}</Key>}</For>
                        </>
                    )}
                </For>
            </Show>
        </span>
    )
}

export default Kbd
