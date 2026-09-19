// Visual spec for <PaletteFrame> — the shared Modal+search shell composed by PaletteModal.tsx
// and ui/gallery/SymbolGallery.tsx.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import PaletteFrame, { PaletteEmpty } from './PaletteFrame'

const meta = {
    title: 'Palette/PaletteFrame',
    component: PaletteFrame,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PaletteFrame>

export default meta
type Story = StoryObj<typeof meta>

export const Basic: Story = {
    render: () => {
        const [value, setValue] = createSignal('')
        return (
            <PaletteFrame
                onClose={() => {}}
                label="Example palette"
                placeholder="Search…"
                value={value()}
                onInput={setValue}
                inputRef={() => {}}
            >
                <div style={{ padding: '16px' }}>Body content goes here.</div>
            </PaletteFrame>
        )
    },
}

export const Empty: Story = {
    render: () => (
        <PaletteFrame
            onClose={() => {}}
            label="Example palette"
            placeholder="Search…"
            value="zzz"
            onInput={() => {}}
            inputRef={() => {}}
        >
            <PaletteEmpty>No matches</PaletteEmpty>
        </PaletteFrame>
    ),
}
