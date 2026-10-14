import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import SettingsSamples from './SettingsSamples'

const meta = {
    title: 'Intro/SettingsSamples',
    component: SettingsSamples,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof SettingsSamples>

export default meta
type Story = StoryObj<typeof meta>

/** The two default files: `.settings` and a note's frontmatter. */
export const Default: Story = {
    play: async ({ canvasElement }) => {
        const blocks = canvasElement.querySelectorAll('pre')
        await expect(blocks.length).toBe(2)
        await expect(blocks[0]!.textContent).toContain('theme: paper')
        await expect(blocks[1]!.textContent).toContain('tags: [book, fiction]')
        // Highlighted: the keys are their own spans.
        await expect(blocks[0]!.querySelectorAll('span').length).toBeGreaterThan(0)
    },
}

/** A single sample, to show a lone card stays card-sized. */
export const One: Story = {
    args: {
        samples: [
            { name: '.settings', text: 'appearance:\n  theme: ink', language: 'yaml' },
        ],
    },
}
