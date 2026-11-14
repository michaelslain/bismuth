// app/src/chat/OpencodeLocalServerRow.tsx
// The provider manager's "connect a server" row: a server address, an optional key and `[connect]`.
// Pressing it asks core to probe the address (`api.opencodeAddServer`): a server that answers is saved
// in `.settings` and the row clears itself with a note `found N models // saved`; nothing answering or
// a server opencode already reaches leaves the inputs as typed and says so in the note. While the
// request is out the inputs are read-only and the button reads `connecting`. The saved servers
// themselves are the manager's local rows; this row only reports the new list through `onSaved`.
import { Show, createSignal, type Component } from 'solid-js'
import styles from './OpencodeLocalServerRow.module.css'
import Text from '../ui/Text'
import TextInput from '../ui/TextInput'
import ErrorText from '../ui/ErrorText'
import { TextButton } from '../ui/TextButton'
import { isConfirmKey } from '../ui/widgetKeys'
import {
    api,
    type OpencodeAddServerResult,
    type OpencodeProviderList,
} from '../api'

export type OpencodeLocalServerRowProps = {
    /** The provider list after a server was saved, for the manager to show. */
    onSaved: (list: OpencodeProviderList) => void
    /** Asks the server at `url` to be added. Defaults to `api.opencodeAddServer`; a story passes one
     *  that resolves on demand. */
    add?: (url: string, apiKey: string) => Promise<OpencodeAddServerResult>
    class?: string
}

const OpencodeLocalServerRow: Component<OpencodeLocalServerRowProps> = props => {
    const [url, setUrl] = createSignal('')
    const [key, setKey] = createSignal('')
    const [busy, setBusy] = createSignal(false)
    const [note, setNote] = createSignal<string | undefined>()
    const [error, setError] = createSignal<string | undefined>()

    const connect = async () => {
        const address = url().trim()
        if (!address || busy()) return
        setBusy(true)
        setNote(undefined)
        setError(undefined)
        try {
            const res = await (props.add ?? api.opencodeAddServer)(
                address,
                key().trim(),
            )
            if (res.outcome === 'saved') {
                const n = res.server.models
                setUrl('')
                setKey('')
                setNote(`found ${n} ${n === 1 ? 'model' : 'models'} // saved`)
                props.onSaved(res.list)
            } else if (res.outcome === 'nothing') {
                setNote(`nothing answered at ${res.url}`)
            } else {
                setNote(`already connected as ${res.name.toLowerCase()}`)
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setBusy(false)
        }
    }
    const onEnter = (e: KeyboardEvent) => {
        if (!isConfirmKey(e)) return
        e.preventDefault()
        void connect()
    }

    return (
        <div class={`${styles.root} ${props.class ?? ''}`}>
            <div class={styles.row}>
                <TextInput
                    class={styles.url}
                    value={url()}
                    onInput={setUrl}
                    placeholder="server url, e.g. http://127.0.0.1:1234"
                    aria-label="server url"
                    autocomplete="off"
                    spellcheck={false}
                    readOnly={busy()}
                    onKeyDown={onEnter}
                />
                <TextInput
                    class={styles.key}
                    type="password"
                    value={key()}
                    onInput={setKey}
                    placeholder="key (optional)"
                    aria-label="server key"
                    autocomplete="off"
                    spellcheck={false}
                    readOnly={busy()}
                    onKeyDown={onEnter}
                />
                <TextButton
                    class={styles.connect}
                    disabled={busy() || url().trim() === ''}
                    onClick={() => void connect()}
                >
                    {busy() ? 'connecting' : 'connect'}
                </TextButton>
            </div>
            <Show when={note()}>
                <Text as="div" size="ui" tone="muted" class={styles.note}>
                    {note()}
                </Text>
            </Show>
            <Show when={error()}>
                <ErrorText class={styles.note}>{error()}</ErrorText>
            </Show>
        </div>
    )
}

export default OpencodeLocalServerRow
