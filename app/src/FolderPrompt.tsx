// app/src/FolderPrompt.tsx
// Minimal modal to type an absolute folder path for the "Open folder" command. We
// avoid window.prompt (a blocking native dialog freezes in-app automation), and the
// browser can't offer a real folder picker that yields a server-accessible path. The
// native OS picker is a desktop-build enhancement; the typed path works everywhere.
import { createSignal } from 'solid-js'
import FormModal from './ui/FormModal'
import ModalHeader from './ui/ModalHeader'
import ModalBody from './ui/ModalBody'
import ModalFooter from './ui/ModalFooter'
import SettingsField from './ui/SettingsField'
import Text from './ui/Text'
import TextInput from './ui/TextInput'
import { TextButton } from './ui/TextButton'
import { isConfirmKey } from './ui/widgetKeys'

export function FolderPrompt(props: {
    onClose: () => void
    onOpen: (folder: string) => void
}) {
    const [value, setValue] = createSignal('')

    const submit = () => {
        const v = value().trim()
        if (v) props.onOpen(v)
    }

    return (
        <FormModal
            onClose={props.onClose}
            width={460}
            closeOnBackdrop={false}
            label="open folder"
        >
            <ModalHeader title="open folder" onClose={props.onClose} />
            <ModalBody>
                <Text size="ui" tone="faint">
                    absolute path to a folder — it opens as its own brain in a new
                    window
                </Text>
                <SettingsField label="path">
                    <TextInput
                        placeholder="/Users/you/notes"
                        value={value()}
                        onInput={setValue}
                        spellcheck={false}
                        autocapitalize="off"
                        autocorrect="off"
                        onKeyDown={e => {
                            if (isConfirmKey(e)) {
                                e.preventDefault()
                                submit()
                            }
                        }}
                    />
                </SettingsField>
            </ModalBody>
            <ModalFooter hint="cancel">
                <TextButton onClick={props.onClose}>cancel</TextButton>
                <TextButton
                    primary
                    onClick={submit}
                    disabled={value().trim() === ''}
                >
                    open
                </TextButton>
            </ModalFooter>
        </FormModal>
    )
}
