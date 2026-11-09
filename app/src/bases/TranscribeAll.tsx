// app/src/bases/TranscribeAll.tsx
// The bar's transcribe button, for the whole document with a reader you pick: the same three the
// page menu's `read again` rows name. A run replaces every page, so when any page already has text
// it asks first, since typed corrections go with it. The reading happens in a background job.
import { createSignal, Show, type Component } from 'solid-js'
import { api } from '../api'
import { ContextMenu, type MenuItem } from '../ui/ContextMenu'
import FormModal from '../ui/FormModal'
import IconButton from '../ui/IconButton'
import ModalBody from '../ui/ModalBody'
import ModalFooter from '../ui/ModalFooter'
import ModalHeader from '../ui/ModalHeader'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import type { TranscribeEngine } from '../../../core/src/transcript'
import { replaceBody, replaceTitle, transcribeAllLabel, type Transcription } from './transcription'

const READERS: { engine: TranscribeEngine; icon: string; words: string }[] = [
    { engine: 'ai', icon: 'Sparkles', words: 'with ai' },
    { engine: 'marker', icon: 'Sigma', words: 'with the math reader' },
    { engine: 'on-device', icon: 'RefreshCw', words: 'on-device' },
]

export type TranscribeAllProps = {
    /** The page files of the document: one for a PDF or image, several for a book. */
    files: string[]
    /** Pages across them; 0 until a PDF has been counted, and the button waits. */
    pages: number
    transcription: Pick<Transcription, 'start' | 'progress'>
    className?: string
}

const TranscribeAll: Component<TranscribeAllProps> = props => {
    const [menu, setMenu] = createSignal<{ x: number; y: number; above: number } | null>(null)
    const [asking, setAsking] = createSignal<{ reader: (typeof READERS)[number]; filled: number } | null>(null)
    const run = (engine: TranscribeEngine) => {
        for (const file of props.files) props.transcription.start(file, { engine })
    }
    const pick = async (reader: (typeof READERS)[number]) => {
        // a text that cannot be read is treated as there, so the question is asked rather than skipped
        const filled = await Promise.all(props.files.map(f => api.storedTranscript(f))).then(
            all => all.reduce((n, t) => n + t.pages.filter(p => p.text.trim()).length, 0),
            () => props.pages,
        )
        if (filled > 0) setAsking({ reader, filled })
        else run(reader.engine)
    }
    const items = (): MenuItem[] =>
        READERS.map(r => ({ label: transcribeAllLabel(props.pages, r.words), icon: r.icon, onSelect: () => void pick(r) }))
    const open = (e: MouseEvent) => {
        const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
        setMenu({ x: b.left, y: b.bottom, above: b.top })
    }
    return (
        <>
            <IconButton
                icon="FileText"
                label="transcribe all"
                title="read every page again and replace its text"
                class={props.className}
                variant={menu() ? 'selected' : 'unselected'}
                disabled={props.pages === 0 || props.transcription.progress() !== undefined}
                onClick={open}
            />
            <Show when={menu()}>
                {m => <ContextMenu x={m().x} y={m().y} flipFrom={m().above} items={items()} onClose={() => setMenu(null)} />}
            </Show>
            <Show when={asking()}>
                {a => (
                    <FormModal onClose={() => setAsking(null)} width={420} label="replace the text">
                        <ModalHeader title={replaceTitle(a().filled)} onClose={() => setAsking(null)} />
                        <ModalBody>
                            <Text size="ui" tone="muted" data-transcribe-replace-body>
                                {replaceBody(props.pages, a().reader.words, a().reader.engine === 'ai')}
                            </Text>
                        </ModalBody>
                        <ModalFooter>
                            <TextButton onClick={() => setAsking(null)}>keep the text</TextButton>
                            <TextButton
                                onClick={() => {
                                    const engine = a().reader.engine
                                    setAsking(null)
                                    run(engine)
                                }}
                            >
                                replace
                            </TextButton>
                        </ModalFooter>
                    </FormModal>
                )}
            </Show>
        </>
    )
}

export default TranscribeAll
