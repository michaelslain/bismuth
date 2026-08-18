// Visual spec for <TopStrip> — the wordmark + platform titlebar strip that sits above `.layout`
// (design/ascii/README.md "App shell", §1).
//
// WHY THIS FILE EXISTS: `.top-strip`, `.top-strip--mac` and `.top-strip-spacer` are about to move
// from the global App.css into TopStrip.module.css, which HASHES every class name. A name left
// behind as a string literal still compiles and still renders, it just matches nothing — the
// wordmark loses its flex row, the spacer stops pushing WindowControls to the edge, and macOS
// loses its 78px traffic-light reservation. Nothing else in the repo can see that: typecheck reads
// no CSS, and Bun resolves `solid-js/web` to its server build so no unit test can mount a Solid
// component at all. `bench/cssBaseline.ts` reads computed styles off Storybook, so this story IS
// the gate — and it was recorded BEFORE the CSS moved, while the class names were still the
// pre-migration global literals. That ordering is the only one under which a subsequent
// "0 changed" means the migration preserved the rendering; a story first recorded after the move
// would have blessed whatever it happened to render, broken included.
//
// NO FIXTURE SEAM NEEDED: the component takes two booleans and a `children` slot, holds no state,
// fetches nothing, and reads no context. The Storybook-wide setup in .storybook/preview.ts already
// supplies the real theme tokens this needs (`--faint`, `--r-control`, `--ui-font-stack`, and the
// gradient `.asc-wordmark` reads via `--grad`), projected onto :root exactly as App.tsx projects
// them.
//
// THREE STORIES, ONE PER PLATFORM SHAPE: `Default` is the browser/dev build (no `mac` padding, no
// WindowControls). `Mac` reserves the 78px of left padding for the native traffic lights and
// renders no children (macOS never gets typed controls). `WindowsLinux` renders real
// `<WindowControls>` as children, the only story that exercises the `children` slot at all. Each
// gets a fixed-width wrapper so `.top-strip-spacer`'s `flex: 1` — the strip's largest visual area —
// is actually observable rather than collapsing to its content size.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { TopStrip } from './TopStrip'
import { WindowControls } from './WindowControls'

const noop = () => {}

const meta = {
    title: 'Shell/TopStrip',
    component: TopStrip,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TopStrip>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div style={{ width: '360px', border: '1px solid var(--border-soft)' }}>
        {props.children as never}
    </div>
)

/** Browser/dev build: no Tauri, so `mac` and `dragRegion` are both false and no children render —
 *  just the wordmark and the spacer filling the row. */
export const Default: Story = {
    render: () => (
        <Wrap>
            <TopStrip mac={false} dragRegion={false} />
        </Wrap>
    ),
}

/** macOS Tauri build: the native Overlay titlebar draws its own traffic lights over the strip, so
 *  `top-strip--mac` reserves 78px of left padding for them and no WindowControls render (macOS
 *  never gets the typed `[-] [+] [x]` buttons). */
export const Mac: Story = {
    render: () => (
        <Wrap>
            <TopStrip mac={true} dragRegion={true} />
        </Wrap>
    ),
}

/** Windows/Linux Tauri build: fully undecorated window, so the typed WindowControls render as
 *  `children` at the right edge, pushed there by the spacer. The only story exercising the slot. */
export const WindowsLinux: Story = {
    render: () => (
        <Wrap>
            <TopStrip mac={false} dragRegion={true}>
                <WindowControls
                    onMinimize={noop}
                    onToggleMaximize={noop}
                    onClose={noop}
                />
            </TopStrip>
        </Wrap>
    ),
}
