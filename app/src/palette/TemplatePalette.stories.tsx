// Visual spec for <TemplatePalette> — Option+T's fuzzy template picker. Loads the vault's
// template list via `api.templates()` (createResource) and only renders the PaletteModal once
// that resolves (`<Show when={templates()}>`) — there is no separate loading UI, so an unfilled
// resource is a genuinely blank story, not a bug to work around.
//
// `.storybook/preview.ts`'s global fakeTransport has no built-in `/templates` route (it only
// answers /tree, /version, /file, /daemon/*, /graph, /update/status, /rows and throws loudly on
// anything else — see ui/_fakeTransport.ts), so every story here layers a small wrapper around
// it that adds `GET /templates` rather than fabricating a bespoke transport from scratch.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { TemplatePalette } from './TemplatePalette'
import { setTransport, type Transport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'

const meta = {
    title: 'Palette/TemplatePalette',
    component: TemplatePalette,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TemplatePalette>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Layers a fixed `GET /templates` response onto the shared fakeTransport (which otherwise
 *  throws on that path) — same "wrap the shared fake" approach as any story needing a route
 *  the fake doesn't cover out of the box. */
function withTemplates(templates: { name: string; path: string }[]): Transport {
    const base = fakeTransport({
        files: { 'templates/Meeting notes.md': '# {{title}}\n\n{{cursor}}' },
    })
    return {
        ...base,
        getJson: async <T,>(path: string): Promise<T> => {
            if (path === '/templates') return templates as unknown as T
            return base.getJson<T>(path)
        },
    }
}

const SAMPLE_TEMPLATES = [
    { name: 'Meeting notes', path: 'templates/Meeting notes.md' },
    { name: 'Daily note', path: 'templates/Daily note.md' },
    { name: 'Project kickoff', path: 'templates/Project kickoff.md' },
    { name: 'Retro', path: 'templates/Retro.md' },
]

/** Open, resolved with a handful of vault templates — the fuzzy list at rest. */
export const Default: Story = {
    render: () => {
        setTransport(withTemplates(SAMPLE_TEMPLATES))
        return <TemplatePalette onClose={noop} title="New Note" />
    },
}

/** No templates configured — PaletteModal's emptyText names the exact setting to fix it
 *  (`templates.folder`), not a generic "no results" message. */
export const NoTemplates: Story = {
    render: () => {
        setTransport(withTemplates([]))
        return <TemplatePalette onClose={noop} title="New Note" />
    },
}
