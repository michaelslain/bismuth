// Visual spec for <PaletteModal> — the reusable Obsidian-style fuzzy search/command overlay
// underneath CommandPalette and TemplatePalette (SwitcherBar reuses its ranking + Highlight but
// is its own in-window panel, not this Modal-wrapped shell — see SwitcherBar.stories.tsx).
// Knows nothing about commands or files: callers hand it plain PaletteItems.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { userEvent, within } from 'storybook/test'
import { PaletteModal, type PaletteItem } from './PaletteModal'

const meta = {
    title: 'Palette/PaletteModal',
    component: PaletteModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PaletteModal>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

const FILE_ITEMS: PaletteItem[] = [
    { id: 'projects/Internship.md', label: 'Internship', sublabel: 'projects' },
    {
        id: 'projects/Project Roadmap.md',
        label: 'Project Roadmap',
        sublabel: 'projects',
    },
    { id: 'reading/Essay.md', label: 'Essay', sublabel: 'reading' },
    {
        id: 'reading/Reading List.md',
        label: 'Reading List',
        sublabel: 'reading',
    },
    { id: 'Housing.md', label: 'Housing' },
    { id: 'Budget.sheet', label: 'Budget' },
]

/** Every optional field lit at once — icon, description, sublabel, AND a keybinding hint
 *  (rendered via the shared Kbd primitive, not pre-formatted text) — so the row layout's
 *  full width is exercised, not just the file-list's icon+label+sublabel subset. */
const RICH_ITEMS: PaletteItem[] = [
    {
        id: 'terminal',
        label: 'Open Terminal',
        description: 'Start a new terminal tab in this pane',
        icon: 'SquareTerminal',
        shortcut: 'Mod+`',
    },
    {
        id: 'toggle-sidebar',
        label: 'Toggle Sidebar',
        description: 'Show or hide the file tree',
        icon: 'PanelLeft',
        shortcut: 'Mod+\\',
    },
    {
        id: 'new-tab',
        label: 'New Tab',
        icon: 'Plus',
        shortcut: 'Mod+T',
    },
]

/** Open, unfiltered — plain file-like rows (icon + label + sublabel, no description/shortcut),
 *  the shape CommandPalette's "no keybinding" rows and TemplatePalette both render. */
export const Default: Story = {
    render: () => (
        <PaletteModal
            placeholder="Search..."
            items={FILE_ITEMS}
            onSelect={noop}
            onClose={noop}
        />
    ),
}

/** Every optional row affordance at once: icon, description, and a Kbd shortcut hint. */
export const RichRows: Story = {
    render: () => (
        <PaletteModal
            placeholder="Select a command..."
            items={RICH_ITEMS}
            onSelect={noop}
            onClose={noop}
        />
    ),
}

/** Typed query — fuzzy-filtered rows with matched characters highlighted (`.palette-match`,
 *  rendered by the shared Highlight helper). Filtering + highlighting are driven entirely by
 *  the real search input, so this state is unreachable declaratively — a `play` types into
 *  it the way a person would rather than fabricating pre-filtered markup. */
export const FilteredWithHighlight: Story = {
    render: () => (
        <PaletteModal
            placeholder="Search..."
            items={FILE_ITEMS}
            onSelect={noop}
            onClose={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement.ownerDocument.body)
        const input = canvas.getByPlaceholderText('Search...')
        await userEvent.type(input, 'road')
    },
}

/** No items at all — the emptyText fallback (custom text, not the "No matches" default). */
export const Empty: Story = {
    render: () => (
        <PaletteModal
            placeholder="Search..."
            items={[]}
            emptyText="No matching commands"
            onSelect={noop}
            onClose={noop}
        />
    ),
}
