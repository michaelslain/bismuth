// core/test/chatProviders/codexProtocol.test.ts
// Pure unit tests for the ThreadEvent -> ChatFrame translator. Never spawns `codex` — every event
// here is hand-built, matching the shapes verified from @openai/codex-sdk's shipped dist/index.d.ts
// (see protocol.ts's header).
import { describe, expect, test } from 'bun:test'
import {
    newCodexTranslateState,
    resetCodexTurnState,
    translateThreadEvent,
} from '../../src/chatProviders/codex/protocol'

describe('translateThreadEvent', () => {
    test('thread.started emits a session frame and records the thread id', () => {
        const state = newCodexTranslateState()
        const frames = translateThreadEvent(
            { type: 'thread.started', thread_id: 'th_123' },
            state,
        )
        expect(frames).toEqual([
            { type: 'session', sessionId: 'th_123', origin: 'user' },
        ])
        expect(state.threadId).toBe('th_123')
    })

    test('thread.started with a missing/non-string thread_id is ignored, not crashed on', () => {
        const state = newCodexTranslateState()
        expect(translateThreadEvent({ type: 'thread.started' }, state)).toEqual(
            [],
        )
        expect(
            translateThreadEvent(
                { type: 'thread.started', thread_id: 42 },
                state,
            ),
        ).toEqual([])
    })

    test('an agent_message item streams as assistant-text deltas across started -> completed', () => {
        const state = newCodexTranslateState()
        const started = translateThreadEvent(
            {
                type: 'item.started',
                item: { id: 'item_0', type: 'agent_message', text: '' },
            },
            state,
        )
        expect(started).toEqual([]) // empty delta on an empty start — nothing to show yet
        const completed = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_0',
                    type: 'agent_message',
                    text: 'Hello world',
                },
            },
            state,
        )
        expect(completed).toEqual([
            { type: 'assistant-text', text: 'Hello world' },
        ])
    })

    test('a reasoning item growing across item.updated emits only the NEW suffix each time', () => {
        const state = newCodexTranslateState()
        const a = translateThreadEvent(
            {
                type: 'item.started',
                item: { id: 'item_1', type: 'reasoning', text: 'Thinking' },
            },
            state,
        )
        expect(a).toEqual([{ type: 'thinking', text: 'Thinking' }])
        const b = translateThreadEvent(
            {
                type: 'item.updated',
                item: {
                    id: 'item_1',
                    type: 'reasoning',
                    text: 'Thinking further',
                },
            },
            state,
        )
        expect(b).toEqual([{ type: 'thinking', text: ' further' }])
        const c = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_1',
                    type: 'reasoning',
                    text: 'Thinking further.',
                },
            },
            state,
        )
        expect(c).toEqual([{ type: 'thinking', text: '.' }])
    })

    test('if the text does not grow as expected, the whole current value is re-emitted rather than a garbage slice', () => {
        const state = newCodexTranslateState()
        translateThreadEvent(
            {
                type: 'item.started',
                item: { id: 'item_2', type: 'agent_message', text: 'abcdef' },
            },
            state,
        )
        // A "shrunk"/edited value — should never throw, and must show something sane (the whole value).
        const frames = translateThreadEvent(
            {
                type: 'item.updated',
                item: { id: 'item_2', type: 'agent_message', text: 'xyz' },
            },
            state,
        )
        expect(frames).toEqual([{ type: 'assistant-text', text: 'xyz' }])
    })

    test('a completed item with no matching started re-emits nothing spurious (empty delta)', () => {
        const state = newCodexTranslateState()
        const frames = translateThreadEvent(
            {
                type: 'item.completed',
                item: { id: 'item_3', type: 'agent_message', text: '' },
            },
            state,
        )
        expect(frames).toEqual([])
    })

    test('command_execution: tool-use on started, tool-result (paired by id) on completed', () => {
        const state = newCodexTranslateState()
        const started = translateThreadEvent(
            {
                type: 'item.started',
                item: {
                    id: 'item_0',
                    type: 'command_execution',
                    command: 'npm test',
                    aggregated_output: '',
                    status: 'in_progress',
                },
            },
            state,
        )
        expect(started).toEqual([
            {
                type: 'tool-use',
                id: 'item_0',
                name: 'command_execution',
                input: { command: 'npm test' },
            },
        ])

        const completed = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_0',
                    type: 'command_execution',
                    command: 'npm test',
                    aggregated_output: 'ok\n',
                    exit_code: 0,
                    status: 'completed',
                },
            },
            state,
        )
        expect(completed).toEqual([
            {
                type: 'tool-result',
                id: 'item_0',
                content: 'ok\n',
                isError: false,
            },
        ])
    })

    test('a failed command_execution reports isError: true', () => {
        const state = newCodexTranslateState()
        translateThreadEvent(
            {
                type: 'item.started',
                item: {
                    id: 'item_0',
                    type: 'command_execution',
                    command: 'false',
                    aggregated_output: '',
                    status: 'in_progress',
                },
            },
            state,
        )
        const completed = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_0',
                    type: 'command_execution',
                    command: 'false',
                    aggregated_output: 'boom',
                    exit_code: 1,
                    status: 'failed',
                },
            },
            state,
        )
        expect(completed).toEqual([
            {
                type: 'tool-result',
                id: 'item_0',
                content: 'boom',
                isError: true,
            },
        ])
    })

    test('an item.updated for an already-known tool item does not re-emit tool-use', () => {
        const state = newCodexTranslateState()
        translateThreadEvent(
            {
                type: 'item.started',
                item: {
                    id: 'item_0',
                    type: 'command_execution',
                    command: 'sleep 1',
                    aggregated_output: '',
                    status: 'in_progress',
                },
            },
            state,
        )
        const updated = translateThreadEvent(
            {
                type: 'item.updated',
                item: {
                    id: 'item_0',
                    type: 'command_execution',
                    command: 'sleep 1',
                    aggregated_output: 'partial…',
                    status: 'in_progress',
                },
            },
            state,
        )
        expect(updated).toEqual([]) // still in progress — no result yet, and tool-use already emitted
    })

    test('a completed item never seen at item.started still gets both frames exactly once', () => {
        const state = newCodexTranslateState()
        const frames = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_9',
                    type: 'command_execution',
                    command: 'ls',
                    aggregated_output: 'a\nb\n',
                    status: 'completed',
                },
            },
            state,
        )
        expect(frames).toEqual([
            {
                type: 'tool-use',
                id: 'item_9',
                name: 'command_execution',
                input: { command: 'ls' },
            },
            {
                type: 'tool-result',
                id: 'item_9',
                content: 'a\nb\n',
                isError: false,
            },
        ])
    })

    test('mcp_tool_call: successful result content, and error content on failure', () => {
        const state = newCodexTranslateState()
        const ok = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_5',
                    type: 'mcp_tool_call',
                    server: 'bismuth',
                    tool: 'recall',
                    arguments: { query: 'x' },
                    result: {
                        content: [{ type: 'text', text: 'found it' }],
                        structured_content: null,
                    },
                    status: 'completed',
                },
            },
            state,
        )
        expect(ok[0]).toEqual({
            type: 'tool-use',
            id: 'item_5',
            name: 'mcp:bismuth/recall',
            input: {
                server: 'bismuth',
                tool: 'recall',
                arguments: { query: 'x' },
            },
        })
        expect(ok[1]).toEqual({
            type: 'tool-result',
            id: 'item_5',
            content: 'found it',
            isError: false,
        })

        const state2 = newCodexTranslateState()
        const failed = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_6',
                    type: 'mcp_tool_call',
                    server: 'bismuth',
                    tool: 'recall',
                    arguments: {},
                    error: { message: 'boom' },
                    status: 'failed',
                },
            },
            state2,
        )
        expect(failed[1]).toEqual({
            type: 'tool-result',
            id: 'item_6',
            content: 'boom',
            isError: true,
        })
    })

    test('file_change formats each changed path with its kind', () => {
        const state = newCodexTranslateState()
        const frames = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_7',
                    type: 'file_change',
                    changes: [
                        { path: 'a.ts', kind: 'update' },
                        { path: 'b.ts', kind: 'add' },
                    ],
                    status: 'completed',
                },
            },
            state,
        )
        expect(frames[1]).toEqual({
            type: 'tool-result',
            id: 'item_7',
            content: 'update a.ts\nadd b.ts',
            isError: false,
        })
    })

    test('web_search reports the query as both input and result content', () => {
        const state = newCodexTranslateState()
        const started = translateThreadEvent(
            {
                type: 'item.started',
                item: { id: 'item_8', type: 'web_search', query: 'codex sdk' },
            },
            state,
        )
        expect(started).toEqual([
            {
                type: 'tool-use',
                id: 'item_8',
                name: 'web_search',
                input: { query: 'codex sdk' },
            },
        ])
    })

    test('an error-type item is surfaced as an error frame', () => {
        const state = newCodexTranslateState()
        const frames = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_e',
                    type: 'error',
                    message: 'something broke',
                },
            },
            state,
        )
        expect(frames).toEqual([
            { type: 'error', code: 'error', message: 'something broke' },
        ])
    })

    test('a todo_list item (no ChatFrame mapping) is safely ignored', () => {
        const state = newCodexTranslateState()
        const frames = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_t',
                    type: 'todo_list',
                    items: [{ text: 'step 1', completed: false }],
                },
            },
            state,
        )
        expect(frames).toEqual([])
    })

    test('turn.failed surfaces the error message', () => {
        const state = newCodexTranslateState()
        const frames = translateThreadEvent(
            { type: 'turn.failed', error: { message: 'rate limited' } },
            state,
        )
        expect(frames).toEqual([
            { type: 'error', code: 'error', message: 'rate limited' },
        ])
    })

    test('turn.failed with a malformed error object still yields a safe fallback message', () => {
        const state = newCodexTranslateState()
        const frames = translateThreadEvent({ type: 'turn.failed' }, state)
        expect(frames).toEqual([
            { type: 'error', code: 'error', message: 'Codex turn failed.' },
        ])
    })

    test('a fatal stream-level error event is surfaced', () => {
        const state = newCodexTranslateState()
        const frames = translateThreadEvent(
            { type: 'error', message: 'stream died' },
            state,
        )
        expect(frames).toEqual([
            { type: 'error', code: 'error', message: 'stream died' },
        ])
    })

    test('turn.started and turn.completed produce no frames of their own', () => {
        const state = newCodexTranslateState()
        expect(translateThreadEvent({ type: 'turn.started' }, state)).toEqual(
            [],
        )
        expect(
            translateThreadEvent(
                {
                    type: 'turn.completed',
                    usage: {
                        input_tokens: 1,
                        cached_input_tokens: 0,
                        cache_write_input_tokens: 0,
                        output_tokens: 1,
                        reasoning_output_tokens: 0,
                    },
                },
                state,
            ),
        ).toEqual([])
    })

    test('completely malformed / unrecognized input never throws and yields no frames', () => {
        const state = newCodexTranslateState()
        expect(translateThreadEvent(null, state)).toEqual([])
        expect(translateThreadEvent(undefined, state)).toEqual([])
        expect(translateThreadEvent('a raw string', state)).toEqual([])
        expect(translateThreadEvent(42, state)).toEqual([])
        expect(translateThreadEvent([], state)).toEqual([])
        expect(translateThreadEvent({}, state)).toEqual([])
        expect(
            translateThreadEvent(
                { type: 'some.future.event', weird: true },
                state,
            ),
        ).toEqual([])
        expect(
            translateThreadEvent({ type: 'item.completed', item: null }, state),
        ).toEqual([])
        expect(
            translateThreadEvent(
                { type: 'item.completed', item: { type: 'agent_message' } },
                state,
            ),
        ).toEqual([]) // missing id
    })
})

