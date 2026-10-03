import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import SectionLabel from './SectionLabel'
import Text from './Text'

const meta = {
    title: 'UI/SectionLabel',
    component: SectionLabel,
} satisfies Meta<typeof SectionLabel>

export default meta
type Story = StoryObj<typeof meta>

/** A block head over its rows, and an inline head in front of a value on one row. */
export const Default: Story = {
    args: { children: 'anthropic' },
    render: () => (
        <div style={{ width: '320px' }}>
            <SectionLabel>anthropic</SectionLabel>
            <Text as="div" size="ui">
                claude-sonnet-4-5
            </Text>
            <Text as="div" size="ui">
                claude-opus-4-8
            </Text>
            <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
                <SectionLabel as="span">effort</SectionLabel>
                <Text as="span" size="ui">
                    medium
                </Text>
            </div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const heads = [...canvasElement.querySelectorAll('div, span')].filter(
            el => el.textContent === 'anthropic' || el.textContent === 'effort',
        )
        await expect(heads.length).toBe(2)
        for (const el of heads) {
            const cs = getComputedStyle(el)
            await expect(cs.textTransform).toBe('none')
            await expect(cs.letterSpacing).toBe('normal')
        }
    },
}
