// Visual spec for <Frontmatter> — the compact accent-edge meta panel (formerly the bare
// `.asc-frontmatter` global class in ui/ui.css; see Frontmatter.tsx). Smaller type (--fs-micro)
// and tighter padding than Callout — the two share the same accent-edge family at different
// densities.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Frontmatter from './Frontmatter'
import Callout from './Callout'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/Frontmatter',
    component: Frontmatter,
    parameters: { layout: 'padded' },
    args: {
        children: 'title: Meeting notes\ntags: [work, planning]',
    },
} satisfies Meta<typeof Frontmatter>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single panel. */
export const Playground: Story = {
    render: props => (
        <Frontmatter>
            <pre style={{ margin: 0, 'font-family': 'inherit' }}>
                {props.children}
            </pre>
        </Frontmatter>
    ),
}

/** Frontmatter sits alongside Callout as the same accent-edge family at a denser, smaller
 *  (--fs-micro vs --fs-ui) scale — this is the direct size comparison. */
export const VsCallout: Story = {
    render: () => (
        <Row label="accent-edge family" column>
            <Frontmatter>
                <pre style={{ margin: 0, 'font-family': 'inherit' }}>
                    title: Meeting notes{'\n'}tags: [work, planning]
                </pre>
            </Frontmatter>
            <Callout>A callout — same edge, larger --fs-ui type.</Callout>
        </Row>
    ),
}
