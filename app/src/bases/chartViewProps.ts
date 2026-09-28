import type { ViewResult, BaseConfig } from '../../../core/src/bases/types'

/** The shared props every chart view (Bar/Line/Stat/Heatmap) takes — `onOpen` is BaseView's
 *  file-open handler for a drill-list row, undefined when the view has no write target (an
 *  inline `\`\`\`query` block with no base file), in which case drill rows render as plain text
 *  instead of buttons (see ChartDrill.tsx). */
export type ChartViewProps = {
    result: ViewResult
    config: BaseConfig
    onOpen?: (path: string) => void
}
