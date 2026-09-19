// Visual spec for <PaletteRow> — the shared row anatomy (icon + label/desc + sublabel +
// shortcut) composed by PaletteModal (command/template palette rows) and SwitcherBar (the
// in-window Cmd+O switcher's file rows).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Kbd from '../ui/ascii/Kbd'
import PaletteRow, { Highlight } from './PaletteRow'

const meta = {
    title: 'Palette/PaletteRow',
    component: PaletteRow,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PaletteRow>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (p: { children: any }) => (
    <div style={{ 'max-width': '360px', padding: '8px', background: 'var(--pop-bg-strong)' }}>
        {p.children}
    </div>
)

export const Basic: Story = {
    render: () => (
        <Frame>
            <PaletteRow icon="FileText" label="Housing" sublabel="notes" />
        </Frame>
    ),
}

export const Selected: Story = {
    render: () => (
        <Frame>
            <PaletteRow icon="FileText" label="Housing" sublabel="notes" selected />
        </Frame>
    ),
}

export const WithDescriptionAndShortcut: Story = {
    render: () => (
        <Frame>
            <PaletteRow
                icon="Sparkles"
                label="New note from template"
                desc="Creates a note prefilled from the selected template"
                shortcut={<Kbd combo="Mod+N" />}
            />
        </Frame>
    ),
}

export const HighlightedMatch: Story = {
    render: () => (
        <Frame>
            <PaletteRow
                icon="FileText"
                label={<Highlight text="Project Roadmap" indices={[0, 1, 8]} />}
                sublabel="projects"
            />
        </Frame>
    ),
}
