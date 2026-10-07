// app/src/chat/FreeAgentSetup.tsx — the "set up free agent" block on the chat setup screen.
// Presentational: the caller owns the polling (ChatSetupGate via runFreeAgentSetup) and passes the
// current progress. Idle and error show buttons; every other phase shows one progress line.
import { Show, type Component } from 'solid-js'
import type { FreeAgentProgress } from '../../../core/src/freeAgent'
import { TextButton } from '../ui/TextButton'
import Text from '../ui/Text'
import ErrorText from '../ui/ErrorText'
import { freeAgentLine } from './freeAgentClient'
import styles from './FreeAgentSetup.module.css'

/** The one footnote every surface shows under the free-agent action. */
export const FREE_AGENT_COPY =
    'runs opencode on free models: no account, about 45 MB, prompts may be kept'

export type FreeAgentSetupProps = {
    progress: FreeAgentProgress
    onStart: () => void
    /** The start button lives elsewhere (the setup screen's agent row): idle shows only the copy
     *  line, error still shows `[try again]`, other phases the progress line as usual. */
    buttonless?: boolean
    /** The muted idle line. Defaults to the shared free-agent footnote. */
    copy?: string
    class?: string
}

const FreeAgentSetup: Component<FreeAgentSetupProps> = props => {
    const showButtons = () =>
        props.progress.phase === 'idle' || props.progress.phase === 'error'
    return (
        <div class={`${styles['free-agent']} ${props.class ?? ''}`}>
            <Show
                when={showButtons()}
                fallback={
                    <Text
                        tone="muted"
                        size="ui"
                        class={styles.progress}
                        role="status"
                    >
                        {freeAgentLine(props.progress)}
                    </Text>
                }
            >
                <Show
                    when={props.progress.phase === 'error'}
                    fallback={
                        <>
                            <Show when={!props.buttonless}>
                                <TextButton onClick={props.onStart}>
                                    set up free agent
                                </TextButton>
                            </Show>
                            <Text
                                tone="muted"
                                size="ui"
                                class={styles.copy}
                            >
                                {props.copy ?? FREE_AGENT_COPY}
                            </Text>
                        </>
                    }
                >
                    <ErrorText>{freeAgentLine(props.progress)}</ErrorText>
                    <TextButton onClick={props.onStart}>try again</TextButton>
                </Show>
            </Show>
        </div>
    )
}

export default FreeAgentSetup
