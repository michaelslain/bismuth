// Visual spec for <Toolbar> — the floating bottom-center drawing tool dock (design's
// .drawtools): tools | color/size | smooth/paper | undo-redo/zoom, each an optional group.
// `.draw-toolbar` is `position: absolute; bottom: 20px` against its nearest positioned
// ancestor — DrawingPage.tsx supplies that via `.draw-app { position: relative }` — so
// these stories reproduce that same real wrapper class rather than a fabricated one.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { Toolbar } from './Toolbar'
import type { ToolState } from './DrawingCanvas'
import type { PaperBg } from '../../../core/src/drawing/model'
import './Drawing.css'

const meta = {
    title: 'Drawing/Toolbar',
    component: Toolbar,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof Toolbar>

export default meta
type Story = StoryObj<typeof meta>

function useToolState() {
    const [tools, setToolsSig] = createSignal<ToolState>({
        tool: 'pen',
        color: 'fg',
        size: 5,
        smoothMode: 'smooth',
        holdToStraighten: true,
        holdDelayMs: 900,
    })
    const setTools = (patch: Partial<ToolState>) =>
        setToolsSig(t => ({ ...t, ...patch }))
    return { tools, setTools }
}

/** The full page-drawing dock (DrawingPage.tsx's own usage): tools, color/size, smooth +
 *  paper background, undo/redo + zoom — every optional group present. */
export const Full: Story = {
    render: () => {
        const { tools, setTools } = useToolState()
        const [bg, setBg] = createSignal<PaperBg>('grid')
        const [zoom, setZoom] = createSignal(1)
        return (
            <div class="draw-app" style={{ height: '220px' }}>
                <Toolbar
                    tools={tools}
                    setTools={setTools}
                    bg={bg}
                    setBackground={setBg}
                    onUndo={() => {}}
                    onRedo={() => {}}
                    zoom={zoom}
                    onZoomIn={() =>
                        setZoom(z =>
                            Math.min(4, Math.round((z + 0.05) * 100) / 100),
                        )
                    }
                    onZoomOut={() =>
                        setZoom(z =>
                            Math.max(0.25, Math.round((z - 0.05) * 100) / 100),
                        )
                    }
                    onResetZoom={() => setZoom(1)}
                    onImportImage={() => {}}
                />
            </div>
        )
    },
}

/** The minimal note-ink overlay usage (app/src/editor/InkOverlay.tsx's real call site):
 *  no paper background, no zoom, no image import — only tools, color/size, smooth, and
 *  undo/redo, since ink annotates a note rather than a dedicated `.draw` page. */
export const Minimal: Story = {
    render: () => {
        const { tools, setTools } = useToolState()
        return (
            <div class="draw-app" style={{ height: '160px' }}>
                <Toolbar
                    tools={tools}
                    setTools={setTools}
                    onUndo={() => {}}
                    onRedo={() => {}}
                />
            </div>
        )
    },
}
