import { expect, test } from 'bun:test'
import { serverErrorText } from './serverError'

test('unwraps a json error body', () => {
    expect(
        serverErrorText(new Error('{"error":"command is not in the vault statusBar"}')),
    ).toBe('command is not in the vault statusBar')
})

test('plain message passes through', () => {
    expect(serverErrorText(new Error('boom'))).toBe('boom')
})

test('json without an error string passes through', () => {
    expect(serverErrorText(new Error('{"x":1}'))).toBe('{"x":1}')
})

test('non-error values are stringified', () => {
    expect(serverErrorText('str')).toBe('str')
})
