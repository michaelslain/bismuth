import { For, Show, splitProps, type JSX } from 'solid-js'
import { tagHighlighter, tags as t } from '@lezer/highlight'
import { codeTokens, type CodeLanguage } from './codeTokens'
import styles from './CodeBlock.module.css'

// Token colours for a `language` block: the editor's code palette (editor/codeHighlight.ts), keys
// in the accent and plain values in the foreground as the editor's frontmatter shows them.
const highlighter = tagHighlighter([
    { tag: [t.propertyName, t.attributeName], class: styles['tok-key'] },
    { tag: [t.string, t.special(t.string)], class: styles['tok-string'] },
    { tag: [t.number, t.integer, t.float, t.bool, t.atom], class: styles['tok-number'] },
    { tag: [t.comment, t.lineComment, t.blockComment], class: styles['tok-comment'] },
    { tag: t.keyword, class: styles['tok-keyword'] },
    { tag: t.heading, class: styles['tok-heading'] },
    {
        tag: [t.meta, t.separator, t.punctuation, t.squareBracket, t.brace, t.processingInstruction],
        class: styles['tok-punct'],
    },
])

export type CodeBlockProps = {
    children?: JSX.Element
    class?: string
    /** Drop the box chrome (fill, hairline border, padding, radius) and keep only the reset —
     *  mono face, wrapping, zero margin. A caller that supplies its own skin (a chart, a chat
     *  rail) says so here instead of overriding the chrome property by property. */
    bare?: boolean
    /** Syntax-highlight `children` (a string) as this language, in the editor's code colours. */
    language?: CodeLanguage
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
    const [local, rest] = splitProps(props, [
        'class',
        'children',
        'bare',
        'language',
    ])
    const source = () =>
        local.language && typeof local.children === 'string'
            ? { code: local.children, language: local.language }
            : undefined
    return (
        <pre
            class={`${styles['code-block']} ${local.bare ? '' : styles.chrome} ${local.class ?? ''}`}
            {...rest}
        >
            <Show when={source()} fallback={local.children}>
                {src => (
                    <For each={codeTokens(src().code, src().language, highlighter)}>
                        {tok => (tok.cls ? <span class={tok.cls}>{tok.text}</span> : tok.text)}
                    </For>
                )}
            </Show>
        </pre>
    )
}

export default CodeBlock
export { CodeBlock }
