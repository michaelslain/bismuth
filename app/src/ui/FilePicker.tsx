import { splitProps, type Component } from 'solid-js'
import styles from './FilePicker.module.css'

export type FilePickerProps = {
    /** MIME type / extension filter passed straight to the native dialog, e.g. `"image/*"`. */
    accept?: string
    /** Allow picking more than one file at once. */
    multiple?: boolean
    /** Called with the picked `FileList` once the native dialog resolves with a selection.
     *  Not called on cancel. */
    onPick: (files: FileList) => void
    class?: string
    ref?: (el: HTMLInputElement) => void
}

/**
 * A visually-hidden native `<input type="file">` backing a visible trigger button elsewhere in
 * the tree — there is no styled "choose file" chrome to theme, so the primitive is the input
 * itself. The caller keeps a `ref` to it and calls `.click()` from its own button's `onClick`
 * (see drawing/DrawingPage.tsx's toolbar Import-image button). Resets its own value after each
 * pick so the same file can be re-selected later.
 */
const FilePicker: Component<FilePickerProps> = props => {
    const [local, rest] = splitProps(props, [
        'accept',
        'multiple',
        'onPick',
        'class',
        'ref',
    ])
    return (
        <input
            type="file"
            ref={local.ref}
            class={`${styles['file-picker']} ${local.class ?? ''}`}
            accept={local.accept}
            multiple={local.multiple}
            onChange={e => {
                const input = e.currentTarget
                if (input.files && input.files.length) local.onPick(input.files)
                input.value = '' // let the same file be re-picked later
            }}
            {...rest}
        />
    )
}

export default FilePicker
export { FilePicker }
