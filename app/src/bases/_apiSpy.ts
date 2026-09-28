// Story helper: replaces named `api` verbs with recorders, so an interaction story can assert the
// WRITE its component made (the fake transport answers only some routes, and none of them keep a
// log). `beforeEach: () => { spy = spyApi([...]); return spy.restore }` installs it before the story
// renders and puts the real verbs back afterwards, so nothing leaks into the next story.
import { api } from './../api'

export type ApiCall = { name: string; args: unknown[] }
type Verb = (...args: unknown[]) => unknown

export function spyApi(
    names: (keyof typeof api)[],
    impl: Partial<Record<keyof typeof api, Verb>> = {},
) {
    const target = api as unknown as Record<string, Verb>
    const calls: ApiCall[] = []
    const originals = names.map(n => [n as string, target[n as string]] as const)
    for (const n of names)
        target[n as string] = async (...args: unknown[]) => {
            calls.push({ name: n as string, args })
            return impl[n]?.(...args)
        }
    return {
        calls,
        named: (name: string) => calls.filter(c => c.name === name),
        restore: () => {
            for (const [n, fn] of originals) target[n] = fn
        },
    }
}
