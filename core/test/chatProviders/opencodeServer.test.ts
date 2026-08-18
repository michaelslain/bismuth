// Tests for the one PURE function in core/src/chatProviders/opencodeServer.ts —
// opencodeServerEventSessionId, which routes each event off the shared server's global event stream
// to the right chat session. Everything else in that module is effectful (spawns `opencode serve`,
// opens a real HTTP+SSE connection) and untested directly here, matching the codebase's existing
// convention for this kind of driver (chatProviders/acp/driver.ts has no direct tests either — only
// its pure protocol.ts does; chatProviders/opencode.ts itself is likewise untested beyond its pure
// opencodeTranslate.ts). Fixtures below mirror shapes captured live against opencode 1.18.4.
import { describe, expect, test } from 'bun:test'
import { opencodeServerEventSessionId } from '../../src/chatProviders/opencodeServer'

const SID = 'ses_05009a939ffetx8dxiZyL3yO6d'

describe('opencodeServerEventSessionId', () => {
    test('message.part.delta carries sessionID directly on properties', () => {
        expect(
            opencodeServerEventSessionId({
                type: 'message.part.delta',
                properties: {
                    sessionID: SID,
                    messageID: 'm',
                    partID: 'p',
                    field: 'text',
                    delta: 'x',
                },
            }),
        ).toBe(SID)
    })

    test("message.part.updated falls back to the nested part's sessionID", () => {
        expect(
            opencodeServerEventSessionId({
                type: 'message.part.updated',
                properties: {
                    part: {
                        id: 'prt_1',
                        sessionID: SID,
                        messageID: 'm',
                        type: 'text',
                        text: '',
                    },
                },
            }),
        ).toBe(SID)
    })

    test("message.updated falls back to the nested info's sessionID", () => {
        expect(
            opencodeServerEventSessionId({
                type: 'message.updated',
                properties: {
                    info: { id: 'msg_1', sessionID: SID, role: 'assistant' },
                },
            }),
        ).toBe(SID)
    })

    test("session.created/.updated/.deleted use info.id (the SESSION's own id, not a sessionID field)", () => {
        expect(
            opencodeServerEventSessionId({
                type: 'session.created',
                properties: { info: { id: SID, title: 'x' } },
            }),
        ).toBe(SID)
        expect(
            opencodeServerEventSessionId({
                type: 'session.updated',
                properties: { info: { id: SID, title: 'x' } },
            }),
        ).toBe(SID)
        expect(
            opencodeServerEventSessionId({
                type: 'session.deleted',
                properties: { info: { id: SID, title: 'x' } },
            }),
        ).toBe(SID)
    })

    test("a session.* event's bare info.id is NOT used for other event kinds (that'd be a coincidence, not a session id)", () => {
        expect(
            opencodeServerEventSessionId({
                type: 'some.other.event',
                properties: { info: { id: SID } },
            }),
        ).toBeNull()
    })

    test('permission.asked (the LIVE shape, not the SDK-declared permission.updated) carries sessionID directly', () => {
        expect(
            opencodeServerEventSessionId({
                type: 'permission.asked',
                properties: {
                    id: 'per_1',
                    sessionID: SID,
                    permission: 'bash',
                    patterns: ['echo hi'],
                    metadata: {},
                    tool: { messageID: 'm', callID: 'c' },
                },
            }),
        ).toBe(SID)
    })

    test('no sessionID anywhere, or malformed input, yields null', () => {
        expect(
            opencodeServerEventSessionId({
                type: 'server.connected',
                properties: {},
            }),
        ).toBeNull()
        expect(
            opencodeServerEventSessionId({
                type: 'server.heartbeat',
                properties: {},
            }),
        ).toBeNull()
        expect(opencodeServerEventSessionId(null)).toBeNull()
        expect(opencodeServerEventSessionId('garbage')).toBeNull()
        expect(opencodeServerEventSessionId({})).toBeNull()
    })
})
