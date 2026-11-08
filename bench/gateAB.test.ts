import { describe, expect, test } from 'bun:test'
import { pickShipped, TRAINED_WITHOUT_VALIDATION } from './gateAB'

describe('which variant gateAB ships', () => {
    const all = ['prev', 'labels', 'split', 'rate'].map(variant => ({ variant }))
    test('only variants fit without the validation sessions compete', () => {
        // prev and labels train on train + validation, so their validation objective is in-sample and the highest here
        const valObjective = (v: string) => ({ prev: 90, labels: 80, split: 40, rate: 50 })[v]!
        const winner = pickShipped(all.filter(r => TRAINED_WITHOUT_VALIDATION.includes(r.variant)), valObjective)
        expect(winner.variant).toBe('rate')
        expect(pickShipped(all.filter(r => TRAINED_WITHOUT_VALIDATION.includes(r.variant)), v => (v === 'split' ? 9 : 1)).variant).toBe('split')
    })
    test('a tie keeps the first and an empty field is an error', () => {
        expect(pickShipped(all, () => 1).variant).toBe('prev')
        expect(() => pickShipped([], () => 1)).toThrow()
    })
})
