import { currentView, currentDate, showCategoryPanel, showEventModal, settings } from '../state'
import { Icon } from '../../icons/Icon'
import { ViewBar, Crumb, ViewBarSpacer, VBtn } from '../../ui/ViewBar'
import { SegmentedToggle } from '../../ui/SegmentedToggle'
import { ViewType } from '../types'
import { toDateStr, addDays, weekRange } from '../dates'

const VIEWS: { id: ViewType; label: string }[] = [
  { id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }, { id: '3day', label: '3 Day' }, { id: 'day', label: 'Day' },
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

  if (v === 'month') return d.toLocaleString('default', { month: 'long', year: 'numeric' })

  if (v === 'week') {
    const [ws, we] = weekRange(d, mondayFirst)
    return `${ws} – ${we}`
  }

  if (v === '3day') return `${toDateStr(d)} – ${toDateStr(addDays(d, 2))}`

  return toDateStr(d)
}

export function Toolbar() {
  return (
    <ViewBar class="cal-viewbar">
      <VBtn active onClick={() => (currentDate.value = new Date())}>Today</VBtn>
      <div class="cal-nav">
        <VBtn icon="ChevronLeft" iconSize={16} title="Previous" onClick={() => navigate(-1)} />
        <VBtn icon="ChevronRight" iconSize={16} title="Next" onClick={() => navigate(1)} />
      </div>
      <Crumb serif>{headerLabel()}</Crumb>
      <ViewBarSpacer />
      <SegmentedToggle
        value={currentView.value}
        onChange={(id) => (currentView.value = id)}
        size="sm"
        options={VIEWS}
      />
      <VBtn icon="Tag" iconSize={13} active={showCategoryPanel.value} onClick={() => (showCategoryPanel.value = !showCategoryPanel.value)}>Categories</VBtn>
      <button class="vbtn cal-cta" onClick={() => (showEventModal.value = { date: toDateStr(currentDate.value) })}>
        <Icon value="Plus" size={14} />Event
      </button>
    </ViewBar>
  )
}
