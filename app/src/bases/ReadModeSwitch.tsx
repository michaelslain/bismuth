// app/src/bases/ReadModeSwitch.tsx
// The reader's one worded switch, `scroll | pages | text`, in the PDF and image bar and in a book's
// bar alike: the same three ways to read a page file, whichever surface opened it.
import type { Component } from 'solid-js'
import SegmentedToggle from '../ui/SegmentedToggle'

export type ReadMode = 'scroll' | 'pages' | 'text'

export type ReadModeSwitchProps = {
    value: ReadMode
    onChange: (mode: ReadMode) => void
    /** Why `text` cannot be chosen yet (its title); undefined leaves it enabled. */
    textUnavailable?: string
    class?: string
}

const ReadModeSwitch: Component<ReadModeSwitchProps> = props => (
    <SegmentedToggle<ReadMode>
        class={props.class}
        options={[
            { id: 'scroll', label: 'scroll', title: 'one long column of pages' },
            { id: 'pages', label: 'pages', title: 'turn the pages, two at a time when they fit' },
            {
                id: 'text',
                label: 'text',
                disabled: props.textUnavailable !== undefined,
                title: props.textUnavailable ?? 'the transcription, set as a book',
            },
        ]}
        value={props.value}
        onChange={props.onChange}
    />
)

export default ReadModeSwitch
