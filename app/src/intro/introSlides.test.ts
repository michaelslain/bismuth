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
    it('carries no layout key: every slide shares one frame geometry', () => {
        for (const s of SLIDES) expect('layout' in s).toBe(false)
    })
    it('carries today heroes and extras', () => {
        const by = Object.fromEntries(SLIDES.map(s => [s.key, s]))
        expect(by.welcome.hero).toBe('wordmark')
        expect(by.daemon.hero).toBe('daemon')
        expect(by.agents.hero).toBe('agents')
        expect(by.begin.hero).toBe('begin')
        expect(by.theme.extra).toBe('themes')
        expect(by.powerups.extra).toBe('powerups')
        expect(by.begin.extra).toBe('cta')
    })
    it('pins every title and body to the wording at bust-base', () => {
        expect(SLIDES.map(s => [s.key, s.title, s.body])).toEqual([
            [
                'welcome',
                'Notes that think.',
                'Write notes and connect them with [[wikilinks]]. Bismuth links them into a graph you can explore and search.',
            ],
            [
                'theme',
                'Pick your palette.',
                'Choose a theme for your vault. You can change it anytime from settings.',
            ],
            [
                'graph',
                'Three brains, one mind.',
                "Your notes and Bismuth's memory connect into one graph, so what you know and what it learns stay woven together.",
            ],
            [
                'daemon',
                'An agent that never sleeps.',
                "A background daemon runs on a schedule: folding new memory into your graph, re-linking notes, and surfacing what you'd forgotten.",
            ],
            [
                'agents',
                'Bring your own agent.',
                'Chat runs on whichever coding agent you already use — Claude Code, Codex, Gemini, opencode, Cline, Goose. Bismuth speaks MCP, so any of them can search the docs and write your bases, queries and notes.',
            ],
            [
                'powerups',
                'Optional power-ups.',
                'Pick what to set up. Bismuth turns them on once you open your vault, or you can do it anytime from the command palette.',
            ],
            [
                'begin',
                'Open your vault.',
                'Pick a folder and Bismuth makes it a vault. Start writing, and the graph fills itself in.',
            ],
        ])
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
