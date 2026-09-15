import { describe, expect, test } from 'bun:test'
import {
    CHAT_IMAGE_MIME,
    MAX_IMAGE_BYTES,
    MAX_TOTAL_IMAGE_BYTES,
    attachmentsTooLarge,
    imageIntakeDecision,
    readImageFile,
} from './chatImageIntake'

describe('constants', () => {
    test('accepted MIME set is exactly the SDK image block types', () => {
        expect([...CHAT_IMAGE_MIME].sort()).toEqual([
            'image/gif',
            'image/jpeg',
            'image/png',
            'image/webp',
        ])
    })

    test('size caps', () => {
        expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024)
        expect(MAX_TOTAL_IMAGE_BYTES).toBe(12 * 1024 * 1024)
    })
})

describe('imageIntakeDecision', () => {
    test('an accepted image under the cap is ok', () => {
        expect(
            imageIntakeDecision({
                name: 'a.png',
                type: 'image/png',
                size: 100,
            }),
        ).toEqual({ ok: true })
    })

    test('exactly at the cap is still ok; one byte over is too large', () => {
        const at = { name: 'a.png', type: 'image/png', size: MAX_IMAGE_BYTES }
        expect(imageIntakeDecision(at)).toEqual({ ok: true })
        expect(
            imageIntakeDecision({ ...at, size: MAX_IMAGE_BYTES + 1 }),
        ).toEqual({
            ok: false,
            message: 'Image "a.png" is too large (max 10 MB).',
        })
    })

    test('a non-image is refused by name', () => {
        expect(
            imageIntakeDecision({
                name: 'x.pdf',
                type: 'application/pdf',
                size: 1,
            }),
        ).toEqual({
            ok: false,
            message: `"x.pdf" isn't an image — it can't be attached.`,
        })
    })

    test('an unnamed file is called attachment', () => {
        expect(
            imageIntakeDecision({ name: '', type: 'text/plain', size: 1 }),
        ).toEqual({
            ok: false,
            message: `"attachment" isn't an image — it can't be attached.`,
        })
    })

    test('an image type outside the accepted set is unsupported', () => {
        expect(
            imageIntakeDecision({
                name: 'a.svg',
                type: 'image/svg+xml',
                size: 1,
            }),
        ).toEqual({
            ok: false,
            message:
                'Unsupported image type image/svg+xml — use PNG, JPEG, GIF, or WebP.',
        })
    })

    test('non-image check runs before the size check', () => {
        const d = imageIntakeDecision({
            name: 'big.zip',
            type: 'application/zip',
            size: MAX_IMAGE_BYTES * 2,
        })
        expect(d.ok).toBe(false)
        expect(!d.ok && d.message).toContain("isn't an image")
    })
})

describe('attachmentsTooLarge', () => {
    const att = (n: number) => ({
        name: 'a',
        mediaType: 'image/png',
        data: 'x'.repeat(n),
    })

    test('sums base64 lengths against the per-turn cap', () => {
        expect(attachmentsTooLarge([])).toBe(false)
        expect(attachmentsTooLarge([att(MAX_TOTAL_IMAGE_BYTES)])).toBe(false)
        expect(
            attachmentsTooLarge([att(MAX_TOTAL_IMAGE_BYTES - 1), att(2)]),
        ).toBe(true)
    })
})

describe('readImageFile', () => {
    test('resolves null for a MIME outside the accepted set without reading', async () => {
        const file = new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' })
        expect(await readImageFile(file)).toBeNull()
    })
})
