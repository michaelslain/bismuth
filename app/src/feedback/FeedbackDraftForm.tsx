// app/src/feedback/FeedbackDraftForm.tsx — FeedbackDraftForm.tsx is the ONLY importer of
// FeedbackDraftForm.module.css. The editable feedback draft: title, body, an optional reply-to, and
// the one `[ send ]`. Owns no state — the draft and the send status are the host's (FeedbackPage),
// so the interview's finished draft lands in the same form the user writes into.
import { Match, Show, Switch, type Component } from 'solid-js'
import SettingsField from '../ui/SettingsField'
import TextInput from '../ui/TextInput'
import TextButton from '../ui/TextButton'
import Text from '../ui/Text'
import ErrorText from '../ui/ErrorText'
import { draftProblem, type FeedbackDraft } from './feedbackLogic'
import styles from './FeedbackDraftForm.module.css'

export type FeedbackSendState =
    | { kind: 'idle' }
    | { kind: 'sending' }
    | { kind: 'sent' }
    | { kind: 'error'; message: string }

export type FeedbackDraftFormProps = {
    draft: FeedbackDraft
    onDraft: (patch: Partial<FeedbackDraft>) => void
    state: FeedbackSendState
    onSend: () => void
    /** After a send: clear the form for another one. */
    onReset: () => void
    class?: string
}

const FeedbackDraftForm: Component<FeedbackDraftFormProps> = props => {
    const problem = () => draftProblem(props.draft)
    const sending = () => props.state.kind === 'sending'
    return (
        <div class={`${styles.form} ${props.class ?? ''}`}>
            <Show
                when={props.state.kind !== 'sent'}
                fallback={
                    <div class={styles.footer}>
                        <Text size="ui">sent // thank you</Text>
                        <TextButton onClick={() => props.onReset()}>write another</TextButton>
                    </div>
                }
            >
                <SettingsField label="title">
                    <TextInput
                        value={props.draft.title}
                        onInput={title => props.onDraft({ title })}
                        placeholder="one line: what it is about"
                        disabled={sending()}
                    />
                </SettingsField>
                <SettingsField label="feedback">
                    <TextInput
                        multiline
                        rows={10}
                        value={props.draft.body}
                        onInput={body => props.onDraft({ body })}
                        placeholder="what works, what doesn't, what is missing"
                        disabled={sending()}
                    />
                </SettingsField>
                <SettingsField
                    label="reply to"
                    badge="optional"
                    hint="an email or handle, if you would like an answer"
                >
                    <TextInput
                        value={props.draft.contact}
                        onInput={contact => props.onDraft({ contact })}
                        disabled={sending()}
                    />
                </SettingsField>
                <div class={styles.footer}>
                    <Switch>
                        <Match when={props.state.kind === 'error' && props.state}>
                            {s => <ErrorText>{s().message}</ErrorText>}
                        </Match>
                        <Match when={sending()}>
                            <Text size="ui" tone="muted">
                                sending…
                            </Text>
                        </Match>
                        <Match when={problem()}>
                            {p => (
                                <Text size="ui" tone="faint">
                                    {p()}
                                </Text>
                            )}
                        </Match>
                        <Match when={true}>
                            <Text size="ui" tone="faint">
                                sent only when you press send
                            </Text>
                        </Match>
                    </Switch>
                    <TextButton
                        primary
                        disabled={!!problem() || sending()}
                        onClick={() => props.onSend()}
                    >
                        send
                    </TextButton>
                </div>
            </Show>
        </div>
    )
}

export default FeedbackDraftForm
