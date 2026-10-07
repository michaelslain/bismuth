// Visual spec for the base <Button> + buttonClass() variant matrix.
//
// Two kinds (see buttonClass.ts):
//   • kind  — "text" (the bracket look — "[ label ]", lowercase, one size, the default) |
//             "icon" (borderless icon button)
//   • state — "normal" (standalone) | "unselected" (toggle member, off) | "selected" (toggle member, on)
//   • size  — ignored for "text" (one size); "icon" takes "sm" | "md" | "lg" (md is the default)
//   • danger — orthogonal destructive tone, layerable on any state
//   • primary — orthogonal: accent + bold, no box, the view's one emphasized action
//
// Button also renders `data-state` on its root (defaulting to `'normal'` when `state` is unset) —
// the runtime hook outside stylesheets select on (`.x[data-state="selected"]`) instead of reaching
// `:global(.btn--selected)` etc (one-global-followups Task 1). Every story below exercises it
// implicitly: inspect the rendered `<button>` in any story and its `data-state` always matches the
// `state` prop passed in, `'normal'` for the stories that omit it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { expect } from 'storybook/test'
import { Button } from './Button'
import { Icon } from '../icons/Icon'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/Button',
    component: Button,
    parameters: { layout: 'centered' },
    argTypes: {
        kind: { control: 'inline-radio', options: ['text', 'icon'] },
        state: {
            control: 'inline-radio',
            options: ['normal', 'selected', 'unselected'],
        },
        size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
        danger: { control: 'boolean' },
        primary: { control: 'boolean' },
        disabled: { control: 'boolean' },
        children: { control: 'text' },
    },
    args: {
        kind: 'text',
        state: 'normal',
        size: 'md',
        danger: false,
        primary: false,
        disabled: false,
        children: 'button',
    },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

// ── layout helpers (stories only) ──────────────────────────────────────────────
function Stack(props: { children: JSX.Element }) {
    return (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '22px' }}
        >
            {props.children}
        </div>
    )
}

/** Fully controllable single button. */
export const Playground: Story = {}

/** Text button (the bracket register) — the three selection states plus the danger tone. Every
 *  state renders `[ label ]` unconditionally now — there is no opt-in `bracket` prop and no
 *  size variance (the old `Bracket`/`TextSizes` stories collapse into this one). */
export const TextStates: Story = {
    render: () => (
        <Row label="text // states">
            <Button kind="text" state="normal">
                normal
            </Button>
            <Button kind="text" state="unselected">
                unselected
            </Button>
            <Button kind="text" state="selected">
                selected
            </Button>
            <Button kind="text" danger>
                danger
            </Button>
            <Button kind="text" disabled>
                disabled
            </Button>
        </Row>
    ),
}

/** Primary — accent + bold, no box, the view's one emphasized action. Max one per view. */
export const TextPrimary: Story = {
    render: () => (
        <Row label="text // primary">
            <Button kind="text" state="unselected">
                cancel
            </Button>
            <Button kind="text" primary>
                save
            </Button>
        </Row>
    ),
}

/** A text button with a leading icon (Button's own `.label` gap handles spacing). */
export const TextWithIcon: Story = {
    render: () => (
        <Row label="text // with icon">
            <Button kind="text" state="normal">
                <Icon value="Plus" size={15} />
                new
            </Button>
            <Button kind="text" state="selected">
                <Icon value="Check" size={15} />
                saved
            </Button>
            <Button kind="text" danger>
                <Icon value="Trash2" size={15} />
                delete
            </Button>
        </Row>
    ),
}

/** Icon button — borderless; state changes ink and brackets, never opacity (normal = bare glyph,
 *  unselected = muted ink, selected = accent ink with its brackets drawn). */
export const IconStates: Story = {
    render: () => (
        <Row label="icon // states">
            <Button kind="icon" state="normal" title="normal">
                <Icon value="Star" />
            </Button>
            <Button kind="icon" state="unselected" title="unselected">
                <Icon value="Star" />
            </Button>
            <Button kind="icon" state="selected" title="selected">
                <Icon value="Star" />
            </Button>
            <Button kind="icon" danger title="danger">
                <Icon value="Trash2" />
            </Button>
            <Button kind="icon" disabled title="disabled">
                <Icon value="Star" />
            </Button>
        </Row>
    ),
}

