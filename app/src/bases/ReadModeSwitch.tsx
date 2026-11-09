// app/src/bases/ReadModeSwitch.tsx
// What the reader shows, in words, as the `show` row of the display panel in the PDF and image bar
// and in a book's bar alike: the page, its text, or the page beside its text. How it moves (scroll
// down one column, or flip a page at a time) is the panel's `move by` row.
import type { Component } from 'solid-js'
import SegmentedToggle from '../ui/SegmentedToggle'

export type ReadView = 'pages' | 'text' | 'side'
export type ReadFlow = 'scroll' | 'flip'

export type ReadModeSwitchProps = {
    view: ReadView
    onView: (view: ReadView) => void
    /** Why `text` and `side by side` cannot be chosen yet (their tooltip); undefined leaves them enabled. */
    textUnavailable?: string
    class?: string
}

const ReadModeSwitch: Component<ReadModeSwitchProps> = props => (
    <SegmentedToggle<ReadView>
        class={props.class}
        options={[
            { id: 'pages', label: 'pages' },
            { id: 'text', label: 'text', disabled: props.textUnavailable !== undefined, title: props.textUnavailable },
            { id: 'side', label: 'side by side', disabled: props.textUnavailable !== undefined, title: props.textUnavailable },
        ]}
        value={props.view}
        onChange={props.onView}
    />
)

export default ReadModeSwitch
