// Visual spec for <ModalBody> — the scrolling middle of a FormModal (was
// `.evm-modal .evm-body` in calendar/Calendar.module.css). Mounted inside a real <FormModal> here
// (rather than a bare shell) because its scroll behaviour only shows up against the column-flex
// panel that caps its height — see ModalBody.module.css's header comment.
//
// <Modal> mounts via a Solid <Portal> straight onto document.body — outside
// canvasElement/#storybook-root entirely (see Modal.tsx). So the play below queries `document`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { For } from 'solid-js'
import ModalBody from './ModalBody'
import FormModal from './FormModal'
import ModalHeader from './ModalHeader'
import ModalFooter from './ModalFooter'
import { TextButton } from './TextButton'
import Text from './Text'

const meta = {
    title: 'UI/ModalBody',
    component: ModalBody,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ModalBody>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}
const LINES = Array.from({ length: 40 }, (_, i) => i + 1)

/** 40 lines of content inside a FormModal — taller than the panel's capped height, so the BODY
 *  scrolls while the header/footer stay pinned. */
export const ScrollsWhenTall: Story = {
    render: () => (
        <FormModal onClose={noop} label="Long form">
            <ModalHeader title="Long form" onClose={noop} />
            <ModalBody>
                <For each={LINES}>
                    {n => (
                        <Text>
                            {`Line ${n} of body copy, tall enough to force scrolling.`}
                        </Text>
                    )}
                </For>
            </ModalBody>
            <ModalFooter hint="cancel">
                <TextButton onClick={noop}>
                    cancel
                </TextButton>
            </ModalFooter>
        </FormModal>
    ),
    play: async () => {
        // Fails if ModalBody stops being the scroller — e.g. `overflow-y: auto` or
        // `min-height: 0` is dropped and the PANEL grows/overflows the viewport instead of the
        // body scrolling internally.
        const panel = document.querySelector<HTMLElement>('[role="dialog"]')!
        const body = panel.querySelector<HTMLElement>(
            '[data-testid="modal-body"]',
        )!
        expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
        // scrollHeight > clientHeight alone is also true when the body CLIPS its content
        // (overflow: hidden) instead of scrolling it — that comparison only proves the content is
        // taller than the box, not that the box can scroll. Setting scrollTop doesn't fully
        // separate the two either: overflow: hidden IS a scroll container (script CAN set its
        // scrollTop and the content shifts) — it just paints no scrollbar and ignores the user's
        // own wheel/drag. Only overflow: visible/clip refuse programmatic scrollTop, clamping it
        // straight back to 0. So the real proof is the computed overflow-y itself: it must
        // actually be auto/scroll, the only values a person can operate.
        body.scrollTop = 60
        await new Promise(r => setTimeout(r, 0))
        expect(body.scrollTop).toBeGreaterThan(0)
        expect(['auto', 'scroll']).toContain(
            getComputedStyle(body).overflowY,
        )
        expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(
            window.innerHeight,
        )
    },
}
