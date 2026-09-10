// app/src/editor/rebuildSeed.test.ts
//
// The rule Editor.tsx's view rebuild seeds its new document from. Every case below is a state
// the running app actually reaches; the first one is the data loss this module was written for.

import { describe, expect, test } from 'bun:test'
import { rebuildSeed } from './rebuildSeed'

// The note as FileView fetched it when it was opened — the value `props.initialText` holds for
// as long as the note stays open, however far the buffer moves on.
const OPENED = ['alpha', '', '```draw block', 'PAYLOAD', '```', '', 'beta'].join('\n')
// The same note after the user dragged the drawing below the last paragraph. On disk within a
// second of the drop; in `props.initialText`, never.
const MOVED = ['alpha', '', 'beta', '', '```draw block', 'PAYLOAD', '```'].join('\n')

describe('rebuildSeed', () => {
    // THE regression. Reproduced in the running app as: open a note, drag a standalone drawing
    // to a new slot, enter draw mode. Draw mode re-ran the view effect, the rebuild seeded from
    // `props.initialText`, and the reorder was reverted in the buffer and then written to disk
    // by the first ink commit.
    test('a same-buffer rebuild comes back with the live document, not the open-time snapshot', () => {
        expect(rebuildSeed(MOVED, OPENED, OPENED)).toEqual({
            from: 'carried',
            text: MOVED,
        })
    })

    // The source is asserted, not only the text: with `carried` and `initialText` equal, a seed
    // taken from the wrong one is invisible in the string.
    test('the carried document is the source even when it happens to equal the snapshot', () => {
        expect(rebuildSeed(OPENED, OPENED, OPENED).from).toBe('carried')
    })

    // `carried !== null`, never `if (carried)`. Select-all, delete, then change a setting.
    test('an EMPTY carried document is still the document', () => {
        expect(rebuildSeed('', OPENED, OPENED)).toEqual({
            from: 'carried',
            text: '',
        })
    })

    // A buffer Editor.tsx fetched itself (no `initialText` prop at all) still owns its own text
    // across a rebuild — `undefined === undefined` is "the prop did not change".
    test('a buffer with no initialText prop still carries its own document across a rebuild', () => {
        expect(rebuildSeed(MOVED, undefined, undefined)).toEqual({
            from: 'carried',
            text: MOVED,
        })
    })

    // The one case the buffer cannot know better: a caller handing down different content for
    // the same path (InboxPageView swapping a page body).
    test('an initialText that CHANGED since the last build wins over the carried document', () => {
        expect(rebuildSeed(MOVED, 'a different body', OPENED)).toEqual({
            from: 'initial',
            text: 'a different body',
        })
    })

    // A note switch: the previous view's text belongs to the previous buffer, so the caller
    // passes null and the prop is all there is.
    test('with nothing carried, the caller-supplied text seeds the view', () => {
        expect(rebuildSeed(null, OPENED, undefined)).toEqual({
            from: 'initial',
            text: OPENED,
        })
    })

    // Editor used without FileView (the rename flows, a bare mount): nothing to seed from, so
    // the caller has to read the file.
    test('nothing carried and no initialText falls back to a fetch', () => {
        expect(rebuildSeed(null, undefined, undefined)).toEqual({
            from: 'fetch',
        })
    })

    // An empty-string prop is a real note ("" is a brand-new file), not a missing one.
    test('an empty initialText is a seed, not a missing one', () => {
        expect(rebuildSeed(null, '', undefined)).toEqual({
            from: 'initial',
            text: '',
        })
    })
})
