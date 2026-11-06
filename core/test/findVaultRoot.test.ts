import { tempDir } from './helpers'
import { test, expect } from 'bun:test'
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { findVaultRoot } from '../src/findVaultRoot'

test('findVaultRoot walks up from a nested folder to the directory holding .settings', () => {
    const vault = realpathSync(tempDir('bismuth-find-vault-'))
    writeFileSync(join(vault, '.settings'), '')
    const deep = join(vault, 'school', 'classes')
    mkdirSync(deep, { recursive: true })
    expect(findVaultRoot(deep)).toBe(vault)
    expect(findVaultRoot(vault)).toBe(vault)
})

test('findVaultRoot is null outside any vault', () => {
    const dir = realpathSync(tempDir('bismuth-find-none-'))
    expect(findVaultRoot(dir)).toBeNull()
})

test('a legacy settings.yaml alone does not make a folder a vault', () => {
    const dir = realpathSync(tempDir('bismuth-find-yaml-'))
    writeFileSync(join(dir, 'settings.yaml'), 'x: 1\n')
    expect(findVaultRoot(dir)).toBeNull()
})
