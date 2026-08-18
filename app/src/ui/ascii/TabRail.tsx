// app/src/ui/ascii/TabRail.tsx
// Solid port of design/ascii/design-system/components/ascii/TabRail.jsx.
import { For, Show, type JSX } from 'solid-js'

export interface TabRailTab {
    id: string
    glyph: string
    label: string
}

export interface TabRailProps {
    tabs: TabRailTab[]
    value?: string
    onChange?: (id: string) => void
    open?: boolean
    onToggle?: () => void
    class?: string
}

/**
 * The vertical right-hand tab strip: glyphs only when collapsed (46px,
 * `--tabs-w-collapsed`), glyph + filename when open (232px, `--tabs-w-open`).
 * Replaces the horizontal tab strip when `settings.ui.verticalTabs` is on.
 * The active tab carries the `--grad` sheen rule on its left edge.
 */
export function TabRail(props: TabRailProps): JSX.Element {
    const open = () => props.open ?? false
    return (
        <div
            class={props.class}
            style={{
                width: open()
                    ? 'var(--tabs-w-open)'
                    : 'var(--tabs-w-collapsed)',
                flex: 'none',
                'min-height': 0,
                overflow: 'hidden',
                display: 'flex',
                'flex-direction': 'column',
                padding: '12px 0',
                'border-left': 'var(--rule)',
                background: 'var(--rail)',
                'font-size': 'var(--fs-ui)',
            }}
        >
            <div
                onClick={() => props.onToggle?.()}
                style={{
                    cursor: 'pointer',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': open() ? 'space-between' : 'center',
                    gap: 'var(--sp-3)',
                    padding: open() ? '0 12px 8px' : '0 0 8px',
                    color: 'var(--faint)',
                }}
            >
                <Show when={open()}>
                    <span class="asc-eyebrow">OPEN {props.tabs.length}</span>
                </Show>
                <span>{open() ? '>>' : '<<'}</span>
            </div>
            <For each={props.tabs}>
                {t => {
                    const active = () => t.id === props.value
                    return (
                        <div
                            onClick={() => props.onChange?.(t.id)}
                            style={{
                                position: 'relative',
                                cursor: 'pointer',
                                display: 'flex',
                                'align-items': 'center',
                                'justify-content': open()
                                    ? 'flex-start'
                                    : 'center',
                                gap: 'var(--sp-3)',
                                padding: open() ? '3px 12px' : '7px 0',
                                'font-size': open() ? 'var(--fs-ui)' : '14px',
                                background: active()
                                    ? 'var(--accent-soft)'
                                    : 'transparent',
                                color: active()
                                    ? 'var(--fg)'
                                    : 'var(--text-muted)',
                            }}
                        >
                            <span
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: '2px',
                                    background: active()
                                        ? 'var(--grad)'
                                        : 'transparent',
                                }}
                            />
                            <span
                                style={{
                                    color: open() ? 'var(--faint)' : 'inherit',
                                }}
                            >
                                {t.glyph}
                            </span>
                            <Show when={open()}>
                                <span
                                    style={{
                                        flex: 1,
                                        'white-space': 'nowrap',
                                        overflow: 'hidden',
                                    }}
                                >
                                    {t.label}
                                </span>
                                <span style={{ color: 'var(--faint)' }}>x</span>
                            </Show>
                        </div>
                    )
                }}
            </For>
            <div
                style={{
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': open() ? 'flex-start' : 'center',
                    padding: open() ? '6px 12px' : '6px 0',
                    color: 'var(--faint)',
                }}
            >
                +
            </div>
        </div>
    )
}
