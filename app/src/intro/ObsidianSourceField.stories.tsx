import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import ObsidianSourceField, { type VaultStart } from './ObsidianSourceField'

const meta = {
    title: 'Intro/ObsidianSourceField',
    component: ObsidianSourceField,
    parameters: { layout: 'centered' },
    args: {
        start: 'new',
        onStartChange: () => {},
        value: '',
        onInput: () => {},
        onBrowse: fn(),
    },
} satisfies Meta<typeof ObsidianSourceField>

export default meta
type Story = StoryObj<typeof meta>

/** The default: `new vault` picked, no path field. */
export const NewVault: Story = {
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelector('input')).toBeNull()
        const pressed = canvasElement.querySelector('[aria-pressed="true"]')
        await expect(pressed?.textContent).toContain('new vault')
    },
}

/** `from obsidian` with no path yet. */
export const FromObsidianEmpty: Story = {
    args: { start: 'obsidian' },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain('pick the vault to convert')
    },
}

/** `from obsidian` with a vault picked: the line names the converted copy. */
export const FromObsidianPicked: Story = {
    args: { start: 'obsidian', value: '/Users/ada/Documents/Notes' },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain(
            'opens as /Users/ada/Documents/Notes-bismuth',
        )
    },
}

/** Switching to `from obsidian` reveals the field; browse calls onBrowse. */
export const Interactive: Story = {
    render: args => {
        const [start, setStart] = createSignal<VaultStart>('new')
        const [value, setValue] = createSignal('')
        return (
            <ObsidianSourceField
                start={start()}
                onStartChange={setStart}
                value={value()}
                onInput={setValue}
                onBrowse={args.onBrowse}
            />
        )
    },
    play: async ({ args, canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: /from obsidian/ }))
        const input = canvasElement.querySelector('input')!
        await userEvent.type(input, '~/vault/')
        await expect(canvasElement.textContent).toContain('opens as ~/vault-bismuth')
        await userEvent.click(c.getByRole('button', { name: /browse/ }))
        await expect(args.onBrowse).toHaveBeenCalledOnce()
    },
}
