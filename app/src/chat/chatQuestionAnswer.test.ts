import { describe, expect, it } from 'bun:test'
import { chosenLabels } from './chatQuestionAnswer'

const L = ['Yes, do it', 'Yes', 'No']

describe('chosenLabels', () => {
    it('finds a single pick', () => {
        expect([...chosenLabels('No', L)]).toEqual(['No'])
    })
    it('finds a label that itself contains a comma, and not its prefix label', () => {
        expect([...chosenLabels('Yes, do it', L)]).toEqual(['Yes, do it'])
    })
    it('finds a multi-select join in any order', () => {
        expect([...chosenLabels('No, Yes', L)].sort()).toEqual(['No', 'Yes'])
        expect([...chosenLabels('Yes, do it, No', L)].sort()).toEqual(['No', 'Yes, do it'])
    })
    it('treats unknown text as free "Other" input that picks nothing', () => {
        expect([...chosenLabels('something else, No', L)]).toEqual(['No'])
        expect([...chosenLabels('No, my own answer', L)]).toEqual(['No'])
        expect(chosenLabels('totally custom', L).size).toBe(0)
    })
    it('is empty for an empty answer', () => {
        expect(chosenLabels('', L).size).toBe(0)
    })
})
