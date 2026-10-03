// app/src/intro/glyphScenes/wordmarkBitmap.ts
// The lowercase `bismuth` wordmark, hand-drawn as a bitmap. '#' = filled, '.' = empty.
// Nine rows: rows 0-2 are the ascender band (b, h, t's stem, i's dot), rows 3-8 the x-height.
// Strokes are 2 cells wide (a cell is about twice as tall as wide, so a 1-row bar reads as the
// same weight as a 2-column stem); one empty column between letters. m is wider than the rest
// (three stems cannot be drawn legibly in 8 cells at this stroke weight).

const LETTERS = {
    b: [
        '##......',
        '##......',
        '##......',
        '#######.',
        '###..###',
        '##....##',
        '##....##',
        '###..###',
        '#######.',
    ],
    i: ['##', '##', '..', '##', '##', '##', '##', '##', '##'],
    s: [
        '........',
        '........',
        '........',
        '.######.',
        '###..###',
        '.###....',
        '....###.',
        '###..###',
        '.######.',
    ],
    m: [
        '............',
        '............',
        '............',
        '.##########.',
        '###..##..###',
        '##...##...##',
        '##...##...##',
        '##...##...##',
        '##...##...##',
    ],
    u: [
        '........',
        '........',
        '........',
        '##....##',
        '##....##',
        '##....##',
        '##....##',
        '###..###',
        '.#######',
    ],
    t: [
        '..##...',
        '..##...',
        '..##...',
        '#######',
        '..##...',
        '..##...',
        '..##...',
        '..###..',
        '...####',
    ],
    h: [
        '##......',
        '##......',
        '##......',
        '#######.',
        '###..###',
        '##....##',
        '##....##',
        '##....##',
        '##....##',
    ],
} as const

export const WORDMARK_ROWS = 9

/** Lowercase 'bismuth', one string per row, '#' = filled, '.' = empty; every row the same length. */
export const WORDMARK: readonly string[] = Array.from({ length: WORDMARK_ROWS }, (_, r) =>
    [LETTERS.b, LETTERS.i, LETTERS.s, LETTERS.m, LETTERS.u, LETTERS.t, LETTERS.h]
        .map(letter => letter[r])
        .join('.'),
)
