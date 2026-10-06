/** Footer readout, e.g. `2/7 // palette` (index is 0-based, shown 1-based). */
export const footerReadout = (index: number, count: number, label: string): string =>
    `${index + 1}/${count} // ${label}`

/** Primary button text: `next`, or on the last slide the enter action (`opening…` while busy). */
export const nextLabel = (index: number, count: number, busy: boolean): string => {
    if (index < count - 1) return 'next'
    return busy ? 'opening…' : 'enter your vault'
}
