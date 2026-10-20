// Visual spec for <TooltipHost> — the one hover-name bubble, mounted globally (App.tsx and
// .storybook/preview.ts). Each story renders an IconButton carrying `data-tooltip` and its play()
// opens the bubble the way a pointer does: a document-level pointermove at the button's centre
// (or, for Keyboard, a real Tab), then leaves it open at rest.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import TooltipHost from './TooltipHost'
import { IconButton } from './IconButton'
import { IconTextButton } from './IconTextButton'
import { settings, setSettings } from '../settings'
import type { KeybindingId } from '../../../core/src/keybindings'

const meta = {
    title: 'UI/TooltipHost',
    component: TooltipHost,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TooltipHost>

export default meta
type Story = StoryObj<typeof meta>

const Pinned = (props: {
    style: JSX.CSSProperties
    disabled?: boolean
    tip: string
    keybinding?: KeybindingId
}) => (
    <div style={{ position: 'fixed', ...props.style }}>
        <IconButton
            icon="Star"
            label="Star"
            disabled={props.disabled}
            keybinding={props.keybinding}
            data-tooltip={props.tip}
        />
    </div>
)

const bubble = () => document.querySelector<HTMLElement>('[data-tooltip-bubble]')

/** Pointer-hover the story's button: the host hit-tests the point, so a disabled button works too. */
const moveOnto = (btn: HTMLElement) => {
    const r = btn.getBoundingClientRect()
    document.dispatchEvent(
        new PointerEvent('pointermove', {
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
            pointerType: 'mouse',
            bubbles: true,
        }),
    )
}

/** Move the pointer to empty canvas (top-left corner), off every button. */
const moveAway = () =>
    document.dispatchEvent(
        new PointerEvent('pointermove', { clientX: 1, clientY: 1, pointerType: 'mouse', bubbles: true }),
    )

const hover = async (root: HTMLElement) => {
    const btn = root.querySelector('button')!
    moveOnto(btn)
    await waitFor(() => expect(bubble()).not.toBeNull(), { timeout: 3000 })
    await waitFor(() => expect(bubble()!.style.visibility).toBe('visible'))
    return { btn: btn.getBoundingClientRect(), tip: bubble()!.getBoundingClientRect() }
}

const insideViewport = (t: DOMRect) => {
    expect(t.left).toBeGreaterThanOrEqual(0)
    expect(t.right).toBeLessThanOrEqual(window.innerWidth)
    expect(t.top).toBeGreaterThanOrEqual(0)
    expect(t.bottom).toBeLessThanOrEqual(window.innerHeight)
}

/** Open under a button in the middle of the canvas, centred on it. */
export const Below: Story = {
    render: () => (
        <Pinned style={{ top: '40%', left: '50%' }} tip="Zoom out" />
    ),
    play: async ({ canvasElement }) => {
        const { btn, tip } = await hover(canvasElement)
        expect(bubble()!.textContent).toBe('Zoom out')
        expect(bubble()!.getAttribute('data-side')).toBe('below')
        expect(tip.top - btn.bottom).toBeGreaterThan(2)
        expect(tip.top - btn.bottom).toBeLessThan(6)
        expect(Math.abs(tip.left + tip.width / 2 - (btn.left + btn.width / 2))).toBeLessThan(1)
        insideViewport(tip)
        expect(bubble()!.getAttribute('aria-hidden')).toBe('true')
        expect(getComputedStyle(bubble()!).pointerEvents).toBe('none')
    },
}

/** A button on the window's bottom edge: no room below, so the bubble sits above it. */
export const FlipsAbove: Story = {
    render: () => (
        <Pinned style={{ bottom: 'var(--sp-2)', left: '50%' }} tip="Draw (Mod+Shift+D)" />
    ),
    play: async ({ canvasElement }) => {
        const { btn, tip } = await hover(canvasElement)
        expect(bubble()!.textContent).toBe('Draw (Mod+Shift+D)')
        expect(bubble()!.getAttribute('data-side')).toBe('above')
        expect(btn.top - tip.bottom).toBeGreaterThan(2)
        expect(btn.top - tip.bottom).toBeLessThan(6)
        insideViewport(tip)
    },
}

/** A button on the right edge: the bubble is clamped inside the window, not centred. */
export const ClampedRight: Story = {
    render: () => (
        <Pinned style={{ top: '40%', right: 'var(--sp-2)' }} tip="Reveal in file manager" />
    ),
    play: async ({ canvasElement }) => {
        const { btn, tip } = await hover(canvasElement)
        expect(bubble()!.textContent).toBe('Reveal in file manager')
        expect(tip.left + tip.width / 2).toBeLessThan(btn.left + btn.width / 2)
        insideViewport(tip)
    },
}

/** A disabled button shows its bubble too. */
export const Disabled: Story = {
    render: () => (
        <Pinned style={{ top: '40%', left: '50%' }} tip="Highlight" disabled />
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('button')!.disabled).toBe(true)
        await hover(canvasElement)
        expect(bubble()!.textContent).toBe('Highlight')
    },
}

/** Keyboard focus-visible shows the bubble with no delay. */
export const Keyboard: Story = {
    render: () => (
        <Pinned style={{ top: '40%', left: '50%' }} tip="close tab" />
    ),
    play: async ({ canvasElement }) => {
        await userEvent.tab()
        expect(document.activeElement).toBe(canvasElement.querySelector('button'))
        await waitFor(() => expect(bubble()).not.toBeNull())
        await waitFor(() => expect(bubble()!.style.visibility).toBe('visible'))
        expect(bubble()!.textContent).toBe('close tab')
    },
}

const gone = () => waitFor(() => expect(bubble()).toBeNull())

