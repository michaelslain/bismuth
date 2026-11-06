// app/src/bases/MathPrompt.tsx
// Asked when transcription finds pages that look like math and `transcription.math` is `ask`: the
// fast on-device read garbles formulas, and reading them properly (marker, else ai) takes about
// 15 s a page. `go fast` keeps the text already there; `read it properly` re-reads those pages.
// `don't ask again` saves the choice as the setting.
import { createSignal, Show, type Component } from 'solid-js'
import FormModal from '../ui/FormModal'
import ModalHeader from '../ui/ModalHeader'
import ModalBody from '../ui/ModalBody'
import ModalFooter from '../ui/ModalFooter'
import Text from '../ui/Text'
import ToggleRow from '../ui/ToggleRow'
import { TextButton } from '../ui/TextButton'

/** Seconds a careful read takes a page, for the estimate. */
export const CAREFUL_SECONDS_PER_PAGE = 15

export type MathChoice = 'careful' | 'fast'

export type MathPromptProps = {
    /** How many pages look like math. */
    pages: number
    /** Marker, the local math reader, is not installed yet: reading properly downloads it first. */
    install?: boolean
    onChoose: (choice: MathChoice, remember: boolean) => void
}

/** `45 s` under two minutes, `3 min` from there. */
export function estimate(pages: number): string {
    const s = pages * CAREFUL_SECONDS_PER_PAGE
    return s < 120 ? `about ${s} s` : `about ${Math.round(s / 60)} min`
}

const MathPrompt: Component<MathPromptProps> = props => {
    const [remember, setRemember] = createSignal(false)
    const choose = (c: MathChoice) => props.onChoose(c, remember())
    const one = () => props.pages === 1
    return (
        <FormModal onClose={() => choose('fast')} width={420} label="math on the page">
            <ModalHeader title={one() ? 'this page has math' : `${props.pages} pages have math`} onClose={() => choose('fast')} />
            <ModalBody>
                <Text size="ui" tone="muted" data-math-prompt-body>
                    {`reading math properly takes about ${CAREFUL_SECONDS_PER_PAGE} s a page${one() ? '' : ` (${props.pages} pages, ${estimate(props.pages)})`}. the fast read garbles formulas.`}
                </Text>
                <Show when={props.install}>
                    <Text size="ui" tone="muted" data-math-prompt-install>
                        the first time, the math reader downloads itself (about 1.2 GB, a few minutes).
                    </Text>
                </Show>
                <ToggleRow label="don't ask again" checked={remember()} onToggle={() => setRemember(r => !r)} />
            </ModalBody>
            <ModalFooter>
                <TextButton onClick={() => choose('fast')}>go fast</TextButton>
                <TextButton primary autofocus onClick={() => choose('careful')}>
                    read it properly
                </TextButton>
            </ModalFooter>
        </FormModal>
    )
}

export default MathPrompt
