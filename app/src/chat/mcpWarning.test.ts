import { describe, expect, it } from 'bun:test'
import { addNames, downMcpServers, isMcpConnected, mcpWarningShows } from './mcpWarning'

const servers = [
    { name: 'bismuth', status: 'connected' },
    { name: 'railway', status: 'failed' },
    { name: 'linear', status: 'needs-auth' },
]

describe('mcpWarning', () => {
    it('reads connected statuses', () => {
        expect(isMcpConnected('connected')).toBe(true)
        expect(isMcpConnected('ready')).toBe(true)
        expect(isMcpConnected('failed')).toBe(false)
        expect(isMcpConnected('pending')).toBe(false)
    })

    it('lists servers that are not connected, minus muted ones', () => {
        expect(downMcpServers(servers, []).map(s => s.name)).toEqual(['railway', 'linear'])
        expect(downMcpServers(servers, ['railway']).map(s => s.name)).toEqual(['linear'])
        expect(downMcpServers(servers, ['railway', 'linear'])).toEqual([])
    })

    it('shows while any down server is not hidden', () => {
        const down = downMcpServers(servers, [])
        expect(mcpWarningShows(down, new Set())).toBe(true)
        expect(mcpWarningShows(down, new Set(['railway', 'linear']))).toBe(false)
        expect(mcpWarningShows([], new Set())).toBe(false)
    })

    it('shows again when a server outside the hidden set goes down', () => {
        const hidden = new Set(['railway'])
        expect(mcpWarningShows(downMcpServers(servers.slice(0, 2), []), hidden)).toBe(false)
        expect(mcpWarningShows(downMcpServers(servers, []), hidden)).toBe(true)
    })

    it('a muted server never raises the warning, a new one still does', () => {
        const muted = ['railway', 'linear']
        expect(mcpWarningShows(downMcpServers(servers, muted), new Set())).toBe(false)
        const more = [...servers, { name: 'github', status: 'failed' }]
        expect(downMcpServers(more, muted).map(s => s.name)).toEqual(['github'])
    })

    it('adds names once, keeping order', () => {
        expect(addNames(['a'], ['b', 'a', 'c'])).toEqual(['a', 'b', 'c'])
    })
})
