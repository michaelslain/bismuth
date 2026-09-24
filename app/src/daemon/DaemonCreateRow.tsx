// app/src/daemon/DaemonCreateRow.tsx
// The last row of a daemon list (crons, services): `+ new cron` / `+ new service`, lined up with
// the rows above it — the `+` in the dot column, the words in the name column — so the create
// action sits exactly where the thing it creates will appear, instead of floating in a panel
// head far from the list. Clicking it swaps the words for an inline name field in place (Enter
// creates, Esc cancels); a rejected create keeps the field open with its message trailing it.
//
// Like DaemonRow it is `grid-column: 1 / -1` + `subgrid`, so it only works as a direct child of a
// list grid (DaemonCrons.module.css / DaemonProcesses.module.css `.list`). Owns its own create
// state; the caller only supplies the words and the async create.
import { createSignal, Show } from 'solid-js'
import PlainButton from '../ui/PlainButton'
import InlineTextInput from '../ui/InlineTextInput'
import Label from '../ui/Label'
import Text from '../ui/Text'
import styles from './DaemonCreateRow.module.css'

export type DaemonCreateRowProps = {
    /** The row's words, e.g. `new service` — also the button's accessible name. The field is
     *  labelled `<label> name`. */
    label: string
    /** Rejects with an Error whose message is shown inline beside the still-open field. */
    onCreate: (name: string) => Promise<void>
    class?: string
}

function DaemonCreateRow(props: DaemonCreateRowProps) {
    const [creating, setCreating] = createSignal(false)
    const [error, setError] = createSignal<string | null>(null)
    const [draft, setDraft] = createSignal('')
    // InlineTextInput settles (commits or cancels) exactly once, then goes dead — so a rejected
    // create must remount a fresh input rather than reuse the settled one, or neither Enter
    // (retry) nor Esc (cancel) does anything afterwards.
    const [attempt, setAttempt] = createSignal(0)

    const start = () => {
        setDraft('')
        setError(null)
        setAttempt(0)
        setCreating(true)
    }
    const stop = () => {
        setCreating(false)
        setError(null)
    }

    async function commit(name: string): Promise<void> {
        if (!name) {
            stop()
            return
        }
        setError(null)
        try {
            await props.onCreate(name)
            stop()
        } catch (e) {
            setError((e as Error).message || "couldn't create")
            setDraft(name)
            setAttempt(a => a + 1)
        }
    }

    return (
        <div class={`${styles.row} ${props.class ?? ''}`} data-testid="daemon-create-row">
            <Label class={styles.plus} aria-hidden="true">
                +
            </Label>
            <Show
                when={creating()}
                fallback={
                    <PlainButton class={styles.button} onClick={start}>
                        <Label class={styles.label}>{props.label}</Label>
                    </PlainButton>
                }
            >
                <div class={styles.field}>
                    <Show when={attempt() + 1} keyed>
                        {_attempt => (
                            <InlineTextInput
                                value={draft()}
                                label={`${props.label} name`}
                                onCommit={name => void commit(name)}
                                onCancel={stop}
                            />
                        )}
                    </Show>
                    <Show when={error()}>
                        <Text as="span" size="micro" class={styles.error}>
                            {error()}
                        </Text>
                    </Show>
                </div>
            </Show>
        </div>
    )
}

export default DaemonCreateRow
