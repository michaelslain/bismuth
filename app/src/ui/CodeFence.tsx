// app/src/ui/CodeFence.tsx — CodeFence.module.css is the ONLY importer of its module.
//
// A fenced code block inside rendered markdown HTML (a chat message): the block's box with
// CodeHeader on top — the same ```lang label and copy button a note's live preview shows over the
// same fence — and the `<pre>` marked renders under it. The `<pre>` arrives as an existing element
// (codeFences.ts adopts it out of the innerHTML string), so it is a prop, not children.
import type { Component } from 'solid-js'
import CodeHeader from './CodeHeader'
import styles from './CodeFence.module.css'

export type CodeFenceProps = {
    /** marked's `<pre><code class="language-x">` for one fence. */
    pre: HTMLPreElement
    class?: string
}

/** The fence's info string, from marked's `language-<lang>` class; '' for a bare fence. */
export function fenceLang(pre: HTMLPreElement): string {
    const code = pre.querySelector('code')
    return /(?:^|\s)language-(\S+)/.exec(code?.className ?? '')?.[1] ?? ''
}

/** The fence's code as written: marked keeps the newline before the closing ```, the editor's
 *  copy does not, so it is trimmed here to copy the same text from either surface. */
export function fenceBody(pre: HTMLPreElement): string {
    return (pre.textContent ?? '').replace(/\n$/, '')
}

const CodeFence: Component<CodeFenceProps> = props => {
    return (
        <div class={`${styles.fence} ${props.class ?? ''}`} data-code-fence>
            <div class={styles.head}>
                <CodeHeader lang={fenceLang(props.pre)} body={fenceBody(props.pre)} />
            </div>
            <div class={styles.body}>{props.pre}</div>
        </div>
    )
}

export default CodeFence
