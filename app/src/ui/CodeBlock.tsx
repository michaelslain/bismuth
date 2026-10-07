import { splitProps, type JSX } from 'solid-js'
import styles from './CodeBlock.module.css'

export type CodeBlockProps = {
    children?: JSX.Element
    class?: string
    /** Drop the box chrome (fill, hairline border, padding, radius) and keep only the reset —
     *  mono face, wrapping, zero margin. A caller that supplies its own skin (a chart, a chat
     *  rail) says so here instead of overriding the chrome property by property. */
    bare?: boolean
} & Omit<
    JSX.HTMLAttributes<HTMLPreElement>,
    'children' | 'class'
>

/**
 * A `<pre>` for monospace block text. Its default look is built from tokens — a `--surface-1`
 * fill, a `--rule-soft` hairline, `--sp-4`/`--sp-5` padding, the app's mono token at
 * `--code-font-size` — and it wraps (`white-space: pre-wrap; overflow-wrap: anywhere`) so long
 * unbroken tokens don't blow out their container. Every default carries zero specificity, so a
 * caller's `class` (border, padding, background, color, max-height/overflow) always wins — but a
 * zero-specificity default also LEAKS: a caller class that sets only some properties inherits the
 * rest. So the chrome is opt-out: `bare` removes it wholesale, and any caller that brings its own
 * skin (or measures the element's box, as LineView's hover column does) passes it.
 */
function CodeBlock(props: CodeBlockProps) {
    const [local, rest] = splitProps(props, ['class', 'children', 'bare'])
    return (
        <pre
            class={`${styles['code-block']} ${local.bare ? '' : styles.chrome} ${local.class ?? ''}`}
            {...rest}
        >
            {local.children}
        </pre>
    )
}

export default CodeBlock
export { CodeBlock }
