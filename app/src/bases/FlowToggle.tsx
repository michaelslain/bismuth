// app/src/bases/FlowToggle.tsx
// The display panel's `move by` row: one long column (`scroll`) or a page at a time (`flip`).
import type { Component } from 'solid-js'
import SegmentedToggle from '../ui/SegmentedToggle'
import type { ReadFlow } from './ReadModeSwitch'

export type FlowToggleProps = {
    flow: ReadFlow
    onFlow: (flow: ReadFlow) => void
}

const FlowToggle: Component<FlowToggleProps> = props => (
    <SegmentedToggle<ReadFlow>
        options={[
            { id: 'scroll', label: 'scroll', title: 'one long column' },
            { id: 'flip', label: 'flip', title: 'a page at a time' },
        ]}
        value={props.flow}
        onChange={props.onFlow}
    />
)

export default FlowToggle
