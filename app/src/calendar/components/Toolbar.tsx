import {
    currentView,
    currentDate,
    showCategoryPanel,
    showEventModal,
    settings,
} from '../state'
import { Icon } from '../../icons/Icon'
import ViewBar, { Crumb, ViewBarSpacer, VBtn } from '../../ui/ViewBar'
import { Show } from 'solid-js'
import { SegmentedToggle } from '../../ui/SegmentedToggle'
import { ViewType } from '../types'
import { toDateStr, addDays, weekRange } from '../dates'
import styles from '../Calendar.module.css'

const VIEWS: { id: ViewType; label: string }[] = [
    { id: 'month', label: 'Month' },
    { id: 'week', label: 'Week' },
    { id: '3day', label: '3 Day' },
    { id: 'day', label: 'Day' },
]

function navigate(dir: -1 | 1): void {
    const d = new Date(currentDate.value)
    const v = currentView.value
    switch (v) {
        case 'month':
            d.setMonth(d.getMonth() + dir)
            break
        case 'week':
            d.setDate(d.getDate() + dir * 7)
            break
        case '3day':
            d.setDate(d.getDate() + dir * 3)
            break
        case 'day':
            d.setDate(d.getDate() + dir)
    }
    currentDate.value = new Date(d)
}

function headerLabel(): string {
    const d = currentDate.value
    const v = currentView.value
    const mondayFirst = settings.value.weekStartsOnMonday

    if (v === 'month')
        return d.toLocaleString('default', { month: 'long', year: 'numeric' })

    if (v === 'week') {
        const [ws, we] = weekRange(d, mondayFirst)
        return `${ws} — ${we}`
    }

    if (v === '3day') return `${toDateStr(d)} — ${toDateStr(addDays(d, 2))}`

    return toDateStr(d)
}

export type ToolbarProps = {
    /**
     * Render the CONTROLS ONLY, with no <ViewBar> wrapper of its own.
     *
     * A calendar base used to stack TWO bars: BaseView's (crumb + view tabs + gear + source) and
     * this one directly underneath, because CalendarView rendered <Toolbar /> as a sibling of the
     * bar rather than into it. Two full-height bands of chrome above every calendar, for one view.
     * BaseView now renders `<Toolbar inline />` INSIDE its own ViewBar, so there is one bar with
     * the calendar's controls in it — which is also why this component keeps owning its controls
     * rather than BaseView reimplementing them per view kind.
     */
    inline?: boolean
}

export function Toolbar(props: ToolbarProps = {}) {
    const controls = () => (
        <>
            <VBtn active onClick={() => (currentDate.value = new Date())}>
                Today
            </VBtn>
            <div class={styles['cal-nav']}>
                <VBtn
                    icon="ChevronLeft"
                    iconSize={16}
                    title="Previous"
                    onClick={() => navigate(-1)}
                />
                <VBtn
                    icon="ChevronRight"
                    iconSize={16}
                    title="Next"
                    onClick={() => navigate(1)}
                />
            </div>
            <Crumb>{headerLabel()}</Crumb>
            {/* Standalone only. Inline, BaseView's own spacer is the one that pushes the gear and
                source buttons right — a second flex:1 here would split the free space between the
                two and strand the calendar's controls mid-bar. */}
            <Show when={!props.inline}>
                <ViewBarSpacer />
            </Show>
            <SegmentedToggle
                value={currentView.value}
                onChange={id => (currentView.value = id)}
                size="sm"
                options={VIEWS}
            />
            <VBtn
                icon="Tag"
                iconSize={13}
                active={showCategoryPanel.value}
                onClick={() =>
                    (showCategoryPanel.value = !showCategoryPanel.value)
                }
            >
                Categories
            </VBtn>
            <button
                class={`vbtn ${styles['cal-cta']}`}
                onClick={() =>
                    (showEventModal.value = {
                        date: toDateStr(currentDate.value),
                    })
                }
            >
                <Icon value="Plus" size={14} />
                Event
            </button>
        </>
    )
    // Standalone (a full-page calendar with no base chrome above it) still gets its own bar.
    return props.inline ? (
        controls()
    ) : (
        <ViewBar class={styles['cal-viewbar']}>{controls()}</ViewBar>
    )
}
