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
            <ModalHeader icon="list" title="Long form" compact onClose={noop} />
            <ModalBody>
                <For each={LINES}>
                    {n => (
                        <Text>
                            {`Line ${n} of body copy, tall enough to force scrolling.`}
                        </Text>
                    )}
                </For>
            </ModalBody>
            <ModalFooter hint="to cancel">
                <TextButton size="sm" onClick={noop}>
                    CANCEL
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
        expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(
            window.innerHeight,
        )
    },
}
