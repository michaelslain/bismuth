// Visual spec for <FormModal> — the settings/editor modal shell (a <Modal> panel sized as a
// column, was `.evm-modal` in calendar/Calendar.module.css, shared by six modals). Wraps its own
// <Modal>, so the story just needs a fullscreen canvas for the backdrop to fill — same pattern as
// ui/PromptModal.stories.tsx and calendar/components/RecurrenceDialog.stories.tsx.
//
// <Modal> mounts via a Solid <Portal> straight onto document.body — outside
// canvasElement/#storybook-root entirely (see Modal.tsx). So the width play below queries
// `document`, not `canvasElement`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import FormModal from './FormModal'
import ModalHeader from './ModalHeader'
import ModalBody from './ModalBody'
import ModalFooter from './ModalFooter'
import SettingsField from './SettingsField'
import TextInput from './TextInput'
import { TextButton } from './TextButton'
import Text from './Text'

const meta = {
    title: 'UI/FormModal',
    component: FormModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FormModal>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** ModalHeader + ModalBody + ModalFooter at the default 548px width — the shape every FormModal
 *  consumer composes (see calendar/components/RecurrenceDialog.tsx:97-135). */
export const Default: Story = {
    render: () => (
        <FormModal onClose={noop} label="example form">
            <ModalHeader
                title="example form"
                subtitle="a representative formmodal composition"
                onClose={noop}
            />
            <ModalBody>
                <Text>
                    First paragraph of body copy, standing in for a form's
                    opening description.
                </Text>
                <Text>
                    Second paragraph, a little more detail about the fields a
                    real consumer would put here.
                </Text>
                <Text>Third and last paragraph, closing things out.</Text>
            </ModalBody>
            <ModalFooter hint="to cancel">
                <TextButton onClick={noop}>
                    cancel
                </TextButton>
            </ModalFooter>
        </FormModal>
    ),
}

/** width={420} — the recurrence dialog's size. Proves the `width` prop actually reaches the
 *  panel via the `--form-modal-width` custom property FormModal's panelRef sets, and that the
 *  header's top-rule geometry still joins the frame's side borders at this narrower width. */
export const NarrowWidth420: Story = {
    render: () => (
        <FormModal onClose={noop} label="narrow example" width={420}>
            <ModalHeader title="narrow example" onClose={noop} />
            <ModalBody>
                <Text>
                    This panel is pinned to 420px instead of the 548px
                    default.
                </Text>
            </ModalBody>
            <ModalFooter hint="to cancel">
                <TextButton onClick={noop}>
                    cancel
                </TextButton>
            </ModalFooter>
        </FormModal>
    ),
    play: async () => {
        // Fails if the width prop stops applying — e.g. panelRef stops setting
        // --form-modal-width, or FormModal.module.css stops reading that custom property.
        const panel = document.querySelector<HTMLElement>('[role="dialog"]')!
        expect(Math.round(panel.getBoundingClientRect().width)).toBe(420)
    },
}

/** width={600} — the query builder's size, the widest FormModal consumer. Same geometry proof
 *  as the 420 story, at the other end of the range Review Focus calls out (420/460/548/600). */
export const WideWidth600: Story = {
    render: () => (
        <FormModal onClose={noop} label="wide example" width={600}>
            <ModalHeader title="wide example" onClose={noop} />
            <ModalBody>
                <Text>This panel is pinned to 600px.</Text>
            </ModalBody>
            <ModalFooter hint="to cancel">
                <TextButton onClick={noop}>
                    cancel
                </TextButton>
            </ModalFooter>
        </FormModal>
    ),
    play: async () => {
        const panel = document.querySelector<HTMLElement>('[role="dialog"]')!
        expect(Math.round(panel.getBoundingClientRect().width)).toBe(600)
    },
}

/** A real field in the body — proves the initial-focus rule (Modal.tsx) lands on the first body
 *  control, not the header's `[x]` (`[data-modal-close]`), once a modal actually has one. */
export const FocusLandsInBody: Story = {
    render: () => {
        const [value, setValue] = createSignal('')
        return (
            <FormModal onClose={noop} label="rename note">
                <ModalHeader title="rename note" onClose={noop} />
                <ModalBody>
                    <SettingsField label="name">
                        <TextInput value={value()} onInput={setValue} />
                    </SettingsField>
                </ModalBody>
                <ModalFooter hint="to cancel">
                    <TextButton onClick={noop}>
                        cancel
                    </TextButton>
                </ModalFooter>
            </FormModal>
        )
    },
    play: async () => {
        const input = document.querySelector('input')
        await waitFor(() => expect(document.activeElement).toBe(input))
        expect(
            document.activeElement?.matches('[data-modal-close]'),
        ).toBe(false)
    },
}
