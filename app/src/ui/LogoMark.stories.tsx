// Visual spec for <LogoMark> — the shipped `/logos/<icon>.svg` mark in a square box. The schema
// default (`hopper-crystal`) is the icon every story uses.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import LogoMark from './LogoMark'

const meta = {
    title: 'UI/LogoMark',
    component: LogoMark,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof LogoMark>

export default meta
type Story = StoryObj<typeof meta>

/** The intro header's corner size, named for assistive tech. */
export const Default: Story = {
    render: () => <LogoMark icon="hopper-crystal" size={30} label="Bismuth" />,
    play: async ({ canvasElement }) => {
        const img = canvasElement.querySelector('img') as HTMLImageElement
        await expect(img.getAttribute('src')).toBe('/logos/hopper-crystal.svg')
        await expect(img.getAttribute('alt')).toBe('Bismuth')
        await expect(img.width).toBe(30)
    },
}

/** The welcome/begin hero size. */
export const Hero: Story = {
    render: () => <LogoMark icon="hopper-crystal" size={96} />,
    play: async ({ canvasElement }) => {
        const img = canvasElement.querySelector('img') as HTMLImageElement
        await expect(img.width).toBe(96)
        await expect(img.height).toBe(96)
    },
}

/** No `label`: the image is decorative, so `alt` is the empty string rather than missing. */
export const Decorative: Story = {
    render: () => <LogoMark icon="node-rings" size={48} />,
    play: async ({ canvasElement }) => {
        const img = canvasElement.querySelector('img') as HTMLImageElement
        await expect(img.getAttribute('alt')).toBe('')
        await expect(img.getAttribute('src')).toBe('/logos/node-rings.svg')
    },
}
