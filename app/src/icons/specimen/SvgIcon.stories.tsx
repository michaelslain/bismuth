// app/src/icons/specimen/SvgIcon.stories.tsx
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import SvgIcon from './SvgIcon'
import { getIconBody } from './iconSetData'

const meta = {
    title: 'icons/specimen/SvgIcon',
    component: SvgIcon,
} satisfies Meta<typeof SvgIcon>

export default meta
type Story = StoryObj<typeof meta>

export const Resolved: Story = {
    args: {
        body: getIconBody('phosphorRegular', 'Plus'),
        size: 14,
    },
}

export const CustomRegex: Story = {
    args: {
        body: getIconBody('phosphorRegular', 'Regex'),
        size: 14,
    },
}

export const Missing: Story = {
    args: {
        body: null,
        size: 14,
    },
}

export const NerdGlyph: Story = {
    args: {
        body: getIconBody('nerd', 'Plus'),
        size: 14,
    },
}

export const SizeLadder: Story = {
    render: () => (
        <div style={{ display: 'flex', 'align-items': 'center', gap: '12px' }}>
            <SvgIcon body={getIconBody('phosphorRegular', 'Star')} size={12} />
            <SvgIcon body={getIconBody('phosphorRegular', 'Star')} size={14} />
            <SvgIcon body={getIconBody('phosphorRegular', 'Star')} size={16} />
        </div>
    ),
}
