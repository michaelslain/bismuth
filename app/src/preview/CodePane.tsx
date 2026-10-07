// app/src/preview/CodePane.tsx — CodePane.tsx is the ONLY importer of CodePane.module.css.
// The read-only monospace body of a code/text preview, with find matches marked in place. Composes
// ui/CodeBlock (`bare` — it supplies its own skin) rather than a raw `<pre>`.
import { For, Show, type Component } from 'solid-js'
import CodeBlock from '../ui/CodeBlock'
import type { FindSegment } from './findMatches'
import styles from './CodePane.module.css'

export type CodePaneProps = {
    code: string
    /** The code split around its find matches; absent when no find is running. */
    segments?: FindSegment[]
    /** Which match is the active one (target of next/prev + scroll-into-view). */
    activeIndex: number
    /** The `<pre>`, for the caller's scroll-the-active-match-into-view query. */
    codeRef?: (el: HTMLPreElement) => void
}

const CodePane: Component<CodePaneProps> = props => (
    // Focusable (tabindex) so Cmd+F reaches the keydown handler on the preview root. The element
    // carries no ring of its own (nothing draws focus).
    <CodeBlock
        bare
        class={styles['preview-code']}
        tabindex={0}
        ref={el => props.codeRef?.(el)}
    >
        <Show when={props.segments} fallback={props.code}>
            <For each={props.segments!}>
                {seg =>
                    seg.matchIndex >= 0 ? (
                        <mark
                            class={styles['preview-find-match']}
                            classList={{
                                [styles['is-active']]:
                                    seg.matchIndex === props.activeIndex,
                            }}
                            data-find-match
                            data-active={
                                seg.matchIndex === props.activeIndex
                                    ? true
                                    : undefined
                            }
                        >
                            {seg.text}
                        </mark>
                    ) : (
                        seg.text
                    )
                }
            </For>
        </Show>
    </CodeBlock>
)

export default CodePane
