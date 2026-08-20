// Visual spec for <SymbolGallery> — the searchable grid-of-symbols modal (icons,
// emoji) reused by the file-tree "Set icon" picker and the editor's `:`-emoji
// autocomplete. Driven entirely by a GallerySource (see ./types.ts + ./sources.ts):
// the icon source (Lucide-style names, prefix-then-substring ranked) and the emoji source
// (glyphs, ranked by the shared emoji search) are the two concrete sources in-repo.
//
// Uses the same shell as the command palette (<Modal> + `.palette-panel`), so
// `layout: "fullscreen"` lets the overlay fill the preview frame like Modal's stories.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, waitFor, within } from 'storybook/test'
import SymbolGallery from './SymbolGallery'
import { iconSource, emojiSource } from './sources'
import { Button } from '../Button'

const meta = {
    title: 'UI/Gallery/SymbolGallery',
    component: SymbolGallery,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SymbolGallery>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** The icon gallery — every icon (Lucide-named), unfiltered default set. */
export const IconSource: Story = {
    render: () => (
        <SymbolGallery source={iconSource} onPick={noop} onClose={noop} />
    ),
}

/** The icon gallery with a highlighted "current" selection + a reset action (the
 *  file-tree "Set icon" picker's shape). */
export const IconSourceWithCurrentAndClear: Story = {
    render: () => (
        <SymbolGallery
            source={iconSource}
            current="BookOpen"
            onClear={() => {}}
            clearLabel="RESET TO DEFAULT"
            onPick={noop}
            onClose={noop}
        />
    ),
}

/** The emoji gallery (the editor's `:`-emoji autocomplete shape). */
export const EmojiSource: Story = {
    render: () => (
        <SymbolGallery source={emojiSource} onPick={noop} onClose={noop} />
    ),
}

/** Regression coverage for the WebKit focus-guard (#67): for ~300ms after mount, any focusin
 *  landing OUTSIDE the modal panel is redirected back to the search box, but a focus landing
 *  INSIDE the panel (a grid cell) is left alone. The guard used to locate "inside the panel" by
 *  matching the `.icon-picker-panel` class with `closest()` — a string that stops matching the
 *  instant this repo hashes that class under a CSS-module migration, at which point EVERY focus
 *  (including legitimate ones on grid cells) looks "outside" and gets yanked back to the search
 *  box. It now resolves the panel via Modal's `panelRef` — an actual DOM reference Modal hands
 *  back, which can't go stale that way. This story drives real focus at a cell inside the modal
 *  and at a decoy button outside it, and asserts each lands where it should. */
export const FocusGuardIgnoresInModalFocus: Story = {
    render: () => (
        <div>
            <button type="button" data-testid="decoy">
                Decoy — outside the modal
            </button>
            <SymbolGallery source={iconSource} onPick={noop} onClose={noop} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(document.body)
        const searchInput = await body.findByPlaceholderText('Search icons…')
        const decoy = await canvas.findByTestId('decoy')
        // Any OTHER button in the document is a grid cell — Modal portals the panel to
        // document.body, outside canvasElement, so it can't collide with the decoy above.
        const gridCell = (await body.findAllByRole('button')).find(
            b => b !== decoy,
        ) as HTMLElement

        // Let the gallery's own re-focus passes (immediate + rAF + 0/50/150ms timeouts) settle
        // first so we're not racing them, then probe the guard well inside its 300ms window.
        await new Promise(resolve => setTimeout(resolve, 200))

        // Focus landing INSIDE the panel must be left alone.
        gridCell.focus()
        await waitFor(() => expect(document.activeElement).toBe(gridCell))

        // Focus landing OUTSIDE the panel must be redirected back to the search box.
        decoy.focus()
        await waitFor(() => expect(document.activeElement).toBe(searchInput))
    },
}

/** Interactive: a trigger opens the gallery; picking a symbol or Escape/backdrop closes
 *  it and shows what was picked. */
export const Interactive: Story = {
    render: () => {
        const [open, setOpen] = createSignal(false)
        const [picked, setPicked] = createSignal<string | null>(null)
        return (
            <div
                style={{
                    padding: '40px',
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '12px',
                    'align-items': 'flex-start',
                }}
            >
                <Button
                    kind="text"
                    state="selected"
                    onClick={() => setOpen(true)}
                >
                    Open icon picker
                </Button>
                <span
                    style={{
                        'font-family': 'var(--ui-font-stack)',
                        'font-size': 'var(--fs-body)',
                        color: 'var(--text-muted)',
                    }}
                >
                    Picked: {picked() ?? '(none)'}
                </span>
                {open() && (
                    <SymbolGallery
                        source={iconSource}
                        current={picked() ?? undefined}
                        onPick={v => setPicked(v)}
                        onClose={() => setOpen(false)}
                    />
                )}
            </div>
        )
    },
}
