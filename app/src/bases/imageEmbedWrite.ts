// app/src/bases/imageEmbedWrite.ts
// The ONE "uploads -> embeds appended to a markdown value" path. The board's card-face drop
// (KanbanView) and the edit modal's description drop (CardEditModal) both call it, so an image
// dropped on either produces byte-identical markdown.
//
// Final signature:
//   embedUploadsIntoValue(opts: { uploads: ImageUpload[]; notePath: string; value: () => string }):
//       Promise<{ value: string; landed: number }>
// Uploads land beside `notePath` (attachment folder per settings). `value` is a READER, called
// AFTER the uploads resolve so anything typed while they ran is kept. Returns that fresh value with
// one `![[basename]]` embed per upload that landed appended (appendEmbedToValue), and `landed` =
// how many did; with `landed === 0` the value is returned unchanged. The upload seam is `api.uploadAsset`.
import { appendEmbedToValue } from './kanbanImageDrop'
import { uploadImageEmbeds, type ImageUpload } from './cardImageDrop'

export async function embedUploadsIntoValue(opts: {
    uploads: ImageUpload[]
    notePath: string
    value: () => string
}): Promise<{ value: string; landed: number }> {
    if (opts.uploads.length === 0) return { value: opts.value(), landed: 0 }
    const embeds = await uploadImageEmbeds(opts.uploads, opts.notePath)
    const value = opts.value()
    if (embeds.length === 0) return { value, landed: 0 }
    return {
        value: appendEmbedToValue(value, embeds.join('\n')),
        landed: embeds.length,
    }
}
