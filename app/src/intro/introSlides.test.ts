import { describe, expect, it } from 'bun:test'
import {
    DEFAULT_POWERUPS,
    POWER_UPS,
    SLIDES,
    powerUpCommands,
    togglePowerUp,
} from './introSlides'

describe('SLIDES', () => {
    it('has the seven slides in order', () => {
        expect(SLIDES.map(s => s.key)).toEqual([
            'welcome',
            'theme',
            'graph',
            'daemon',
            'agents',
            'powerups',
            'begin',
        ])
    })
    it('only theme and graph carry a graph', () => {
        expect(SLIDES.filter(s => s.graph).map(s => s.key)).toEqual([
            'theme',
            'graph',
        ])
        expect(SLIDES.find(s => s.key === 'theme')?.graph).toBe('small')
        expect(SLIDES.find(s => s.key === 'graph')?.graph).toBe('big')
    })
    it('only welcome and begin drop the corner mark', () => {
        expect(SLIDES.filter(s => !s.corner).map(s => s.key)).toEqual([
            'welcome',
            'begin',
        ])
    })
    it('only the graph slide sits low', () => {
        expect(SLIDES.filter(s => s.layout === 'low').map(s => s.key)).toEqual([
            'graph',
        ])
    })
    it('carries today heroes and extras', () => {
        const by = Object.fromEntries(SLIDES.map(s => [s.key, s]))
        expect(by.welcome.hero).toBe('wordmark')
        expect(by.daemon.hero).toBe('daemon')
        expect(by.agents.hero).toBe('agents')
        expect(by.begin.hero).toBe('wordmark')
        expect(by.theme.extra).toBe('themes')
        expect(by.powerups.extra).toBe('powerups')
        expect(by.begin.extra).toBe('cta')
    })
    it('keeps the authored copy', () => {
        expect(SLIDES[0].title).toBe('Notes that think.')
        expect(SLIDES[6].title).toBe('Open your vault.')
        expect(SLIDES.every(s => s.title && s.body)).toBe(true)
    })
})

describe('power-ups', () => {
    it('defaults to both on', () => {
        expect(DEFAULT_POWERUPS).toEqual(['daemon', 'cli'])
        expect(POWER_UPS.map(p => p.id)).toEqual(DEFAULT_POWERUPS)
    })
    it('maps ids to commands in POWER_UPS order and drops unknowns', () => {
        expect(powerUpCommands(['cli', 'daemon', 'x'])).toEqual([
            'daemon-setup',
            'bismuth-install',
        ])
        expect(powerUpCommands([])).toEqual([])
    })
    it('toggles an id on and off', () => {
        expect(togglePowerUp(['daemon'], 'cli')).toEqual(['daemon', 'cli'])
        expect(togglePowerUp(['daemon', 'cli'], 'daemon')).toEqual(['cli'])
    })
})
