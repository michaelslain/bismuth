import { createSignal, onMount, onCleanup, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { CalendarEvent, Category } from '../types'
import { showEventModal, settings, recurrenceAction } from '../state'
import { deleteEventWithUndo, duplicateEvent } from '../eventActions'
import { isOpenableUrl } from '../openableUrl'
import CalendarChip from './CalendarChip'
import { formatTime } from '../dates'
import { eventCategoryColors, categoryFill } from '../categoryColor'
import { EventStore } from '../EventStore'
import { ContextMenu } from '../../ContextMenu'
import { IconButton } from '../../ui/IconButton'
import Text from '../../ui/Text'
import { gestureStops } from '../../ui/stopGestures'
import styles from './EventChip.module.css'

interface Props {
    event: CalendarEvent
    masterId?: string
    occurrenceDate?: string
    categories: Category[]
    store: EventStore
    compact?: boolean
    /** This chip fills an absolutely-positioned time-grid slot. */
    inGrid?: boolean
}

export function EventChip(props: Props) {
    // The chip is tinted by its category's colour (a theme token → var(--token), or a
    // custom colour). Multiple categories blend into a linear-gradient across the chip;
    // events with no resolvable category render as an outline-only ghost.
    const chipColors = () => eventCategoryColors(props.event, props.categories)
    const hasCategory = () => chipColors().length > 0
    const chipBg = () => categoryFill(chipColors())
    const military = () => settings.value.militaryTime

    let chipRef: HTMLDivElement | undefined
    let metaRef: HTMLDivElement | undefined
    const [metaVisible, setMetaVisible] = createSignal(true)
    const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null)

    function openEdit(): void {
        showEventModal.value = {
            event: props.event,
            masterId: props.masterId,
            occurrenceDate: props.occurrenceDate,
        }
    }

    async function handleDelete(): Promise<void> {
        if (props.event.recurrence && props.masterId && props.occurrenceDate) {
            recurrenceAction.value = {
                type: 'delete',
                masterId: props.masterId,
                occurrenceDate: props.occurrenceDate,
            }
        } else {
            await deleteEventWithUndo(props.store, props.event)
        }
    }

    async function handleDuplicate(): Promise<void> {
        await duplicateEvent(props.store, props.event)
    }

    const label = () =>
        [props.event.title, props.event.startTime, props.event.location]
            .filter(Boolean)
            .join(', ')

    onMount(() => {
        const chip = chipRef
        const meta = metaRef
        if (!chip || !meta) return
        let decided = false
        const check = (): void => {
            if (decided) return
            const metaBottom = meta.offsetTop + meta.offsetHeight
            if (metaBottom > chip.clientHeight + 1) {
                decided = true
                setMetaVisible(false)
            }
        }
        const obs = new ResizeObserver(check)
        obs.observe(chip)
        obs.observe(meta)
        const timer = setTimeout(check, 50)
        onCleanup(() => {
            obs.disconnect()
            clearTimeout(timer)
        })
    })

    return (
        <CalendarChip
            ref={el => (chipRef = el)}
            label={label()}
            onOpen={openEdit}
            onMenu={(x, y) => setMenu({ x, y })}
            data-testid="event-chip"
            class={`${styles['event-chip']} ${styles['ev']} ${hasCategory() ? '' : styles['ghost']}${props.compact ? ` ${styles['compact']}` : ''}${props.inGrid ? ` ${styles['in-grid']}` : ''}`}
            style={chipBg() ? { background: chipBg() } : undefined}
        >
            <Show when={props.event.startTime}>
                <Text as="span" inherit class={styles['event-chip-time']}>
                    {formatTime(props.event.startTime!, military())}
                    {/* Compact (short) events show only the start time so the title gets the room. */}
                    {!props.compact && props.event.endTime
                        ? ` — ${formatTime(props.event.endTime, military())}`
                        : ''}
                </Text>
            </Show>
            <Text as="span" inherit class={styles['event-chip-title']}>
                {props.event.title}
            </Text>
            <Show when={props.event.location || props.event.link}>
                <div
                    ref={metaRef}
                    class={styles['event-chip-meta']}
                    style={{
                        visibility: metaVisible() ? 'visible' : 'hidden',
                        height: metaVisible() ? undefined : '0',
                        overflow: 'hidden',
                    }}
                >
                    <Show when={props.event.location}>
                        <Text
                            as="span"
                            inherit
                            class={styles['event-chip-location']}
                        >
                            {props.event.location}
                        </Text>
                    </Show>
                    <Show when={props.event.link}>
                        <IconButton
                            icon="Link"
                            label="Open link"
                            class={styles['event-chip-link']}
                            {...gestureStops}
                            onClick={e => {
                                e.stopPropagation()
                                // Only http(s)/mailto open; any other scheme is inert.
                                if (isOpenableUrl(props.event.link))
                                    window.open(props.event.link, '_blank', 'noopener')
                            }}
                        />
                    </Show>
                </div>
            </Show>
            <Show when={menu()}>
                {m => {
                    // Portal to document.body so the fixed menu escapes the chip's
                    // overflow:hidden and :hover filter (which would otherwise clip it).
                    return (
                        <Portal>
                            <ContextMenu
                                x={m().x}
                                y={m().y}
                                items={[
                                    {
                                        label: 'Edit',
                                        icon: 'Pencil',
                                        onSelect: openEdit,
                                    },
                                    {
                                        label: 'Duplicate',
                                        icon: 'Copy',
                                        onSelect: handleDuplicate,
                                    },
                                    {
                                        label: 'Delete',
                                        icon: 'Trash2',
                                        danger: true,
                                        separatorBefore: true,
                                        onSelect: handleDelete,
                                    },
                                ]}
                                onClose={() => setMenu(null)}
                            />
                        </Portal>
                    )
                }}
            </Show>
        </CalendarChip>
    )
}
