import { Match, Switch, type Component, type ComponentProps } from 'solid-js'
import type { BaseConfig, Row, ViewResult } from '../../../core/src/bases/types'
import { TableView } from './TableView'
import { CardsView } from './CardsView'
import { ListView } from './ListView'
import { BulletsView } from './BulletsView'
import { KanbanView } from './KanbanView'
import { MapView } from './MapView'
import { HeatmapView } from './HeatmapView'
import type { HeatmapWriteSeam } from './heatmapWrites'
import { BarView } from './BarView'
import { LineView } from './LineView'
import { StatView } from './StatView'

export type ViewRendererProps = {
    result: ViewResult
    config: BaseConfig
    basePath?: string
    mode: 'normal' | 'tasks'
    /** True when the base owns its rows (no `source:`). */
    ownsRows: boolean
    /** The active view's index, clamped to the document's view count. */
    viewIndex: number
    /** The combined refetch — fires for writes that land on the base file AND on other notes,
     *  and the callback does not say which. */
    onChange: () => void
    onToggle: (row: Row, e: Event) => void
    onSetStatus: (row: Row, e: MouseEvent) => void
    onOpen?: (path: string) => void
    heatmapWrites?: HeatmapWriteSeam
    /** Table only: persist a column reorder / width change (absent when there is no file). */
    onReorder?: ComponentProps<typeof TableView>['onReorder']
    onWidthsChange?: ComponentProps<typeof TableView>['onWidthsChange']
}

/** Picks the renderer for a resolved row-based view. The full-pane kinds (calendar,
 *  flashcards) skip the resolved-rows pipeline and are mounted by BaseView itself. */
const ViewRenderer: Component<ViewRendererProps> = props => (
    <Switch
        fallback={
            <TableView
                result={props.result}
                mode={props.mode}
                onToggle={props.onToggle}
                onSetStatus={props.onSetStatus}
                basePath={props.basePath}
                onChange={props.onChange}
                config={props.config}
                onReorder={props.onReorder}
                widths={props.result.view.columnWidths}
                onWidthsChange={props.onWidthsChange}
            />
        }
    >
        <Match when={props.result.view.type === 'kanban'}>
            <KanbanView
                result={props.result}
                config={props.config}
                basePath={props.basePath}
                viewIndex={props.viewIndex}
                onChange={props.onChange}
                mode={props.mode}
                ownsRows={props.ownsRows}
                onToggle={props.onToggle}
                onSetStatus={props.onSetStatus}
            />
        </Match>
        <Match when={props.result.view.type === 'cards'}>
            <CardsView
                result={props.result}
                basePath={props.basePath}
                onChange={props.onChange}
                config={props.config}
                mode={props.mode}
                onToggle={props.onToggle}
                onSetStatus={props.onSetStatus}
            />
        </Match>
        <Match when={props.result.view.type === 'list'}>
            <ListView
                result={props.result}
                basePath={props.basePath}
                onChange={props.onChange}
                config={props.config}
                mode={props.mode}
                onToggle={props.onToggle}
                onSetStatus={props.onSetStatus}
            />
        </Match>
        <Match when={props.result.view.type === 'bullets'}>
            <BulletsView
                result={props.result}
                basePath={props.basePath}
                onChange={props.onChange}
                config={props.config}
                mode={props.mode}
                onToggle={props.onToggle}
                onSetStatus={props.onSetStatus}
            />
        </Match>
        <Match when={props.result.view.type === 'map'}>
            <MapView
                result={props.result}
                config={props.config}
                basePath={props.basePath}
                ownsRows={props.ownsRows}
                onChange={props.onChange}
            />
        </Match>
        <Match when={props.result.view.type === 'heatmap'}>
            <HeatmapView
                result={props.result}
                config={props.config}
                onOpen={props.onOpen}
                writes={props.heatmapWrites}
            />
        </Match>
        <Match when={props.result.view.type === 'bar'}>
            <BarView result={props.result} config={props.config} onOpen={props.onOpen} />
        </Match>
        <Match when={props.result.view.type === 'line'}>
            <LineView result={props.result} config={props.config} onOpen={props.onOpen} />
        </Match>
        <Match when={props.result.view.type === 'stat'}>
            <StatView result={props.result} config={props.config} onOpen={props.onOpen} />
        </Match>
    </Switch>
)

export default ViewRenderer
