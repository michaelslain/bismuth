// Visual spec for <ViewBar> + <Crumb> + <VBtn> — the canonical 36px view header used across
// graph/bases/calendar/flashcards. The bar takes NAMED REGION SLOTS (identity · locus · facet on
// the left, readouts · config · actions on the right), not positional children, so these stories
// compose it exactly as call sites do (see GraphView.tsx / bases/BaseView.tsx) rather than
// rendering each piece in isolation.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, type JSX } from 'solid-js'
import ViewBar, { Crumb, VBtn } from './ViewBar'
import { SegmentedToggle } from './SegmentedToggle'
import { IconButton } from './IconButton'

const meta = {
    title: 'UI/ViewBar',
    parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// ViewBar is a bare header strip (no side padding beyond its own), so give the story
// canvas a body to sit above, matching a real content view.
function Frame(props: { children: JSX.Element }) {
    return (
        <div
            style={{
                width: '640px',
                border: '1px solid var(--border)',
                'border-radius': 'var(--r-0)',
                overflow: 'hidden',
                background: 'var(--bg)',
            }}
        >
            {props.children}
            <div
                style={{
                    height: '160px',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                    color: 'var(--faint)',
                    'font-size': 'var(--fs-body)',
                }}
            >
                (view content)
            </div>
        </div>
    )
}

/** A breadcrumb only — the simplest bar (e.g. a single-view base with no tabs). */
export const CrumbOnly: Story = {
    render: () => (
        <Frame>
            <ViewBar identity={<Crumb icon="Table">Reading List</Crumb>} />
        </Frame>
    ),
}

/** Breadcrumb + view tabs + a settings toggle on the right (the Bases shape). */
export const WithTabsAndActions: Story = {
    render: () => {
        const [view, setView] = createSignal(0)
        const [settingsOpen, setSettingsOpen] = createSignal(false)
        return (
            <Frame>
                <ViewBar
                    identity={<Crumb icon="Table">Reading List</Crumb>}
                    facet={
                        <SegmentedToggle
                            value={view()}
                            onChange={setView}
                            options={[
                                { id: 0, label: 'Table' },
                                { id: 1, label: 'Cards' },
                                { id: 2, label: 'Kanban' },
                            ]}
                        />
                    }
                    actions={
                        <>
                            <VBtn
                                icon="Settings"
                                title="Settings"
                                active={settingsOpen()}
                                onClick={() => setSettingsOpen(v => !v)}
                            />
                            <IconButton icon="Code" label="Source" />
                        </>
                    }
                />
            </Frame>
        )
    },
}

/** A serif crumb title (the standalone calendar month heading shape) + a mode switcher
 *  on the far right — the Knowledge Graph header shape. */
export const SerifCrumbWithModeSwitcher: Story = {
    render: () => {
        const [mode, setMode] = createSignal('2d')
        return (
            <Frame>
                <ViewBar
                    identity={
                        <Crumb icon="Share2" serif>
                            Knowledge Graph
                        </Crumb>
                    }
                    config={
                        <SegmentedToggle
                            value={mode()}
                            onChange={setMode}
                            size="sm"
                            options={[
                                { id: '2d', label: '2D' },
                                { id: '3d', label: '3D' },
                            ]}
                        />
                    }
                />
            </Frame>
        )
    },
}

/** Every region populated at once — the layout contract each view composes against. */
export const AllRegions: Story = {
    render: () => (
        <Frame>
            <ViewBar
                identity={<Crumb icon="Table">Reading List</Crumb>}
                locus={<VBtn icon="ChevronLeft" title="Previous" />}
                facet={<VBtn title="TABLE" active />}
                readouts={<span data-testid="vb-readout">42 rows</span>}
                config={<VBtn icon="Settings" title="Settings" />}
                actions={<VBtn icon="Plus" title="New" />}
            />
        </Frame>
    ),
}

/** No slot but identity — the bar must not render empty region wrappers or their gaps. */
export const IdentityOnly: Story = {
    render: () => (
        <Frame>
            <ViewBar identity={<Crumb icon="Inbox">Inbox</Crumb>} />
        </Frame>
    ),
}
