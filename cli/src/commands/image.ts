// `bismuth image describe` — have Claude Haiku write a description of one image into its companion
// note (`<file>.<ext>.md` frontmatter `description`), so semantic search and recall find it. Headless:
// it uses the machine's own claude login, no server needed.
import type { CommandMap } from '../types'
import { BOOLEAN_FLAGS, bool, fail, out, positionals, requireVault } from '../args'
import { describeImage } from '../../../core/src/imageDescribe'

const BOOLS = [...BOOLEAN_FLAGS, 'force']

export const commands: CommandMap = {
    'image describe': {
        summary:
            "Describe an image with Claude and write the description into its companion note, so semantic search finds the image",
        usage: '<file> [--force] [--vault <dir>]',
        args: {
            positionals: ['path'],
            flags: { force: 'bool', vault: 'value', pretty: 'bool' },
        },
        run: async args => {
            const vault = requireVault(args)
            const [file] = positionals(args, BOOLS)
            if (!file) fail(`usage: image describe ${commands['image describe'].usage}`)
            out(await describeImage(vault, file, { force: bool(args, 'force') }), args)
        },
    },
}
