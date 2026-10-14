/** Footer readout, e.g. `2/7 // palette` (index is 0-based, shown 1-based). */
export const footerReadout = (index: number, count: number, label: string): string =>
    `${index + 1}/${count} // ${label}`

/** Primary button text: `next`, or on the last slide the enter action (`opening…` while busy;
 *  `convert and open` when an Obsidian vault was picked to convert). */
export const nextLabel = (
    index: number,
    count: number,
    busy: boolean,
    convert = false,
): string => {
    if (index < count - 1) return 'next'
    if (busy) return 'opening…'
    return convert ? 'convert and open' : 'enter your vault'
}
