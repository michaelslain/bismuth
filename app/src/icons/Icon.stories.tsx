// Visual spec for <Icon> — the one primitive every icon call site renders through (registry.ts).
//
// A `value` resolves, in order: (1) a known name -> its Nerd Font glyph, from the codepoint map in
// nerdGlyphs.ts drawn from the subset face in assets/fonts/; (2) a name-SHAPED string that isn't
// mapped -> the generic fallback glyph (never the raw typo text); (3) anything else (an emoji, an
// arbitrary glyph) -> passed through as-is.
//
// WHY THIS FILE IS THE ONLY REAL CHECK ON THE ICON SET. Three independent things can be true at once
// and all of them pass every automated gate:
//   • A codepoint missing from the subset font draws ZERO pixels in Chrome — no `.notdef` box, no
//     warning. So a broken icon is an EMPTY button, which reads as a layout bug, not a missing asset.
//   • A name mapped to the WRONG glyph is indistinguishable from a correct one to any test. A
//     "database" where "trash can" was intended resolves, renders, and satisfies the cmap coverage
//     check, the no-duplicate check and the computed-style baseline alike.
//   • The registry's own tests compare the map against itself, so they cannot see either problem.
// The `AllIcons` story below therefore exists to be LOOKED AT. It is not decoration.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Icon } from './Icon'
import { iconNames } from './registry'
import { Row } from '../ui/_storyKit'

const meta = {
    title: 'Icons/Icon',
    component: Icon,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof Icon>

export default meta
type Story = StoryObj<typeof meta>

function Labeled(props: { value: string; caption: string; size?: number }) {
    return (
        <div
            style={{
                display: 'flex',
                'flex-direction': 'column',
                'align-items': 'center',
                gap: '6px',
            }}
        >
            <span style={{ color: 'var(--fg)' }}>
                <Icon value={props.value} size={props.size ?? 20} />
            </span>
            <span
                style={{
                    'font-family': 'var(--ui-font-stack)',
                    'font-size': 'var(--fs-micro)',
                    color: 'var(--text-muted)',
                }}
            >
                {props.caption}
            </span>
        </div>
    )
}

/** The everyday toolbar/palette/picker case. */
export const Default: Story = {
    render: () => (
        <Row gap="24px">
            <Labeled value="Plus" caption="Plus" />
            <Labeled value="Search" caption="Search" />
            <Labeled value="Settings" caption="Settings" />
            <Labeled value="Trash2" caption="Trash2" />
            <Labeled value="BookOpen" caption="BookOpen" />
            <Labeled value="Calendar" caption="Calendar" />
        </Row>
    ),
}

/** EVERY icon in the registry, with its name, sorted. The whole set on one surface, because the two
 *  failure modes that matter — a glyph that draws nothing, and a glyph that draws the wrong thing —
 *  are both invisible to every other check we have. An empty cell is a missing codepoint; a cell
 *  whose picture disagrees with its label is a bad mapping choice. */
export const AllIcons: Story = {
    render: () => (
        <div
            style={{
                display: 'grid',
                'grid-template-columns':
                    'repeat(auto-fill, minmax(104px, 1fr))',
                gap: '14px',
            }}
        >
            {iconNames().map(n => (
                <div
                    style={{
                        display: 'flex',
                        'align-items': 'center',
                        gap: '8px',
                        'min-width': 0,
                    }}
                >
                    <Icon value={n} size={18} />
                    <span
                        style={{
                            'font-family': 'var(--ui-font-stack)',
                            'font-size': 'var(--fs-micro)',
                            color: 'var(--text-muted)',
                            overflow: 'hidden',
                            'text-overflow': 'ellipsis',
                            'white-space': 'nowrap',
                            'min-width': 0,
                        }}
                    >
                        {n}
                    </span>
                </div>
            ))}
        </div>
    ),
}

/** The same icon at the sizes real call sites actually use (12-32px). These are font glyphs now, so
 *  they scale by hinting rather than by the pixel-grid snapping the old SVG paths needed — the small
 *  end is where a too-detailed glyph choice turns to mush, so it is worth checking here and not only
 *  in the gallery. */
export const Sizes: Story = {
    render: () => (
        <Row gap="20px">
            {[12, 14, 16, 20, 24, 32].map(s => (
                <Labeled value="Star" caption={`${s}px`} size={s} />
            ))}
        </Row>
    ),
}

/** The names that carry a SURFACE's identity — graph / note / base / calendar / chat / daemon /
 *  folder. These were typed ASCII characters before the migration and are now real icons like
 *  everything else. `Folder` is shown beside `FolderOpen` on purpose: they are the file tree's
 *  collapse affordance, so the pair has to read as closed-vs-open, not merely as two glyphs. */
export const SurfaceIcons: Story = {
    render: () => (
        <Row gap="24px">
            <Labeled value="Share2" caption="Share2 (graph)" />
            <Labeled value="FileText" caption="FileText (note)" />
            <Labeled value="Table" caption="Table (base)" />
            <Labeled value="Bot" caption="Bot (daemon)" />
            <Labeled value="Folder" caption="Folder (closed)" />
            <Labeled value="FolderOpen" caption="FolderOpen" />
            <Labeled value="Square" caption="Square (unchecked)" />
            <Labeled value="SquareCheck" caption="SquareCheck" />
        </Row>
    ),
}

/** The seven names that used to SHARE a drawing, now distinct. Before the migration `Inbox`,
 *  `Server`, `Settings2` and `BrainCircuit` all rendered the same daemon mark as `Bot`, and `File`
 *  was identical to `FileText` — they collapsed because hand-drawing pixel art was expensive, not
 *  because they mean the same thing. Each should now be recognisable as itself. */
export const FormerlyShared: Story = {
    render: () => (
        <Row gap="24px">
            <Labeled value="Bot" caption="Bot" />
            <Labeled value="Inbox" caption="Inbox" />
            <Labeled value="Server" caption="Server" />
            <Labeled value="Settings2" caption="Settings2" />
            <Labeled value="BrainCircuit" caption="BrainCircuit" />
            <Labeled value="File" caption="File" />
            <Labeled value="FileText" caption="FileText" />
            <Labeled value="MessagesSquare" caption="MessagesSquare" />
        </Row>
    ),
}

/** Two edge cases the registry docstring calls out. An unmapped name-SHAPED string (e.g. a legacy
 *  Lucide name surviving in old vault frontmatter) falls back to the generic fallback glyph rather
 *  than showing broken-looking literal text — and that fallback must NOT look like `Folder`, which is
 *  what it used to be. A non-name value (an emoji, or any arbitrary glyph a note's `icon:` frontmatter
 *  can hold) passes through unchanged; those are the only values that are still multi-character, which
 *  is why Icon.tsx keeps its widening box. */
export const UnknownAndEmoji: Story = {
    render: () => (
        <Row gap="24px">
            <Labeled
                value="LucideBookmarkPlus"
                caption="unmapped name -> fallback"
            />
            <Labeled value="Folder" caption="Folder (must differ)" />
            <Labeled value="🪶" caption="emoji -> passthrough" />
            <Labeled value="★" caption="arbitrary glyph -> passthrough" />
        </Row>
    ),
}
