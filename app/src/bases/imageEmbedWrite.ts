// app/src/bases/imageEmbedWrite.ts
// The ONE "uploads -> embeds appended to a markdown value" path. The board's card-face drop
// (KanbanView) and the edit modal's description drop (CardEditModal) both call it, so an image
// dropped on either produces byte-identical markdown.
//
// Final signature:
//   embedUploadsIntoValue(opts: { uploads: ImageUpload[]; notePath: string; value: string }): Promise<string>
// Uploads land beside `notePath` (attachment folder per settings). Returns `value` with one
// `![[basename]]` embed per upload that landed appended (appendEmbedToValue); returns `value`
// unchanged when nothing landed. The upload seam is `api.uploadAsset`.
import { appendEmbedToValue } from './kanbanImageDrop'
import { uploadImageEmbeds, type ImageUpload } from './cardImageDrop'

export async function embedUploadsIntoValue(opts: {
    uploads: ImageUpload[]
    notePath: string
    value: string
}): Promise<string> {
    if (opts.uploads.length === 0) return opts.value
    const embeds = await uploadImageEmbeds(opts.uploads, opts.notePath)
    if (embeds.length === 0) return opts.value
    return appendEmbedToValue(opts.value, embeds.join('\n'))
}
