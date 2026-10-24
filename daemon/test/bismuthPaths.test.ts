import { afterEach, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { bismuthHome } from '../src/lib/bismuthPaths'

const saved = {
    BISMUTH_HOME: process.env.BISMUTH_HOME,
    NODE_ENV: process.env.NODE_ENV,
}
afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
    }
})

test('bismuthHome joins parts under BISMUTH_HOME (the test preload sets it)', () => {
    process.env.BISMUTH_HOME = '/custom/home'
    expect(bismuthHome('bin')).toBe('/custom/home/bin')
    expect(bismuthHome()).toBe('/custom/home')
})

test('bismuthHome is ~/.bismuth outside a test run', () => {
    delete process.env.BISMUTH_HOME
    process.env.NODE_ENV = 'production'
    expect(bismuthHome('bin')).toBe(join(homedir(), '.bismuth', 'bin'))
    expect(bismuthHome()).toBe(join(homedir(), '.bismuth'))
})

test('bismuthHome refuses the real ~/.bismuth under test', () => {
    delete process.env.BISMUTH_HOME
    process.env.NODE_ENV = 'test'
    expect(() => bismuthHome()).toThrow(/BISMUTH_HOME is unset/)
})
