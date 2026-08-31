// app/src/editableTarget.ts
//
// "Did this keystroke come from somewhere the user is typing?" — the guard every key handler that
// listens above its own inputs needs, in one tested place.
//
// WHY THIS EXISTS. A handler bound to a CONTAINER receives keydown from every descendant, including
// text fields inside it. The file tree's `role="tree"` container is the case that produced a real
// bug: its roving-focus handler treats "activeElement is not one of my rows" as "focus is still on
// the container, put it on a row", and the inline rename box is an <input> inside a row — not a row.
// So every keystroke from the rename box that the handler claimed (Space, Enter, Home, End, the
// arrows) called preventDefault and moved focus to a row. The input blurred, and blur COMMITS the
// rename. Typing a space in a filename ended the rename mid-word and looked like the app rejecting
// the character.
//
// Checking `document.activeElement` is NOT a substitute: the whole failure was a handler asking
// where focus is instead of where the event came from. Ask the event.
//
// `isContentEditable` matters as much as the two tag names — CodeMirror and Milkdown both render
// their text surface as a contenteditable <div>, so a tag-only check reads them as "not typing".

/** True when `target` is a text field or a contenteditable surface — i.e. the user is typing into
 *  it and a container-level shortcut must not claim the key. */
export function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el || typeof el.tagName !== 'string') return false
    return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable === true
    )
}
