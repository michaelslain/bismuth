// app/src/FolderPrompt.tsx
// Minimal modal to type an absolute folder path for the "Open folder" command. We
// avoid window.prompt (a blocking native dialog freezes in-app automation), and the
// browser can't offer a real folder picker that yields a server-accessible path. The
// native OS picker is a desktop-build enhancement; the typed path works everywhere.
import { createSignal, onMount } from 'solid-js'
import PromptModal from './ui/PromptModal'
import PromptHint from './ui/PromptHint'
import PromptInput from './ui/PromptInput'
import { TextButton } from './ui/TextButton'
import { isConfirmKey } from './ui/widgetKeys'

export function FolderPrompt(props: {
    onClose: () => void
    onOpen: (folder: string) => void
}) {
    const [value, setValue] = createSignal('')
    let inputRef: HTMLInputElement | undefined
    onMount(() => inputRef?.focus())

    const submit = () => {
        const v = value().trim()
        if (v) props.onOpen(v)
    }

    return (
        <PromptModal
            onClose={props.onClose}
            title="Open folder"
            actions={
                <>
                    <TextButton onClick={props.onClose}>cancel</TextButton>
                    <TextButton
                        variant="selected"
                        onClick={submit}
                        disabled={value().trim() === ''}
                    >
                        open
                    </TextButton>
                </>
            }
        >
            <PromptHint>
                Absolute path to a folder. It opens as its own brain in a new
                window.
            </PromptHint>
            <PromptInput
                ref={el => (inputRef = el)}
                placeholder="/Users/you/notes"
                value={value()}
                spellcheck={false}
                autocapitalize="off"
                autocorrect="off"
                onInput={e => setValue(e.currentTarget.value)}
                onKeyDown={e => {
                    if (isConfirmKey(e)) {
                        e.preventDefault()
                        submit()
                    }
                }}
            />
        </PromptModal>
    )
}
