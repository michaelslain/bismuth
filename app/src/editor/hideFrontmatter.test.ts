import { expect, test } from 'bun:test'
import { EditorState } from '@codemirror/state'
import { deleteCharBackward, insertNewlineAndIndent, moveLineUp, transposeChars, undo, redo, history } from '@codemirror/commands'
import { hiddenFrontmatterRange, hideFrontmatter } from './hideFrontmatter'

test('covers the whole block including the closing fence line', () => {
    const doc = '---\ntype: daemon-page\ntitle: x\n---\nbody\n'
    expect(hiddenFrontmatterRange(doc)).toEqual({ from: 0, to: doc.indexOf('body') })
})
test('no frontmatter hides nothing', () => {
    expect(hiddenFrontmatterRange('# heading\nbody\n')).toBeNull()
})
test('an unclosed block hides nothing', () => {
    expect(hiddenFrontmatterRange('---\ntype: x\nbody\n')).toBeNull()
})
test('CRLF line endings', () => {
    const doc = '---\r\ntype: x\r\n---\r\nbody'
    expect(hiddenFrontmatterRange(doc)).toEqual({ from: 0, to: doc.indexOf('body') })
})
test('frontmatter as the whole file', () => {
    const doc = '---\ntype: x\n---\n'
    expect(hiddenFrontmatterRange(doc)).toEqual({ from: 0, to: doc.length })
})

const DOC = '---\ntype: daemon-page\nstatus: x\n---\nbody\n'
const mk = (sel: number) => EditorState.create({ doc: DOC, selection: { anchor: sel }, extensions: [hideFrontmatter()] })
const BODY = DOC.indexOf('body')

test('backspace at the first visible char leaves the doc untouched', () => {
    let state = mk(BODY)
    deleteCharBackward({ state, dispatch: tr => (state = tr.state) })
    expect(state.doc.toString()).toBe(DOC)
})
test('user insert at 0 is dropped', () => {
    const next = mk(0).update({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' }).state
    expect(next.doc.toString()).toBe(DOC)
})
test('user delete reaching into the hidden range is dropped', () => {
    const next = mk(BODY + 2).update({ changes: { from: 5, to: BODY + 2 }, userEvent: 'delete.selection' }).state
    expect(next.doc.toString()).toBe(DOC)
})
test('typing at the start of the body still works', () => {
    const next = mk(BODY).update({ changes: { from: BODY, insert: 'x' }, userEvent: 'input.type' }).state
    expect(next.doc.toString()).toBe(DOC.slice(0, BODY) + 'x' + DOC.slice(BODY))
})
test('programmatic whole-doc replace is allowed', () => {
    const next = mk(0).update({ changes: { from: 0, to: DOC.length, insert: 'new' } }).state
    expect(next.doc.toString()).toBe('new')
})
test('moveLineUp at the body start leaves the doc untouched', () => {
    let state = mk(BODY)
    moveLineUp({ state, dispatch: tr => (state = tr.state) })
    expect(state.doc.toString()).toBe(DOC)
})
test('transposeChars at the body start leaves the doc untouched', () => {
    let state = mk(BODY)
    transposeChars({ state, dispatch: tr => (state = tr.state) })
    expect(state.doc.toString()).toBe(DOC)
})
test('Enter at the body start still works', () => {
    let state = mk(BODY)
    insertNewlineAndIndent({ state, dispatch: tr => (state = tr.state) })
    expect(state.doc.toString()).toBe(DOC.slice(0, BODY) + '\n' + DOC.slice(BODY))
})
test('paste at the body start still works', () => {
    const next = mk(BODY).update({ changes: { from: BODY, insert: 'pasted' }, userEvent: 'input.paste' }).state
    expect(next.doc.toString()).toBe(DOC.slice(0, BODY) + 'pasted' + DOC.slice(BODY))
})
test('undo and redo of body typing still work', () => {
    let state = EditorState.create({ doc: DOC, selection: { anchor: BODY }, extensions: [hideFrontmatter(), history()] })
    state = state.update({ changes: { from: BODY, insert: 'x' }, userEvent: 'input.type' }).state
    undo({ state, dispatch: tr => (state = tr.state) })
    expect(state.doc.toString()).toBe(DOC)
    redo({ state, dispatch: tr => (state = tr.state) })
    expect(state.doc.toString()).toBe(DOC.slice(0, BODY) + 'x' + DOC.slice(BODY))
})
