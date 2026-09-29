// Visual spec for <BaseViewActions> — the four bar actions (new task, settings, edit query,
// source) as one component. Each story holds its state in a signal, the way BaseView does.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import BaseViewActions from './BaseViewActions'

const meta = {
    title: 'Bases/BaseViewActions',
    component: BaseViewActions,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof BaseViewActions>

export default meta
type Story = StoryObj<typeof meta>

const args = { action: 'add-task' as const, when: true, onAct: () => {} }
const button = (root: HTMLElement, label: string) =>
    root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

/** A plain action: each click is one act. */
export const NewTask: Story = {
    args,
    render: () => {
        const [n, setN] = createSignal(0)
        return (
            <div data-count={n()}>
                <BaseViewActions action="add-task" when onAct={() => setN(n() + 1)} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await userEvent.click(button(canvasElement, 'New task')!)
        await userEvent.click(button(canvasElement, 'New task')!)
        await waitFor(() =>
            expect(canvasElement.firstElementChild?.getAttribute('data-count')).toBe('2'),
        )
    },
}

/** Settings and Source are toggles: the first click opens, the second closes. */
export const TogglesOpenAndClosed: Story = {
    args,
    render: () => {
        const [settings, setSettings] = createSignal(false)
        const [source, setSource] = createSignal(false)
        return (
            <div data-settings={String(settings())} data-source={String(source())}>
                <BaseViewActions
                    action="settings"
                    when
                    active={settings()}
                    onAct={() => setSettings(!settings())}
                />
                <BaseViewActions
                    action="source"
                    when
                    active={source()}
                    onAct={() => setSource(!source())}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const host = canvasElement.firstElementChild!
        await userEvent.click(button(canvasElement, 'Source')!)
        await waitFor(() => expect(host.getAttribute('data-source')).toBe('true'))
        await userEvent.click(button(canvasElement, 'Settings')!)
        await waitFor(() => expect(host.getAttribute('data-settings')).toBe('true'))
        await userEvent.click(button(canvasElement, 'Source')!)
        await waitFor(() => expect(host.getAttribute('data-source')).toBe('false'))
    },
}

/** Edit query is a plain action beside Source in an embedded query's bar. */
export const EditQuery: Story = {
    args,
    render: () => {
        const [n, setN] = createSignal(0)
        return (
            <div data-count={n()}>
                <BaseViewActions action="edit-query" when onAct={() => setN(n() + 1)} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await userEvent.click(button(canvasElement, 'Edit query')!)
        await waitFor(() =>
            expect(canvasElement.firstElementChild?.getAttribute('data-count')).toBe('1'),
        )
    },
}

/** `when` false renders nothing at all — the caller owns the gating. */
export const HiddenWhenNotApplicable: Story = {
    args: { ...args, when: false },
    render: () => (
        <div>
            <p>when=false, nothing renders below:</p>
            <BaseViewActions action="settings" when={false} onAct={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('button')).toBeNull()
    },
}
