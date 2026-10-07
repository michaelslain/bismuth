import type { Component, JSX } from 'solid-js'
import Text from './Text'
import styles from './SectionLabel.module.css'

export type SectionLabelProps = {
    /** 'div' (default) heads a block of rows; 'span' sits inline in front of a control on one row. */
    as?: 'div' | 'span'
    class?: string
    children: JSX.Element
}

/**
 * The head of a section or group inside a panel — `anthropic` over its models, `providers` over the
 * connected list, `effort` before its toggle. Lowercase, untracked, `--fs-ui`, `--text-muted` (a caption is content a person reads, so never `--faint`, which is structure): the
 * ModalHeader-title register, never the uppercase eyebrow (DESIGN.md › Overlays). Padding is NOT
 * here — the caller's row or column owns its gutter.
 */
const SectionLabel: Component<SectionLabelProps> = props => (
    <Text
        as={props.as ?? 'div'}
        size="ui"
        tone="muted"
        class={[styles['section-label'], props.class].filter(Boolean).join(' ')}
    >
        {props.children}
    </Text>
)

export default SectionLabel
