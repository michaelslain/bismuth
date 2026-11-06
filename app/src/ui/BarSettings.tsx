// app/src/ui/BarSettings.tsx
// A view bar's settings button and its panel: the home for the settings a person sets once and
// rarely changes (a book's layout), so they do not each take a worded control on the bar. The
// bar keeps the one switch for what the view shows plus its tools as icons; everything else is a
// labelled row here. The trigger is an icon or a text glyph (`Aa` in the book), `selected` while
// the panel is open.
import { createSignal, For, Show, type Component, type JSX } from 'solid-js'
import AnchoredPopover from './AnchoredPopover'
import IconButton from './IconButton'
import Label from './Label'
import Popover from './Popover'
import styles from './BarSettings.module.css'

export type BarSettingsRow = {
    /** Row label, lowercase words (`layout`). */
    label: string
    /** The live control for this setting. */
    control: JSX.Element
}

export type BarSettingsProps = {
    /** The trigger's accessible name and tooltip (`display`). */
    label: string
    /** Trigger icon name; give `icon` or `glyph`. Defaults to `Settings2` (sliders). */
    icon?: string
    /** Trigger text glyph (`Aa`), drawn in the bar's text font. */
    glyph?: string
    rows: BarSettingsRow[]
    /** Starts open, for stories. */
    defaultOpen?: boolean
    class?: string
}

const BarSettings: Component<BarSettingsProps> = props => {
    const [open, setOpen] = createSignal(props.defaultOpen ?? false)
    const [anchor, setAnchor] = createSignal<HTMLElement>()
    const close = () => {
        setOpen(false)
        anchor()?.focus()
    }
    // One fixed face per branch (an icon or a text glyph, never both): the face says what the
    // button is, and `selected` alone says the panel is open.
    const trigger = (face: { icon: string } | { glyph: string }) => (
        <IconButton
            {...face}
            label={props.label}
            variant={open() ? 'selected' : 'unselected'}
            aria-haspopup="true"
            aria-expanded={open()}
            class={props.class}
            data-bar-settings
            ref={setAnchor}
            onClick={e => {
                setAnchor(e.currentTarget)
                setOpen(!open())
            }}
        />
    )
    return (
        <>
            <Show when={props.glyph} fallback={trigger({ icon: props.icon ?? 'Settings2' })}>
                {glyph => trigger({ glyph: glyph() })}
            </Show>
            <AnchoredPopover
                open={open()}
                anchor={anchor}
                toggleEl={anchor}
                onAnchorPress={close}
                onDismiss={close}
                placement="below"
                align="end"
            >
                <Show when={open()}>
                    <Popover tone="panel">
                        <div class={styles.rows} data-bar-settings-panel>
                            <For each={props.rows}>
                                {row => (
                                    <>
                                        <Label tone="muted">{row.label}</Label>
                                        <div class={styles.control}>{row.control}</div>
                                    </>
                                )}
                            </For>
                        </div>
                    </Popover>
                </Show>
            </AnchoredPopover>
        </>
    )
}

export default BarSettings
