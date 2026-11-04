// Terminal cell widths. Hangul and other East Asian Wide characters take two
// cells, so every cut and pad in the drawings goes through these, never `.length`.

// [first, last] code points drawn two cells wide (East Asian Wide and Fullwidth).
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo leading consonants
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f5],
  [0x26fa, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x2753, 0x2755],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2e80, 0x303e], // CJK radicals, punctuation
  [0x3041, 0x33ff], // kana, CJK symbols
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo extended A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], // pictographs, emoticons
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd], // CJK extensions B and on
]

const isWide = (cp: number): boolean => {
  let lo = 0
  let hi = WIDE.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const range = WIDE[mid]
    if (range === undefined) return false
    if (cp < range[0]) hi = mid - 1
    else if (cp > range[1]) lo = mid + 1
    else return true
  }

  return false
}

// Marks that draw on the character before them, joiners and selectors: no cell of their own.
const isZeroWidth = (cp: number): boolean =>
  (cp >= 0x0300 && cp <= 0x036f) ||
  (cp >= 0x1160 && cp <= 0x11ff) || // Hangul Jamo vowels and trailing consonants join the syllable
  (cp >= 0x200b && cp <= 0x200f) ||
  (cp >= 0xfe00 && cp <= 0xfe0f) ||
  (cp >= 0x20d0 && cp <= 0x20ff) ||
  cp === 0xfeff

// A grapheme takes the width of its widest code point: a base plus marks is the base.
const graphemeCells = (g: string): number => {
  let width = 0
  for (const ch of g) {
    const cp = ch.codePointAt(0) ?? 0
    if (isZeroWidth(cp)) continue
    width = Math.max(width, isWide(cp) ? 2 : 1)
  }

  return width
}

const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

// Graphemes in order; without Intl.Segmenter, code points with marks folded onto the one before.
const graphemes = (text: string): string[] => {
  if (segmenter !== null) return Array.from(segmenter.segment(text), s => s.segment)
  const out: string[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (out.length > 0 && (isZeroWidth(cp) || cp === 0x200d)) out[out.length - 1] += ch
    else out.push(ch)
  }

  return out
}

export const cells = (text: string): number => graphemes(text).reduce((n, g) => n + graphemeCells(g), 0)

// The text cut to at most `max` cells, an ellipsis where it was cut.
export const fit = (text: string, max: number): string => {
  if (max <= 0) return ''
  if (cells(text) <= max) return text
  let used = 0
  let out = ''
  for (const g of graphemes(text)) {
    const w = graphemeCells(g)
    if (used + w > max - 1) break
    out += g
    used += w
  }

  return `${out}…`
}

export const padRight = (text: string, width: number): string => {
  const cut = fit(text, width)

  return cut + ' '.repeat(Math.max(0, width - cells(cut)))
}

export const padLeft = (text: string, width: number): string => {
  const cut = fit(text, width)

  return ' '.repeat(Math.max(0, width - cells(cut))) + cut
}
