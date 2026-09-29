import { createMemo, createSignal, Index, onMount, Show, type Component } from 'solid-js'
import { api } from '../api'
import { TextButton } from '../ui/TextButton'
import { Loading } from '../ui/EmptyState'
import Text from '../ui/Text'
import TextInput from '../ui/TextInput'
import styles from './BaseSourceEditor.module.css'

export type BaseSourceEditorProps = {
    /** The base file to edit. */
    path: string
    /** Fires after save AND after cancel — BaseView refetches on it either way. */
    onClose: () => void
}

/** Raw source editor for a base file — a textarea + Save, used by the per-view Source toggle.
 *  (Embedded ```query blocks edit their fence inline in the editor instead.) */
const BaseSourceEditor: Component<BaseSourceEditorProps> = props => {
    const [text, setText] = createSignal<string | null>(null)
    let gutter: HTMLDivElement | undefined
    onMount(async () => setText(await api.read(props.path)))
    // 1-based line numbers for the gutter. A <textarea> can't carry per-line ::before, so a
    // parallel gutter column keeps its scroll synced to the textarea.
    const lines = createMemo(() =>
        Array.from({ length: (text() ?? '').split('\n').length }, (_, i) => i + 1),
    )
    const save = async () => {
        if (text() != null) await api.write(props.path, text()!)
        props.onClose()
    }
    return (
        <div class={styles.source}>
            <Show when={text() != null} fallback={<Loading />}>
                <div class={styles.sourceEditor}>
                    <div class={styles.sourceGutter} ref={gutter} aria-hidden="true">
                        <Index each={lines()}>
                            {n => (
                                <Text as="div" inherit>
                                    {n()}
                                </Text>
                            )}
                        </Index>
                    </div>
                    <TextInput
                        multiline
                        plain
                        class={styles.sourceArea}
                        value={text()!}
                        spellcheck={false}
                        onInput={setText}
                        onScroll={e => {
                            if (gutter) gutter.scrollTop = e.currentTarget.scrollTop
                        }}
                    />
                </div>
            </Show>
            <div class={styles.sourceBar}>
                <TextButton primary onClick={save}>
                    save
                </TextButton>
                <TextButton onClick={props.onClose}>cancel</TextButton>
            </div>
        </div>
    )
}

export default BaseSourceEditor
