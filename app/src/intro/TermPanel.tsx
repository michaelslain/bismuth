// The intro's static terminal panels — plain ASCII terminal chrome (a bracketed session tab and a
// blinking <Caret /> underline) rather than macOS traffic-light dots and a glow cursor, so the
// first-run screen speaks the same visual language as the app behind it. Every colour comes from
// the theme CSS vars, so the intro's own theme picker re-themes all of it live.
//
// Split out of intro/marks.tsx (visual-unification audit §6/§9.8), which was a camelCase file
// exporting four PascalCase components.
//
// THE TWO WRAPPERS ARE GONE, deliberately. `DaemonStage()` and `ClaudeStage()` were one-line
// components that returned <TermPanel> with a fixed name and a fixed line list — i.e. two VARIANTS
// expressed as two components, which the house rules call out ("variants as props, not new files").
// The lines are exported as data instead, and the call site passes them. That also makes the panel
// storyable with arbitrary content rather than only in its two shipped configurations.
import { For, type Component } from 'solid-js'
import Caret from '../ui/Caret'
import Text from '../ui/Text'
import TermLine from './TermLine'
import styles from './TermPanel.module.css'

// Renamed from `TermLine`: that name is now the component that draws one of these (TermLine.tsx).
export type TermLineSpec =
    | { p: string; c: string }
    | { user: string }
    | { status: string }
    | { d: string; accent?: string; dd?: string; ok?: string }

export const DAEMON_LINES: TermLineSpec[] = [
    { p: '~/vault', c: '❯ bismuth daemon status' },
    { d: '∴ crons', dd: '// 4 scheduled', ok: 'running' },
    { d: '∴ weaving memory into graph', ok: '+12 edges' },
    { d: '∴ surfaced', accent: '3 forgotten notes', dd: 'from “last spring”' },
    { status: 'daemon online // tending the vault' },
]
export const AGENT_LINES: TermLineSpec[] = [
    { p: '~/vault', c: '❯ claude' },
    { user: 'make a base of my unread books, by rating' },
    { d: '∴ bismuth_docs_search', accent: '“bases // query syntax”' },
    { d: '∴ writing reading.md', dd: '// type: base' },
    { status: 'created base // table view // 23 rows' },
]

export type TermPanelProps = {
    /** Text in the bracketed session tab. */
    name: string
    lines: TermLineSpec[]
    class?: string
}

/** The trailing prompt, drawn by the same component as every other line so its colours stay one
 *  mapping. Hoisted: it never changes. */
const PROMPT: TermLineSpec = { p: '~/vault ❯', c: '' }

const TermPanel: Component<TermPanelProps> = props => {
    return (
        <div class={`${styles['vi-term']}${props.class ? ` ${props.class}` : ''}`}>
            {/* Bracket session tab — the terminal chrome's own vocabulary (Terminal.tsx /
          bismuth-design/ascii-extended's view-terminal.card.html: "[ 1 zsh ]"), not tab shapes
          or macOS traffic-light dots. */}
            <div class={styles['vi-term-bar']}>
                <Text as="span" inherit class={styles['vi-term-tab']}>
                    [ {props.name} ]
                </Text>
            </div>
            <div class={styles['vi-term-body']}>
                <For each={props.lines}>
                    {(ln, i) => (
                        <div
                            class={styles['vi-term-line']}
                            style={{
                                'animation-delay': `${0.15 + i() * 0.28}s`,
                            }}
                        >
                            <TermLine line={ln} />
                        </div>
                    )}
                </For>
                <div
                    class={styles['vi-term-line']}
                    style={{
                        'animation-delay': `${0.15 + props.lines.length * 0.28}s`,
                    }}
                >
                    <TermLine line={PROMPT} />
                    <Caret />
                </div>
            </div>
        </div>
    )
}

export default TermPanel
