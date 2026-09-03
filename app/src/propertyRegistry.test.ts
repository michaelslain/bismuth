// app/src/propertyRegistry.test.ts
import { test, expect } from 'bun:test'
import { propertyRegistry, registryShouldRefresh } from './propertyRegistry'

test('propertyRegistry accessor exists and returns an object before hydration', () => {
    // Before any fetch resolves, the accessor returns the empty seed Schema ({}),
    // never undefined — so callers (autocomplete/lint) can deref safely on first paint.
    expect(typeof propertyRegistry).toBe('function')
    expect(propertyRegistry()).toEqual({})
})

test('a live edit to the real vault settings file triggers a refresh', () => {
    expect(registryShouldRefresh(['.settings'])).toBe(true)
})

test('the legacy and interim settings paths still trigger a refresh', () => {
    expect(registryShouldRefresh(['settings.yaml'])).toBe(true)
    expect(registryShouldRefresh(['.settings/settings.yaml'])).toBe(true)
})

test('unknown paths means "extent unknown" and refreshes to be safe', () => {
    expect(registryShouldRefresh([])).toBe(true)
})

test('an ordinary note edit does not refresh the registry', () => {
    expect(registryShouldRefresh(['essay.md'])).toBe(false)
})
