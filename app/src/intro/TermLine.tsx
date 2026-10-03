// One line of the intro's terminal panels. The line data type lives in TermPanel.tsx
// (`TermLineSpec`) next to the scripts that use it; this is the component that draws one.
//
// `props.line` is read at each use, never copied into a local at setup, so the Switch/Match over
// its kind keeps tracking it. (`const ln = props.line` reads the field once and silently keeps
// its first value; the old `Line` function in TermPanel did exactly that.)
import { Match, Show, Switch, type Component } from 'solid-js'
import Text from '../ui/Text'
import type { TermLineSpec } from './TermPanel'
import styles from './TermLine.module.css'

export type TermLineTone = 'prompt' | 'command' | 'reply' | 'accent' | 'ok' | 'live'

export type TermLineProps = {
    line: TermLineSpec
    class?: string
}

const toneClass = (tone: TermLineTone) => styles[`tone-${tone}`]

const TermLine: Component<TermLineProps> = props => {
    return (
        <Text as="span" inherit class={props.class}>
            <Switch>
                <Match when={'p' in props.line && props.line}>
                    {ln => (
                        <>
                            <Text as="span" inherit class={toneClass('prompt')}>
                                {ln().p}{' '}
                            </Text>
                            <Text as="span" inherit class={toneClass('command')}>
                                {ln().c}
                            </Text>
                        </>
                    )}
                </Match>
                <Match when={'user' in props.line && props.line}>
                    {ln => (
                        <>
                            <Text as="span" inherit class={toneClass('reply')}>
                                ›{' '}
                            </Text>
                            <Text as="span" inherit class={toneClass('command')}>
                                {ln().user}
                            </Text>
                        </>
                    )}
                </Match>
                <Match when={'status' in props.line && props.line}>
                    {ln => (
                        <>
                            <Text as="span" inherit class={toneClass('live')}>
                                ●
                            </Text>{' '}
                            <Text as="span" size="inherit" tone="muted" weight="inherit">
                                {ln().status}
                            </Text>
                        </>
                    )}
                </Match>
                <Match when={'d' in props.line && props.line}>
                    {ln => (
                        <Text as="span" inherit class={styles['term-row']}>
                            <Text as="span" inherit class={styles['term-left']}>
                                <Text as="span" size="inherit" tone="faint" weight="inherit">
                                    {ln().d}
                                </Text>
                                <Show when={ln().accent}>
                                    {' '}
                                    <Text as="span" inherit class={toneClass('accent')}>
                                        {ln().accent}
                                    </Text>
                                </Show>
                                <Show when={ln().dd}>
                                    <Text as="span" size="inherit" tone="faint" weight="inherit">
                                        {' '}
                                        {ln().dd}
                                    </Text>
                                </Show>
                            </Text>
                            <Show when={ln().ok}>
                                <Text as="span" inherit class={styles['term-leader']} />
                                <Text
                                    as="span"
                                    inherit
                                    class={`${styles['term-ok']} ${toneClass('ok')}`}
                                    data-term-ok=""
                                >
                                    {ln().ok}
                                </Text>
                            </Show>
                        </Text>
                    )}
                </Match>
            </Switch>
        </Text>
    )
}

export default TermLine
