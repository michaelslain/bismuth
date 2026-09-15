// app/src/chat/chatImageIntake.ts
// Which dropped/pasted images a chat turn may carry as base64 SDK image blocks, and how one is read.
// Moved out of ChatView.tsx; the accept/refuse decision is pure so its messages and ordering are
// unit-tested, and `readImageFile` is the one browser-only (FileReader) step.
import type { ChatAttachment } from './chatSession'

// The image MIME types the Claude Agent SDK accepts as base64 image blocks. Deliberately NARROWER
// than the editor's attachment set (no svg/pdf) — those aren't valid `image` content blocks.
export const CHAT_IMAGE_MIME: ReadonlySet<string> = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
])

// A single screenshot rides one JSON WS frame (base64-inflated ~33%), so cap attachments to keep a
// multi-MB paste from wedging the socket.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

// Combined base64 payload cap for ONE turn's attachments. Bun silently drops a WS frame over ~16 MB
// ("message too big"), which would wedge the turn in streaming() forever — so keep the total well
// under that (base64 chars ≈ wire bytes).
export const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024 // ~12 MB of base64

export type ImageIntakeDecision = { ok: true } | { ok: false; message: string }

/** Whether `file` may be staged as an image attachment, with the inline notice when it may not.
 *  Order matches the chat's historical checks: not-an-image, then too large, then an image type
 *  the SDK does not accept. */
export function imageIntakeDecision(file: {
    name: string
    type: string
    size: number
}): ImageIntakeDecision {
    const name = file.name || 'attachment'
    if (!file.type.startsWith('image/'))
        return {
            ok: false,
            message: `"${name}" isn't an image — it can't be attached.`,
        }
    if (file.size > MAX_IMAGE_BYTES)
        return {
            ok: false,
            message: `Image "${name}" is too large (max 10 MB).`,
        }
    if (!CHAT_IMAGE_MIME.has(file.type)) return unsupportedImage(file.type)
    return { ok: true }
}

/** The notice for an image the SDK can't take (or one that failed to read). */
export function unsupportedImage(type: string): { ok: false; message: string } {
    return {
        ok: false,
        message: `Unsupported image type ${type || '(unknown)'} — use PNG, JPEG, GIF, or WebP.`,
    }
}

/** True when one turn's combined base64 payload would exceed MAX_TOTAL_IMAGE_BYTES. */
export function attachmentsTooLarge(atts: readonly ChatAttachment[]): boolean {
    return atts.reduce((n, a) => n + a.data.length, 0) > MAX_TOTAL_IMAGE_BYTES
}

/** Read an image File → base64 (stripping the `data:<mime>;base64,` prefix). Resolves null on a
 *  non-accepted MIME type or a read error, so callers can surface a friendly message. */
export function readImageFile(file: File): Promise<ChatAttachment | null> {
    if (!CHAT_IMAGE_MIME.has(file.type)) return Promise.resolve(null)
    return new Promise(resolve => {
        const reader = new FileReader()
        reader.onload = () => {
            const res = typeof reader.result === 'string' ? reader.result : ''
            const comma = res.indexOf(',')
            const data = comma >= 0 ? res.slice(comma + 1) : ''
            resolve(
                data
                    ? { name: file.name || 'image', mediaType: file.type, data }
                    : null,
            )
        }
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(file)
    })
}
