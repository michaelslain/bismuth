// Visual spec for the base <Button> + buttonClass() variant matrix.
//
// Three kinds (see buttonClass.ts):
//   • kind  — "text" (the bracket look — "[ label ]", lowercase, one size, the default) |
//             "icon" (borderless icon button) | "segment" (the OLD "text" look — uppercase,
//             bordered, sized — kept verbatim for SegmentedToggle only)
//   • state — "normal" (standalone) | "unselected" (toggle member, off) | "selected" (toggle member, on)
//   • size  — ignored for "text" (one size); "icon"/"segment" take "sm" | "md" | "lg" (md is the default)
//   • danger — orthogonal destructive tone, layerable on any state
//   • primary — orthogonal: selected + a glow rim, the view's one emphasized action
//
// Button also renders `data-state` on its root (defaulting to `'normal'` when `state` is unset) —
// the runtime hook outside stylesheets select on (`.x[data-state="selected"]`) instead of reaching
// `:global(.btn--selected)` etc (one-global-followups Task 1). Every story below exercises it
// implicitly: inspect the rendered `<button>` in any story and its `data-state` always matches the
// `state` prop passed in, `'normal'` for the stories that omit it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { Button } from './Button'
import { Icon } from '../icons/Icon'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/Button',
    component: Button,
    parameters: { layout: 'centered' },
    argTypes: {
        kind: { control: 'inline-radio', options: ['text', 'icon', 'segment'] },
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

/** Primary — selected + a glow rim, the view's one emphasized action. Max one per view. */
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

/** Icon button — borderless; state changes opacity/fill (normal = full opacity,
 *  unselected = dimmed, selected = neutral fill). */
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

/** `kind="segment"` — the OLD `kind="text"` look (uppercase, bordered, sized), kept verbatim for
 *  SegmentedToggle only. Not a general-purpose register — reach for `kind="text"` for anything
 *  else. */
export const Segment: Story = {
    render: () => (
        <Row label="segment // states">
            <Button kind="segment" state="normal">
                NORMAL
            </Button>
            <Button kind="segment" state="unselected">
                UNSELECTED
            </Button>
            <Button kind="segment" state="selected">
                SELECTED
            </Button>
        </Row>
    ),
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
            <Row label="segment // normal / unselected / selected">
                <Button kind="segment" state="normal">
                    NORMAL
                </Button>
                <Button kind="segment" state="unselected">
                    UNSELECTED
                </Button>
                <Button kind="segment" state="selected">
                    SELECTED
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
