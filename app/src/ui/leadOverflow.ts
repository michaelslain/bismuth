// app/src/ui/leadOverflow.ts — whether a horizontally scrolling box has more content past its
// right edge. ViewBar's below-the-floor lead group fades its right edge only when this is true, so a
// lead that fits (the sidebar mini graph's) is never masked, and one scrolled to its end loses the
// fade that said "more this way". The 1px slack absorbs sub-pixel layout widths, which otherwise
// leave a fitting row reading as overflowing by a fraction of a pixel.
const leadOverflow = (box: {
    scrollWidth: number
    clientWidth: number
    scrollLeft: number
}): boolean => box.scrollWidth - box.clientWidth - box.scrollLeft > 1

export default leadOverflow
