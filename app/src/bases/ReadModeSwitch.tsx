// app/src/bases/ReadModeSwitch.tsx
// What the reader shows, as three icons in the PDF and image bar and in a book's bar alike: the page,
// its text, or the page beside its text. How it moves (scroll down one column, or flip a page at a
// time) is a row of the `Aa` panel, set once like a reading app's layout.
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
        look="icon"
        class={props.class}
        options={[
            { id: 'pages', icon: 'File', ariaLabel: 'pages', title: 'pages' },
            {
                id: 'text',
                icon: 'FileText',
                ariaLabel: 'text',
                disabled: props.textUnavailable !== undefined,
                title: props.textUnavailable ?? 'text',
            },
            {
                id: 'side',
                icon: 'Columns2',
                ariaLabel: 'side by side',
                disabled: props.textUnavailable !== undefined,
                title: props.textUnavailable ?? 'side by side',
            },
        ]}
        value={props.view}
        onChange={props.onView}
    />
)

export default ReadModeSwitch