/** Sizes (mirrors IconButton.stories.tsx's `Sizes` — `size` is ignored for `kind="text"`, so this
 *  exercises it on `kind="icon"`, the register IconButton itself wraps). Audit Q2 #1. `lg` used to
 *  have no rule and render exactly like `md`; the play pins that it is a genuinely larger target. */
export const Sizes: Story = {
    render: () => (
        <Row label="icon // sizes">
            <Button kind="icon" size="sm" title="sm">
                <Icon value="Search" />
            </Button>
            <Button kind="icon" size="md" title="md">
                <Icon value="Search" />
            </Button>
            <Button kind="icon" size="lg" title="lg">
                <Icon value="Search" />
            </Button>
        </Row>
    ),
    play: ({ canvasElement }) => {
        const box = (size: string) =>
            canvasElement
                .querySelector(`button[title="${size}"]`)!
                .getBoundingClientRect()
        expect(box('lg').height).toBeGreaterThan(box('md').height)
        expect(box('lg').width).toBeGreaterThan(box('md').width)
    },
}

// ── disabled: one recipe, every variant ──────────────────────────────────────────
// A disabled icon button in the selected / unselected / danger variant used to paint accent / muted
// / danger and read as enabled: `.btn--icon:disabled` and `.btn--icon.btn--selected` (etc.) are the
// same specificity and the variant rule came later. Every story below pins the COMPUTED ink against
// `--faint` itself (never a stand-in), and that nothing dims by opacity, so a regression in source
// order fails here rather than looking fine.

/** What `--faint` resolves to on an element in this frame, as a computed colour. Never a
 *  hardcoded stand-in. */
