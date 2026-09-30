import { createSignal, For, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import { CalendarEvent, Category } from '../types'
import { showEventModal, settings, recurrenceAction } from '../state'
import { deleteEventWithUndo, duplicateEvent } from '../eventActions'
import { openableHref } from '../openableUrl'
import CalendarChip from './CalendarChip'
import { useOverflowHide } from './useOverflowHide'
import { pushToast } from '../../toastStore'
import { formatTime } from '../dates'
import { eventCategoryColors, categoryBands, categoryOverflow, MAX_BANDS } from '../categoryColor'
import { EventStore } from '../EventStore'
import { ContextMenu } from '../../ContextMenu'
import { IconButton } from '../../ui/IconButton'
import Text from '../../ui/Text'
import StatusDot from '../../ui/StatusDot'
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
    // The chip is drawn in its categories' colours (a theme token → var(--token), or a custom
    // colour): an even 1px frame and a faint wash of the FIRST category behind
    // --fg ink. A 2+ category event splits its frame into one hard band per category and shows a
    // dot per category, while its wash stays one colour — one event, visibly several categories.
    // Events with no resolvable category render as an outline-only ghost.
    const chipColors = () => eventCategoryColors(props.event, props.categories)
    const hasCategory = () => chipColors().length > 0
    const isMulti = () => chipColors().length > 1
    // The colours travel as custom properties, not an inline `background`, so the stylesheet
    // decides how to paint them (an inline `background` would outrank every rule in the module):
    // `--ev-c` is the first category, `--ev-frame` every category as side-by-side hard bands,
    // `--ev-dots` how many dots the chip reserves room for.
    const chipVars = () => {
        const colors = chipColors()
        if (!colors.length) return undefined
        return {
            '--ev-c': colors[0],
            '--ev-frame': categoryBands(colors, 90)!,
            '--ev-dots': String(Math.min(colors.length, MAX_BANDS)),
        }
    }
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
            try {
                await deleteEventWithUndo(props.store, props.event)
            } catch (e) {
                pushToast(`Could not delete: ${(e as Error).message}`)
            }
        }
    }

    async function handleDuplicate(): Promise<void> {
        await duplicateEvent(props.store, props.event)
    }

    const label = () =>
        [props.event.title, props.event.startTime, props.event.location]
            .filter(Boolean)
            .join(', ')

    useOverflowHide(
        () => chipRef,
        () => metaRef,
        () => setMetaVisible(false),
    )

    return (
        <CalendarChip
            ref={el => (chipRef = el)}
            label={label()}
            onOpen={openEdit}
            onMenu={(x, y) => setMenu({ x, y })}
            data-testid="event-chip"
            class={`${styles['event-chip']} ${styles['ev']} ${hasCategory() ? '' : styles['ghost']}${props.compact ? ` ${styles['compact']}` : ''}${props.inGrid ? ` ${styles['in-grid']}` : ''}`}
            style={chipVars()}
            data-multi={isMulti() ? '' : undefined}
        >
            <Show when={isMulti()}>
                <div class={styles['event-chip-dots']} aria-hidden="true">
                    <For each={chipColors().slice(0, MAX_BANDS)}>
                        {color => <StatusDot color={color} />}
                    </For>
                    <Show when={categoryOverflow(chipColors()) > 0}>
                        <Text as="span" inherit class={styles['event-chip-more']}>
                            +{categoryOverflow(chipColors())}
                        </Text>
                    </Show>
                </div>
            </Show>
            <Show when={props.event.startTime}>
                <Text as="span" inherit class={styles['event-chip-time']}>
                    {formatTime(props.event.startTime!, military())}
                    {/* Compact (short) events show only the start time so the title gets the room. */}
                    {!props.compact && props.event.endTime
                        ? ` — ${formatTime(props.event.endTime, military())}`
                        : ''}
                </Text>
            </Show>
            <Text as="span" inherit register="prose" class={styles['event-chip-title']}>
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
                                // Only http(s)/mailto open (a bare host gets https://); any other scheme is inert.
                                const href = openableHref(props.event.link)
                                if (href) window.open(href, '_blank', 'noopener')
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
