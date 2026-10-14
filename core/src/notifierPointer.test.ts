import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../test/tempDirs'
import { recordNotifierPath } from './notifierPointer'

function fakeApp(withHelper: boolean): string {
    const app = join(tempDir('notifier-'), 'Bismuth.app')
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
    if (withHelper) writeFileSync(join(app, 'Contents', 'MacOS', 'bismuth-notify'), '')
    return app
}

describe('recordNotifierPath', () => {
    test('writes the helper path inside the running bundle', () => {
        const app = fakeApp(true)
        const pointer = join(tempDir('home-'), '.bismuth', 'notifier')
        const helper = join(app, 'Contents', 'MacOS', 'bismuth-notify')
        expect(recordNotifierPath(app, pointer)).toBe(helper)
        expect(readFileSync(pointer, 'utf8').trim()).toBe(helper)
    })

    test('writes nothing outside the bundled app or without the helper', () => {
        const pointer = join(tempDir('home-'), 'notifier')
        expect(recordNotifierPath(undefined, pointer)).toBeNull()
        expect(recordNotifierPath(fakeApp(false), pointer)).toBeNull()
        expect(existsSync(pointer)).toBe(false)
    })
})