function resolvedFaint(host: Element) {
    const probe = document.createElement('span')
    probe.style.color = 'var(--faint)'
    host.appendChild(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
}

/** The disabled button in `canvasElement` is `--faint` ink alone (full opacity: a dimmed --faint
 *  falls under the 3:1 floor), brackets included; its enabled twin is NOT faint (so the assertion
 *  cannot pass vacuously). */
function expectDisabledRecipe(canvasElement: HTMLElement) {
    const faint = resolvedFaint(canvasElement)
    const off = canvasElement.querySelector<HTMLButtonElement>('button:disabled')!
    const on = canvasElement.querySelector<HTMLButtonElement>(
        'button:not(:disabled)',
    )!
    expect(getComputedStyle(off).color).toBe(faint)
    expect(getComputedStyle(off).opacity).toBe('1')
    expect(getComputedStyle(on).color).not.toBe(faint)
    expect(getComputedStyle(on).opacity).toBe('1')
    for (const part of ['::before', '::after']) {
        if (getComputedStyle(off, part).content !== 'none') {
            expect(getComputedStyle(off, part).color).toBe(faint)
        }
    }
}

/** Disabled + selected: faint, not accent — and its brackets (drawn when selected) go faint too. */
export const IconDisabledSelected: Story = {
    render: () => (
        <Row label="icon // selected, enabled then disabled">
            <Button kind="icon" state="selected" title="selected">
                <Icon value="Star" />
            </Button>
            <Button kind="icon" state="selected" disabled title="selected, disabled">
                <Icon value="Star" />
            </Button>
        </Row>
    ),
    play: ({ canvasElement }) => expectDisabledRecipe(canvasElement),
}

/** Disabled + unselected: faint ink — a visible step below an enabled muted one. */
export const IconDisabledUnselected: Story = {
    render: () => (
        <Row label="icon // unselected, enabled then disabled">
            <Button kind="icon" state="unselected" title="unselected">
                <Icon value="Star" />
            </Button>
            <Button
                kind="icon"
                state="unselected"
                disabled
                title="unselected, disabled"
            >
                <Icon value="Star" />
            </Button>
        </Row>
    ),
    play: ({ canvasElement }) => expectDisabledRecipe(canvasElement),
}

/** Disabled + danger: faint, not danger red. */
export const IconDisabledDanger: Story = {
    render: () => (
        <Row label="icon // danger, enabled then disabled">
            <Button kind="icon" danger title="danger">
                <Icon value="Trash2" />
            </Button>
            <Button kind="icon" danger disabled title="danger, disabled">
                <Icon value="Trash2" />
            </Button>
        </Row>
    ),
    play: ({ canvasElement }) => expectDisabledRecipe(canvasElement),
}

/** Disabled + normal, plain and at the toolzone `sm` size (the size an IconBar gives every child). */
export const IconDisabledNormal: Story = {
    render: () => (
        <Row label="icon // normal, enabled then disabled (md, sm)">
            <Button kind="icon" title="normal">
                <Icon value="Star" />
            </Button>
            <Button kind="icon" disabled title="normal, disabled">
                <Icon value="Star" />
            </Button>
            <Button kind="icon" size="sm" disabled title="sm, disabled">
                <Icon value="Star" />
            </Button>
        </Row>
    ),
    play: ({ canvasElement }) => {
        const faint = resolvedFaint(canvasElement)
        const buttons = [...canvasElement.querySelectorAll('button:disabled')]
        expect(buttons.length).toBe(2)
        for (const b of buttons) {
            expect(getComputedStyle(b).color).toBe(faint)
            expect(getComputedStyle(b).opacity).toBe('1')
        }
    },
}

/** The text register has the same recipe as the icon register: `--faint` ink alone, in every
 *  variant (a disabled `unselected` used to be dimmed to 0.4 on top of it). */
export const TextDisabledVariants: Story = {
    render: () => (
        <Row label="text // disabled: normal / unselected / selected / primary / danger">
            <Button kind="text" disabled>
                normal
            </Button>
            <Button kind="text" state="unselected" disabled>
                unselected
            </Button>
            <Button kind="text" state="selected" disabled>
                selected
            </Button>
            <Button kind="text" primary disabled>
                primary
            </Button>
            <Button kind="text" danger disabled>
                danger
            </Button>
        </Row>
    ),
    play: ({ canvasElement }) => {
        const faint = resolvedFaint(canvasElement)
        const buttons = [...canvasElement.querySelectorAll('button:disabled')]
        expect(buttons.length).toBe(5)
        for (const b of buttons) {
            expect(getComputedStyle(b).color).toBe(faint)
            expect(getComputedStyle(b).opacity).toBe('1')
        }
    },
}

/** `primary` and `selected` are both bold accent; primary alone carries a rest-state underline. */
export const PrimaryVsSelected: Story = {
    render: () => (
        <Row label="text // selected beside primary">
            <Button kind="text" state="selected">
                selected
            </Button>
            <Button kind="text" primary>
                primary
            </Button>
        </Row>
    ),
    play: ({ canvasElement }) => {
        const label = (sel: string) =>
            getComputedStyle(
                canvasElement.querySelector(`${sel} > span`)!,
            ).textDecorationLine
        expect(label('button[data-primary]')).toBe('underline')
        expect(label('button[data-state="selected"]')).toBe('none')
    },
}

/** The full matrix at a glance. */
export const AllVariants: Story = {
    render: () => (
        <Stack>
            <Row label="text // normal / unselected / selected">
                <Button kind="text" state="normal">
                    normal
                </Button>
                <Button kind="text" state="unselected">
                    unselected
                </Button>
                <Button kind="text" state="selected">
                    selected
                </Button>
            </Row>
            <Row label="text // danger / disabled">
                <Button kind="text" danger>
                    danger
                </Button>
                <Button kind="text" danger disabled>
                    danger disabled
                </Button>
                <Button kind="text" disabled>
                    disabled
                </Button>
            </Row>
            <Row label="text // primary">
                <Button kind="text" primary>
                    primary
                </Button>
            </Row>
            <Row label="icon // normal / unselected / selected / danger">
                <Button kind="icon" state="normal">
                    <Icon value="Star" />
                </Button>
                <Button kind="icon" state="unselected">
                    <Icon value="Star" />
                </Button>
                <Button kind="icon" state="selected">
                    <Icon value="Star" />
                </Button>
                <Button kind="icon" danger>
                    <Icon value="Trash2" />
                </Button>
            </Row>
        </Stack>
    ),
}
