import { describe, expect, test } from 'bun:test'
import { togglesOnSecondRow, type ToggleRowMeasure } from './modeToggleRow'

const base: ToggleRowMeasure = {
    wrapped: false,
    groupScrollW: 209,
    groupClientW: 209,
    leadW: 120,
    leadMinW: 80,
    joinGap: 12,
}

describe('togglesOnSecondRow', () => {
    test('in row 1 and fully shown: stays', () => {
        expect(togglesOnSecondRow(base)).toBe(false)
    })

    test('in row 1 and clipped: moves to row 2', () => {
        expect(togglesOnSecondRow({ ...base, groupClientW: 150 })).toBe(true)
    })

    test('sub-pixel shrink in row 1 is not a clip', () => {
        expect(togglesOnSecondRow({ ...base, groupClientW: 208.8 })).toBe(false)
    })

    test('on row 2 with room beside the filename for the group and its gap: moves back', () => {
        expect(
            togglesOnSecondRow({ ...base, wrapped: true, leadW: 80 + 209 + 12 }),
        ).toBe(false)
    })

    test('on row 2 without that room: stays', () => {
        expect(
            togglesOnSecondRow({ ...base, wrapped: true, leadW: 80 + 209 + 11 }),
        ).toBe(true)
    })

    test('the gap counts — room for the toggles alone is not enough', () => {
        expect(
            togglesOnSecondRow({ ...base, wrapped: true, leadW: 80 + 209 }),
        ).toBe(true)
    })

    test('no flip-flop: moving back at the exact threshold leaves row 1 unclipped', () => {
        // On row 2 the lead is 80 + 209 + 12 wide → move back. The group then takes 209 + 12 of
        // the lead's width, leaving it exactly at its minimum, so the group is not clipped.
        const back = togglesOnSecondRow({
            ...base,
            wrapped: true,
            leadW: 80 + 209 + 12,
        })
        expect(back).toBe(false)
        expect(
            togglesOnSecondRow({ ...base, wrapped: false, leadW: 80, groupClientW: 209 }),
        ).toBe(false)
    })

    test('no flip-flop: moving down never frees quite enough to move straight back up', () => {
        // Clipped by 30px in row 1 with the lead at its minimum → row 2. The lead then gains the
        // group's box (179) and its gap (12): 80 + 191, short of the 209 + 12 needed.
        expect(togglesOnSecondRow({ ...base, leadW: 80, groupClientW: 179 })).toBe(true)
        expect(
            togglesOnSecondRow({ ...base, wrapped: true, leadW: 80 + 179 + 12 }),
        ).toBe(true)
    })
})
