// Visual spec for <WindowControls> — the typed `[-] [+] [x]` titlebar buttons at the right edge of
// the top strip on Windows and Linux, where the Tauri window ships fully undecorated.
//
// WHY THIS FILE EXISTS: nobody sees these buttons by accident. App.tsx gates them on
// `isTauri() && !IS_MAC_PLATFORM`, so they are absent from every browser/dev build and from every
// macOS build — which is every machine this repo is developed on. The four rules behind them have
// moved from the global App.css into WindowControls.module.css, which HASHES every class name; a name
// left behind as a string literal still compiles and still renders, it just matches nothing, and
// three unstyled buttons appear in a window no developer here ever opens. Nothing else in the
// repo can see that: typecheck reads no CSS, and Bun resolves `solid-js/web` to its server build so
// no unit test can mount a Solid component at all. `bench/cssBaseline.ts` reads computed styles off
// Storybook, so this story IS the gate — and it was recorded BEFORE the CSS moved, while the class
// names were still the pre-migration global literals. That ordering is the only one under which a
// subsequent "0 changed" means the migration preserved the rendering; a story first recorded after
// the move would have blessed whatever it happened to render, broken included.
//
// NO FIXTURE SEAM NEEDED: the component takes three callbacks and holds no state, fetches nothing,
// and reads no context. The Storybook-wide setup in .storybook/preview.ts already supplies
// everything it depends on — the real theme tokens (`--faint`, `--hover-bg`, `--r-control`,
// `--ui-font-stack`) projected onto :root exactly as App.tsx projects them, and the app's interface
// font on `body`, which matters here because `.win-btn` declares `font: inherit`.
//
// ONE STORY IS ENOUGH, AND WHAT THAT LEAVES UNCOVERED: there is no state to pose. Two of the four
// rules — `.win-btn:hover` and `.win-btn--close:hover` — are `:hover`-only and therefore
// unreachable from any story: CSS `:hover` follows the real pointer, and `userEvent.hover`
// dispatches events without moving it. The baseline records the resting state only, so the hovered
// colour and the close button's red tint are NOT protected by it. `bench/moduleClassCheck.ts` proves
// the hashed names still reach the emitted JS; nothing proves the hovered appearance. That gap is
// stated rather than papered over with a story that hand-writes its own `.win-controls` div — such a
// story would render the CSS while proving nothing about the component. (Written with a bare
// selector, not a quoted class attribute, so it does not show up as a false positive in the
// leftover-literal sweep this migration runs over `win-`.)
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { WindowControls } from './WindowControls'

const noop = () => {}

const meta = {
    title: 'Shell/WindowControls',
    component: WindowControls,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof WindowControls>

export default meta
type Story = StoryObj<typeof meta>

/** The three buttons at rest — the only state that exists. Covers the flex row (`win-controls`, 2px
 *  gap) and both resting-state rules on the buttons themselves (`win-btn`'s inherited font, muted
 *  `--faint` colour, transparent background, `4px 8px` padding and `--r-control` radius). The close
 *  button carries `win-btn--close` too, whose only rule is a `:hover` one, so it looks identical to
 *  its siblings here by design. */
export const Default: Story = {
    render: () => (
        <WindowControls
            onMinimize={noop}
            onToggleMaximize={noop}
            onClose={noop}
        />
    ),
}
