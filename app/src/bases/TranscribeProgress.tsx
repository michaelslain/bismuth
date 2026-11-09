// app/src/bases/TranscribeProgress.tsx
// What a running transcription says in a bar: how far it is, how long is left, and `cancel`. The
// estimate leaves the bar first, then `transcribing` shortens. Reads nothing but the controller.
import { Show, type Component } from 'solid-js'
import BarLabel from '../ui/BarLabel'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import { progressReadout, type Transcription } from './transcription'

export type TranscribeProgressProps = {
    transcription: Pick<Transcription, 'progress' | 'installing' | 'cancel'>
    /** Begin with ` // `, for sitting after a page number in one readout (default). */
    lead?: boolean
    className?: string
}

const TranscribeProgress: Component<TranscribeProgressProps> = props => {
    const parts = () => {
        const p = props.transcription.progress()
        return p && p.total > 0 ? progressReadout(p).split(' // ') : ['transcribing']
    }
    const lead = () => (props.lead === false ? '' : ' // ')
    return (
        <Show when={props.transcription.progress() || props.transcription.installing()}>
            <Text as="span" inherit class={props.className} data-transcribe-progress>
                <Show when={props.transcription.progress()} fallback={`${lead()}setting up the math reader`}>
                    {lead()}
                    <BarLabel long={parts()[0]} short={parts()[0].replace('transcribing ', '')} />
                    <Show when={parts()[1]}>
                        <BarLabel long={` // ${parts()[1]}`} drop="early" />
                    </Show>{' '}
                    <Text as="span" inherit data-bar-drop="1" data-bar-menu-label="cancel transcribing">
                        <TextButton onClick={() => props.transcription.cancel()}>cancel</TextButton>
                    </Text>
                </Show>
            </Text>
        </Show>
    )
}

export default TranscribeProgress
