import { splitProps, type JSX } from 'solid-js'
import styles from './CodeBlock.module.css'

export type CodeBlockProps = { children?: JSX.Element; class?: string } & Omit<
    JSX.HTMLAttributes<HTMLPreElement>,
    'children' | 'class'
>

/**
 * A `<pre>` reset for monospace block text — no margin, the app's mono token, and wrapping
 * (`white-space: pre-wrap; overflow-wrap: anywhere`) so long unbroken tokens don't blow out
 * their container. Everything else (border, padding, background, color, max-height/overflow)
 * comes from the caller's `class`.
 */
function CodeBlock(props: CodeBlockProps) {
    const [local, rest] = splitProps(props, ['class', 'children'])
    return (
        <pre class={`${styles['code-block']} ${local.class ?? ''}`} {...rest}>
            {local.children}
        </pre>
    )
}

export default CodeBlock
export { CodeBlock }
