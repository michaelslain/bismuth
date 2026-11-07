// app/src/chat/chatImageIntake.ts
// Which dropped/pasted images a chat turn may carry as base64 SDK image blocks, and how one is read.
// The accept/refuse decisions and the shrink plan are pure so they are unit-tested;
// `shrinkImageFile` (canvas) and `readImageFile` (FileReader) are the browser-only steps.
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

// The longest edge an attached image keeps, in pixels. The model reads an image at most this size
// (the Claude CLI downscales anything larger itself), so a bigger original only costs payload.
export const MAX_IMAGE_EDGE = 2000

// What one attached image may weigh after shrinking (raw bytes; base64 adds a third). Small enough
// that several screenshots fit under MAX_TOTAL_IMAGE_BYTES in one message.
export const TARGET_IMAGE_BYTES = 1.5 * 1024 * 1024

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

/** True when adding `next` to the staged `atts` would push the turn past MAX_TOTAL_IMAGE_BYTES —
 *  checked at intake, so no chip is ever staged that the send would then refuse. */
export function attachmentWouldOverflow(
    atts: readonly ChatAttachment[],
    next: ChatAttachment,
): boolean {
    return attachmentsTooLarge([...atts, next])
}

/** The notice for an image that does not fit in this message beside the ones already attached. */
export const NO_ROOM_MESSAGE =
    'No room for another image in this message — send these first, then attach it.'

/** `width`×`height` scaled down (never up) so the longer edge is at most `edge`. */
export function fitWithin(
    width: number,
    height: number,
    edge: number,
): { width: number; height: number } {
    const long = Math.max(width, height)
    if (long <= edge) return { width, height }
    const k = edge / long
    return {
        width: Math.max(1, Math.round(width * k)),
        height: Math.max(1, Math.round(height * k)),
    }
}

/** Whether an image is re-encoded before it is attached: larger than the edge or the byte budget. */
export function needsShrink(img: {
    width: number
    height: number
    size: number
}): boolean {
    return (
        Math.max(img.width, img.height) > MAX_IMAGE_EDGE ||
        img.size > TARGET_IMAGE_BYTES
    )
}

export type EncodeStep = { type: string; quality?: number }

/** The encodings tried, in order, until one fits TARGET_IMAGE_BYTES: the image's own lossless type
 *  first (PNG keeps screenshot text crisp and keeps transparency), then JPEG at falling quality. */
export function encodeSteps(mime: string): EncodeStep[] {
    const jpeg = [0.9, 0.8, 0.7, 0.6].map(quality => ({
        type: 'image/jpeg',
        quality,
    }))
    return mime === 'image/png' || mime === 'image/webp'
        ? [{ type: mime }, ...jpeg]
        : jpeg
}

/** The scale applied to the fitted size on each pass when no encoding fits at the current size. */
export const SHRINK_PASSES = [1, 0.75, 0.5] as const

/** The file name for an image re-encoded as `type`: the extension follows the new type. */
export function renamedFor(name: string, type: string): string {
    const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1] || 'png'
    const base = (name || 'image').replace(/\.[^./]+$/, '')
    return `${base}.${ext}`
}

/** Shrink an image File to MAX_IMAGE_EDGE and TARGET_IMAGE_BYTES through a canvas; browser-only.
 *  Returns the original when it already fits or cannot be decoded, and the smallest encoding tried
 *  when nothing reaches the budget. */
export async function shrinkImageFile(file: File): Promise<File> {
    let bitmap: ImageBitmap
    try {
        bitmap = await createImageBitmap(file)
    } catch {
        return file
    }
    try {
        if (
            !needsShrink({
                width: bitmap.width,
                height: bitmap.height,
                size: file.size,
            })
        )
            return file
        const fitted = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_EDGE)
        let best: Blob | null = null
        for (const k of SHRINK_PASSES) {
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.round(fitted.width * k))
            canvas.height = Math.max(1, Math.round(fitted.height * k))
            const ctx = canvas.getContext('2d')
            if (!ctx) return file
            for (const step of encodeSteps(file.type)) {
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                // JPEG has no alpha: paint transparent pixels white rather than black.
                if (step.type === 'image/jpeg') {
                    ctx.fillStyle = '#fff'
                    ctx.fillRect(0, 0, canvas.width, canvas.height)
                }
                ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
                const blob = await new Promise<Blob | null>(r =>
                    canvas.toBlob(r, step.type, step.quality),
                )
                if (!blob || blob.type !== step.type) continue
                if (!best || blob.size < best.size) best = blob
                if (blob.size <= TARGET_IMAGE_BYTES)
                    return new File([blob], renamedFor(file.name, blob.type), {
                        type: blob.type,
                    })
            }
        }
        return best && best.size < file.size
            ? new File([best], renamedFor(file.name, best.type), {
                  type: best.type,
              })
            : file
    } finally {
        bitmap.close()
    }
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