describe('resetCodexTurnState', () => {
    test('clears per-turn item tracking so a REUSED item id in a later turn starts fresh', () => {
        const state = newCodexTranslateState()
        // Turn 1: item_0 streams "Hello" and a tool runs to completion.
        translateThreadEvent(
            {
                type: 'item.completed',
                item: { id: 'item_0', type: 'agent_message', text: 'Hello' },
            },
            state,
        )
        translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_1',
                    type: 'command_execution',
                    command: 'ls',
                    aggregated_output: 'x',
                    status: 'completed',
                },
            },
            state,
        )

        resetCodexTurnState(state)

        // Turn 2 reuses "item_0"/"item_1" (Codex's ids are plausibly turn-scoped) — must behave as a
        // FRESH item, not a diff against turn 1's stale text / a suppressed duplicate tool-use.
        const text = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_0',
                    type: 'agent_message',
                    text: 'Different turn',
                },
            },
            state,
        )
        expect(text).toEqual([
            { type: 'assistant-text', text: 'Different turn' },
        ])

        const tool = translateThreadEvent(
            {
                type: 'item.completed',
                item: {
                    id: 'item_1',
                    type: 'command_execution',
                    command: 'pwd',
                    aggregated_output: 'y',
                    status: 'completed',
                },
            },
            state,
        )
        expect(tool).toEqual([
            {
                type: 'tool-use',
                id: 'item_1',
                name: 'command_execution',
                input: { command: 'pwd' },
            },
            { type: 'tool-result', id: 'item_1', content: 'y', isError: false },
        ])
    })

    test('does not touch the durable threadId', () => {
        const state = newCodexTranslateState()
        translateThreadEvent(
            { type: 'thread.started', thread_id: 'th_abc' },
            state,
        )
        resetCodexTurnState(state)
        expect(state.threadId).toBe('th_abc')
    })
})
