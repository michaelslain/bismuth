// core/src/theme/themeFeed.ts
// The PURE half of GET /themes: raw `.themes/*.yaml` texts in, the feed out. No node:fs, so the
// in-process (iPad) backend imports it directly; themeFiles.ts is the Bun/fs side (symlink + size
// guards against the real disk), and both end in buildThemesFeed.
import {
    buildThemesFeed,
    parseCustomTheme,
    themeNameFromPath,
    THEMES_DIR,
    themeFilePath,
    type ThemesFeed,
} from './customTheme'

const MAX_BYTES = 64 * 1024

/** `names` are the entry names inside `.themes/`; `read` returns a file's text or null when it
 *  cannot be read. Non-theme names (wrong extension, bad slug) are skipped, order is by name. */
export async function themesFeedFromFiles(
    names: readonly string[],
    read: (rel: string) => Promise<string | null>,
): Promise<ThemesFeed> {
    const slugs = names
        .map(n => themeNameFromPath(`${THEMES_DIR}/${n}`))
        .filter((n): n is string => n !== null)
        .sort()
    const parsed = []
    for (const name of slugs) {
        const text = await read(themeFilePath(name))
        if (text === null) continue
        parsed.push(
            new TextEncoder().encode(text).length > MAX_BYTES
                ? {
                      name,
                      diagnostics: [
                          {
                              field: '',
                              severity: 'error' as const,
                              message: 'file too large (>64 KB)',
                          },
                      ],
                  }
                : parseCustomTheme(name, text),
        )
    }
    return buildThemesFeed(parsed)
}
