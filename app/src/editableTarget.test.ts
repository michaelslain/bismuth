import { test, expect } from 'bun:test'
import { isTypingTarget } from './editableTarget'

// A DOM element is duck-typed here rather than mounted: the predicate reads three properties and
// nothing else, so a literal is a faithful stand-in and the test stays headless.
const el = (tagName: string, isContentEditable = false) =>
    ({ tagName, isContentEditable }) as unknown as EventTarget

test('a text input is a typing target', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true)
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true)
})

test('a contenteditable div is a typing target — CodeMirror and Milkdown are both DIVs', () => {
    // The tag-only version of this check read the note editor as "not typing", which is exactly
    // the class of bug this module exists to stop.
    expect(isTypingTarget(el('DIV', true))).toBe(true)
})

test('an ordinary element is not', () => {
    expect(isTypingTarget(el('DIV'))).toBe(false)
    expect(isTypingTarget(el('BUTTON'))).toBe(false)
    // A file-tree row: the element the tree's roving-focus handler legitimately acts on.
    expect(isTypingTarget(el('DIV', false))).toBe(false)
})

test('null and non-element targets are not typing targets', () => {
    expect(isTypingTarget(null)).toBe(false)
    // window/document are real EventTargets with no tagName — they must not throw.
    expect(isTypingTarget({} as EventTarget)).toBe(false)
})
