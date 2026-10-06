// Whether a keydown should close an opened daemon-page section. A dismiss that something
// inside the section already handled (a context menu closing itself calls preventDefault)
// must not also close the section underneath it.
export function shouldCloseOnKey(
    e: Pick<KeyboardEvent, 'defaultPrevented'>,
    isDismiss: boolean,
): boolean {
    return isDismiss && !e.defaultPrevented
}
