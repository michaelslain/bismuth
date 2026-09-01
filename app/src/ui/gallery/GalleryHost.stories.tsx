// Visual spec for <GalleryHost> — the singleton mount point for whichever gallery
// `openGallery()` (galleryStore.ts) has queued, meant to sit ONCE near the app root (like
// ToastHost). It renders NOTHING itself when no gallery is pending, and the real
// <SymbolGallery> (already covered by SymbolGallery.stories.tsx) when one is.
//
// `openGallery` is a Solid-free, promise-based launcher — callers outside the reactive tree
// (CodeMirror completion `apply` handlers) can pop a gallery and await the pick. These stories
// exercise that exact call, not a hand-built stand-in for `pending()`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import GalleryHost from './GalleryHost'
import { openGallery } from './galleryStore'
import { iconSource } from './sources'

const meta = {
    title: 'UI/Gallery/GalleryHost',
    component: GalleryHost,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof GalleryHost>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing pending: the host mounts and renders nothing (the `<Show>` gate holds closed). This
 *  is the host's resting state for the entire life of a session in which no `:`-emoji or
 *  "Set icon" picker has ever been opened. */
export const NothingPending: Story = {
    render: () => <GalleryHost />,
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('[role="dialog"]')).toBeNull()
        expect(canvasElement.textContent?.trim()).toBe('')
    },
}

/** A gallery queued via the REAL `openGallery()` launcher before mount — the host reads
 *  `pending()` and renders the icon gallery through it, proving the promise-based seam (not
 *  just a `<Show>` on a hand-set prop) actually drives the render. SymbolGallery renders via
 *  `<Modal>`, which Portals to `document.body` (outside `canvasElement`), so the assertion
 *  reads the body — the same pattern SymbolGallery.stories.tsx's own tests use. */
export const GalleryOpen: Story = {
    render: () => {
        // No `title` override: SymbolGallery's search placeholder falls back to the source's own
        // (`iconSource.placeholder`, "Search icons…") whenever `title` is unset — passing one here
        // would replace that placeholder text with the title instead, which is what a first draft
        // of this story got wrong.
        void openGallery({ source: iconSource })
        return <GalleryHost />
    },
    play: async () => {
        const body = within(document.body)
        expect(
            await body.findByPlaceholderText('Search icons…'),
        ).toBeInTheDocument()
    },
}
