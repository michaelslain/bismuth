// app/src/palette/PaletteFrame.tsx
// The shared overlay shell every palette-family surface renders: a `<Modal>` panel sized/fonted
// by `.palette-panel`, with a `size="large" prompt=">"` SearchBar on top.
// Extracted so PaletteModal.tsx and ui/gallery/SymbolGallery.tsx compose ONE component instead
// of both importing the former Palette.module.css directly.
import type { JSX } from 'solid-js'
import { Modal } from '../ui/Modal'
import SearchBar from '../ui/SearchBar'
import Text from '../ui/Text'
import styles from './PaletteFrame.module.css'

export type PaletteFrameProps = {
    /** Extra class on the Modal panel (e.g. SymbolGallery's self-doubled `.icon-picker-panel`
     *  max-width override). */
    class?: string
    onClose: () => void
    label?: string
    /** Escape hatch for a caller that needs the panel DOM node (see ModalProps.panelRef). */
    panelRef?: (el: HTMLDivElement) => void
    placeholder: string
    value: string
    onInput: (value: string) => void
    onKeyDown?: (e: KeyboardEvent) => void
    inputRef?: (el: HTMLInputElement) => void
    children: JSX.Element
    /** Prompt glyph; defaults to SearchBar's `/`. The command palette passes `>`. */
    prompt?: string
}

function PaletteFrame(props: PaletteFrameProps) {
    return (
        <Modal
            onClose={props.onClose}
            label={props.label}
            panelRef={props.panelRef}
            class={`${styles['palette-panel']} ${props.class ?? ''}`}
        >
            <SearchBar
                size="large"
                prompt={props.prompt}
                inputRef={props.inputRef}
                placeholder={props.placeholder}
                value={props.value}
                onInput={props.onInput}
                onKeyDown={props.onKeyDown}
            />
            {props.children}
        </Modal>
    )
}

export default PaletteFrame

/** The "No matches" message both PaletteModal and SymbolGallery show under an empty result
 *  set — same register as a palette row, so an empty list doesn't jump to a different type
 *  scale. */
export function PaletteEmpty(props: { children: JSX.Element }) {
    return (
        <Text as="div" inherit class={styles['palette-empty']}>
            {props.children}
        </Text>
    )
}
