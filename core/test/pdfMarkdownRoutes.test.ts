// core/test/pdfMarkdownRoutes.test.ts — POST /convert/pdf-markdown/cancel against a real server.
// The job semantics live in pdfMarkdown.test.ts; a real start would run Marker, so only a PDF with
// no job is driven here.
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { createServer } from '../src/server'
import { makeVault } from './helpers'

const TOKEN = 'pdf-markdown-test-token'
const prevToken = process.env.BISMUTH_OWNER_TOKEN

beforeAll(() => {
    process.env.BISMUTH_OWNER_TOKEN = TOKEN
})
afterAll(() => {
    if (prevToken === undefined) delete process.env.BISMUTH_OWNER_TOKEN
    else process.env.BISMUTH_OWNER_TOKEN = prevToken
})

async function cancel(headers: Record<string, string>): Promise<Response> {
    const server = createServer({ vault: makeVault({ 'a.pdf': '%PDF' }), port: 0 })
    try {
        return await fetch(`http://localhost:${server.port}/convert/pdf-markdown/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ path: 'a.pdf' }),
        })
    } finally {
        server.stop(true)
    }
}

test('cancel answers the job state, idle when nothing runs', async () => {
    const r = await cancel({ 'X-Bismuth-Token': TOKEN })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ state: 'idle' })
})

test('cancel without the owner token is 403', async () => {
    expect((await cancel({})).status).toBe(403)
})