/** Every way a pointer-opened bubble closes: Escape, pointerdown, pointer leaving, blur. */
export const Dismisses: Story = {
    render: () => <Pinned style={{ top: '40%', left: '50%' }} tip="Zoom out" />,
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button')!
        await hover(canvasElement)
        await userEvent.keyboard('{Escape}')
        await gone()

        moveAway()
        await hover(canvasElement)
        btn.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }))
        await gone()

        moveAway()
        await hover(canvasElement)
        moveAway()
        await gone()

        // blur: a focus-sourced bubble closes when focus leaves
        moveAway()
        await userEvent.tab()
        await waitFor(() => expect(bubble()).not.toBeNull())
        btn.blur()
        await gone()
    },
}

/** Moving straight from one tooltip'd button onto another swaps the text with no new delay. */
export const SwapsWithoutDelay: Story = {
    render: () => (
        <>
            <Pinned style={{ top: '40%', left: '30%' }} tip="First" />
            <Pinned style={{ top: '40%', left: '60%' }} tip="Second" />
        </>
    ),
    play: async ({ canvasElement }) => {
        const [a, b] = Array.from(canvasElement.querySelectorAll('button'))
        moveOnto(a)
        await waitFor(() => expect(bubble()?.textContent).toBe('First'), { timeout: 3000 })
        moveOnto(b)
        expect(bubble()!.textContent).toBe('Second') // synchronous: no waitFor
        moveAway()
        await gone()
    },
}

/** A focus-sourced bubble closes when its button is removed from the DOM. */
export const HidesWhenHolderRemoved: Story = {
    render: () => <Pinned style={{ top: '40%', left: '50%' }} tip="close tab" />,
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button')!
        await userEvent.tab()
        await waitFor(() => expect(bubble()).not.toBeNull())
        // some engines fire no focusout when the focused element is removed; swallow it so
        // only the host's staleness guard can close the bubble
        window.addEventListener('focusout', e => e.stopImmediatePropagation(), { capture: true, once: true })
        btn.remove()
        moveAway() // a focus-sourced bubble ignores pointer moves unless its holder is stale
        await gone()
    },
}

const kbd = () => bubble()!.querySelector<HTMLElement>('[data-kbd]')

/** A bound keybinding adds its live combo as a muted Kbd after the name, one --sp-3 gap apart. */
export const WithShortcut: Story = {
    render: () => <Pinned style={{ top: '40%', left: '50%' }} tip="Find in note" keybinding="find" />,
    play: async ({ canvasElement }) => {
        const { tip } = await hover(canvasElement)
        expect(kbd()).not.toBeNull()
        expect(kbd()!.textContent).toMatch(/F$/)
        expect(bubble()!.firstChild!.textContent).toBe('Find in note')
        const name = document.createRange()
        name.selectNodeContents(bubble()!.firstChild!)
        const gap = kbd()!.getBoundingClientRect().left - name.getBoundingClientRect().right
        const sp3 = parseFloat(getComputedStyle(bubble()!).columnGap)
        expect(sp3).toBeGreaterThan(0)
        expect(Math.abs(gap - sp3)).toBeLessThan(1)
        insideViewport(tip)
    },
}

/** A long name plus a shortcut on the right edge: clamped fully inside the window. */
export const ShortcutClampedRight: Story = {
    render: () => (
        <Pinned
            style={{ top: '40%', right: 'var(--sp-2)' }}
            tip="Reveal the selected file in the file manager"
            keybinding="find"
        />
    ),
    play: async ({ canvasElement }) => {
        const { btn, tip } = await hover(canvasElement)
        expect(kbd()).not.toBeNull()
        expect(tip.left + tip.width / 2).toBeLessThan(btn.left + btn.width / 2)
        insideViewport(tip)
    },
}

/** The combo is read from the live settings on each open: rebind, reopen, see the new key. */
export const ShortcutRebound: Story = {
    render: () => <Pinned style={{ top: '40%', left: '50%' }} tip="Find in note" keybinding="find" />,
    play: async ({ canvasElement }) => {
        const restore = settings.keybindings.find
        await hover(canvasElement)
        expect(kbd()!.textContent).toMatch(/F$/)
        moveAway()
        await gone()
        setSettings('keybindings', 'find', 'Mod+Shift+R')
        try {
            await hover(canvasElement)
            expect(kbd()!.textContent).toMatch(/R$/)
            expect(kbd()!.textContent).not.toMatch(/F$/)
        } finally {
            setSettings('keybindings', 'find', restore)
        }
    },
}

/** An IconTextButton with a keybinding and no title: the bubble is just the Kbd. */
export const ShortcutOnly: Story = {
    render: () => (
        <div style={{ position: 'fixed', top: '40%', left: '50%' }}>
            <IconTextButton icon="Search" keybinding="find">
                find
            </IconTextButton>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button')!
        moveOnto(btn)
        await waitFor(() => expect(bubble()).not.toBeNull(), { timeout: 3000 })
        await waitFor(() => expect(bubble()!.style.visibility).toBe('visible'))
        expect(kbd()).not.toBeNull()
        expect(kbd()!.textContent).toMatch(/F$/)
        expect(bubble()!.textContent).toBe(kbd()!.textContent)
        insideViewport(bubble()!.getBoundingClientRect())
    },
}

/** A button with no keybinding keeps a label-only bubble: no Kbd is rendered. */
export const UnwiredUnchanged: Story = {
    render: () => <Pinned style={{ top: '40%', left: '50%' }} tip="Zoom out" />,
    play: async ({ canvasElement }) => {
        const { tip } = await hover(canvasElement)
        expect(bubble()!.textContent).toBe('Zoom out')
        expect(kbd()).toBeNull()
        insideViewport(tip)
    },
}
