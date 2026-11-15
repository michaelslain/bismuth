// app/src/bases/MathPrompt.tsx
// Asked when transcription finds pages that look like math and `transcription.math` is `ask`: the
// fast on-device read garbles formulas. Three readers, ranked best first, one row each with who
// reads, how long and how good: `read it properly` (the ai backend, one turn a page), `math reader`
// (marker on this machine) and `go fast` (keeps the text already there).
// `make this the default` saves the choice as the setting, after which the prompt no longer appears.
import { createSignal, For, Show, type Component } from 'solid-js'
import FormModal from '../ui/FormModal'
import ModalHeader from '../ui/ModalHeader'
import ModalBody from '../ui/ModalBody'
import Text from '../ui/Text'
import ToggleRow from '../ui/ToggleRow'
import OptionRow from '../ui/OptionRow'
import RowList from '../ui/RowList'

/** Seconds a careful read takes a page, for the estimate. */
export const CAREFUL_SECONDS_PER_PAGE = 15

export type MathChoice = 'careful' | 'fast' | 'ai'

export type MathPromptProps = {
    /** How many pages look like math. */
    pages: number
    /** Marker, the local math reader, is not installed yet: reading properly downloads it first. */
    install?: boolean
    /** The run is still reading: `pages` is what it has found so far and may grow. */
    running?: boolean
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
    const time = () => (one() ? `about ${CAREFUL_SECONDS_PER_PAGE} s` : estimate(props.pages))
    // best first: runs on | time | quality, as aligned columns
    const readers = (): { choice: MathChoice; icon: string; label: string; cells: { text: string; ch: number }[] }[] => [
        { choice: 'ai', icon: 'Sparkles', label: '[read it properly]', cells: [{ text: 'your ai', ch: 10 }, { text: time(), ch: 12 }, { text: 'best', ch: 5 }] },
        { choice: 'careful', icon: 'Sigma', label: '[math reader]', cells: [{ text: 'this mac', ch: 10 }, { text: time(), ch: 12 }, { text: 'good', ch: 5 }] },
        { choice: 'fast', icon: 'Zap', label: '[go fast]', cells: [{ text: 'on-device', ch: 10 }, { text: 'instant', ch: 12 }, { text: 'rough', ch: 5 }] },
    ]
    return (
        <FormModal onClose={() => choose('fast')} width={480} label="page transcriber">
            <ModalHeader title="page transcriber" onClose={() => choose('fast')} />
            <ModalBody>
                <Text size="ui" tone="muted" data-math-prompt-body data-math-prompt-running={props.running ? '' : undefined}>
                    <Text as="span" inherit>
                        {one() ? 'this page has math' : `${props.pages} pages have math`}
                    </Text>
                    {`. how do you want ${one() ? 'it' : 'them'} transcribed?${props.running ? ' later math pages get the same choice.' : ''}`}
                </Text>
                <RowList>
                    <For each={readers()}>
                        {r => <OptionRow icon={r.icon} label={r.label} cells={r.cells} onClick={() => choose(r.choice)} />}
                    </For>
                </RowList>
                <Show when={props.install}>
                    <Text size="ui" tone="faint" data-math-prompt-install>
                        first time only: the math reader downloads 1.2 GB.
                    </Text>
                </Show>
                <ToggleRow label="make this the default" checked={remember()} onToggle={() => setRemember(r => !r)} />
            </ModalBody>
        </FormModal>
    )
}

export default MathPrompt
