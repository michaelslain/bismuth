// Visual spec for <FormModal> — the settings/editor modal shell (a <Modal> panel sized as a
// column, was `.evm-modal` in calendar/Calendar.module.css, shared by six modals). Wraps its own
// <Modal>, so the story just needs a fullscreen canvas for the backdrop to fill — same pattern as
// calendar/components/RecurrenceDialog.stories.tsx.
//
// <Modal> mounts via a Solid <Portal> straight onto document.body — outside
// canvasElement/#storybook-root entirely (see Modal.tsx). So the width play below queries
// `document`, not `canvasElement`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Show, createSignal } from 'solid-js'
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
            <ModalFooter hint="cancel">
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
            <ModalFooter hint="cancel">
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
            <ModalFooter hint="cancel">
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
                <ModalFooter hint="cancel">
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

/** The seam the two late-mount stories below flip from play(): their body control is gated on it,
 *  the way QueryBuilder's sections are gated on a `createResource`. Module-scoped so play() can
 *  reach it; each render resets it, so a re-render starts from the not-yet-loaded state. */
const [lateBodyReady, setLateBodyReady] = createSignal(false)

/** Resolve after `n` animation frames — long enough that any fixed "re-check after a frame or
 *  two" in Modal's initial focus has already run and given up before the body mounts. */
const frames = (n: number) =>
    new Promise<void>(resolve => {
        const step = (left: number) =>
            left ? requestAnimationFrame(() => step(left - 1)) : resolve()
        step(n)
    })

const LateBodyModal = (props: { withFooter?: boolean }) => {
    const [value, setValue] = createSignal('')
    setLateBodyReady(false)
    return (
        <FormModal onClose={noop} label="rename note">
            <ModalHeader title="rename note" onClose={noop} />
            <ModalBody>
                <Show when={lateBodyReady()}>
                    <SettingsField label="name">
                        <TextInput value={value()} onInput={setValue} />
                    </SettingsField>
                </Show>
            </ModalBody>
            <Show when={props.withFooter}>
                <ModalFooter hint="cancel">
                    <TextButton onClick={noop}>cancel</TextButton>
                </ModalFooter>
            </Show>
        </FormModal>
    )
}

/** A body control that mounts well AFTER the dialog (a fetch-gated body, like QueryBuilder's):
 *  until it exists the only control is the header's `[x]`, so initial focus parks there — and
 *  must move to the body control the moment it appears, not stay on close. */
export const FocusFollowsLateBodyControl: Story = {
    render: () => <LateBodyModal />,
    play: async () => {
        await waitFor(() =>
            expect(
                document.activeElement?.matches('[data-modal-close]'),
            ).toBe(true),
        )
        await frames(3)
        setLateBodyReady(true)
        await waitFor(() =>
            expect(document.activeElement).toBe(
                document.querySelector('[role="dialog"] input'),
            ),
        )
        expect(
            document.activeElement?.matches('[data-modal-close]'),
        ).toBe(false)
    },
}

/** The other half of the late-mount contract: once focus has moved somewhere Modal did not put
 *  it, a body control mounting afterwards must NOT pull focus back into the body. */
export const LateBodyControlNeverStealsMovedFocus: Story = {
    render: () => <LateBodyModal withFooter />,
    play: async () => {
        const cancel = () =>
            document.querySelector(
                '[role="dialog"] button:not([data-modal-close])',
            )
        await waitFor(() => expect(document.activeElement).toBe(cancel()))
        const close = document.querySelector(
            '[data-modal-close]',
        ) as HTMLElement
        close.focus()
        setLateBodyReady(true)
        await waitFor(() =>
            expect(document.querySelector('[role="dialog"] input')).not.toBe(
                null,
            ),
        )
        await frames(3)
        expect(document.activeElement).toBe(close)
    },
}
