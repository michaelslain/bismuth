// app/src/ui/ascii/Kbd.tsx
// Keybinding display: the command palette, the switcher, menu rows and the flashcard grades all
// build on this. A keybinding is TYPED, not drawn — one run of mono text per chord (`⌘K`,
// `⌘ shift 3`), no box, no border, no background — so it reads as a hint beside the chrome's
// typed structure rather than as a row of extra buttons.
import { For, Show, type JSX } from 'solid-js'
import { isGlyph, parseCombo, spaceBetween } from './parseCombo'
import styles from './Kbd.module.css'

/** One key label inside a chord. A sanctioned glyph (⌘ ⌥ ↵ ↑ ↓) is sized and set on the
 *  baseline to match the letters around it — the app font has none of them. */
export function Key(props: { children: string }) {
    return (
        <span
            class={isGlyph(props.children) ? styles.glyph : undefined}
            data-glyph={isGlyph(props.children) ? props.children : undefined}
        >
            {props.children}
        </span>
    )
}

export type KbdProps = {
    /** The app's keybinding syntax: "Mod+Shift+D", or "Mod+`, Mod+J" for alternatives (either fires). */
    combo?: string
    /** Literal content when you aren't passing a combo. */
    children?: JSX.Element
    /** Recede to --faint: inside a menu or palette row, or under a control it annotates. */
    muted?: boolean
    /** Render for a specific platform (⌘/⌥ vs ctrl/alt). Defaults to the running one. */
    mac?: boolean
    class?: string
}

/**
 * A keybinding. Pass `combo` in the app's syntax ("Mod+Shift+D") or literal children. A chord is
 * typed as one run — glyphs glue, a word key takes a space each side (`spaceBetween`); a
 * comma-separated list of ALTERNATIVES (either one fires the command, never press-this-then-
 * that) is joined by a faint "or". `data-kbd` is the element hook stories probe.
 */
function Kbd(props: KbdProps) {
    return (
        <span
            data-kbd
            class={`${styles.kbd} ${props.class ?? ''}`}
            classList={{ [styles.muted]: !!props.muted }}
        >
            <Show when={props.combo} fallback={props.children}>
                <For each={parseCombo(props.combo, props.mac)}>
                    {(keys, gi) => (
                        <>
                            <Show when={gi() > 0}>
                                <span class={styles.or}> or </span>
                            </Show>
                            <For each={keys}>
                                {(k, ki) => (
                                    <>
                                        {ki() > 0 &&
                                        spaceBetween(keys[ki() - 1], k)
                                            ? ' '
                                            : ''}
                                        <Key>{k}</Key>
                                    </>
                                )}
                            </For>
                        </>
                    )}
                </For>
            </Show>
        </span>
    )
}

export default Kbd
