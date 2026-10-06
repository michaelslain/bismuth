// The begin slide's prompt line: `> open vault`. Mono (the ui face), one line. No caret of its own:
// the wordmark above it already carries the brand cursor, and a screen has one cursor.
import type { Component } from 'solid-js'
import Text from '../ui/Text'
import styles from './IntroPrompt.module.css'

export type IntroPromptProps = {
    text: string
    className?: string
}

const IntroPrompt: Component<IntroPromptProps> = props => {
    return (
        <Text
            as="div"
            size="body"
            class={`${styles['intro-prompt']}${props.className ? ` ${props.className}` : ''}`}
        >
            <Text as="span" inherit class={styles.mark}>
                &gt;
            </Text>{' '}
            {props.text}
        </Text>
    )
}

export default IntroPrompt
