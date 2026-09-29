// The SparklineChart's caption line, pulled out so it is unit-testable. No framework imports.
import type { Bin } from '../../../core/src/dates'
import { sparklineCaption } from './sparkline'

/** `last 12 weeks // Jul 6 – Sep 21`: the window, then its first and last bin label. A single
 *  bucket has no range to show, and its bin word stays singular (`last 1 week`). */
export function sparklineWindowCaption(bin: Bin, labels: string[]): string {
    const window = labels.length === 1 ? `last 1 ${bin}` : sparklineCaption(bin, labels.length)
    if (labels.length < 2) return window
    return `${window} // ${labels[0]} – ${labels[labels.length - 1]}`
}
