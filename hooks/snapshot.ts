// Every demo frame drawn the way the views draw it, in both languages: the band above the prompt
// (the note for a person coming back above it) at a few terminal sizes and on the desktop app, and
// the drawer at a few terminal widths and on the desktop app. The desktop shots list the rows the
// app sets in its own type, each with its kind. Snapshots and the preview page read these; the
// test compares their text with `snapshots.data.ts`.
import { LANGUAGES, language, setLanguage } from './i18n'
import type { Language } from './i18n'
import { scenarios } from './scenarios'
import type { Row } from './view'
import { BAND_ROWS, bandStack, drawerRows, rowText } from './view'

// `width` is the terminal's; a desktop shot has none.
export type Shot = { key: string; language: Language; scenario: string; label: string; view: 'band' | 'drawer'; width?: number; rows?: number; lines: Row[] }

export const BAND_SIZES: ReadonlyArray<{ width: number; rows: number }> = [
  { width: 40, rows: BAND_ROWS },
  { width: 80, rows: BAND_ROWS },
  { width: 60, rows: 6 },
]
export const DRAWER_WIDTHS: readonly number[] = [30, 53, 90]

const shotsIn = (lang: Language): Shot[] =>
  scenarios().flatMap(s =>
    s.frames.flatMap((f, i) => {
      const name = `${lang} ${s.id}${s.frames.length > 1 ? `#${i + 1}` : ''}`
      const base = { language: lang, scenario: `${s.title}${s.frames.length > 1 ? ` ${i + 1}/${s.frames.length}` : ''}`, label: f.label }
      return [
        ...BAND_SIZES.map(({ width, rows }) => ({ ...base, key: `${name} band ${width}x${rows}`, view: 'band' as const, width, rows, lines: bandStack(f.shown, f.activity, { width, maxRows: rows, folded: f.folded ?? false, now: f.now, away: f.away === true }) })),
        { ...base, key: `${name} band desktop`, view: 'band' as const, rows: BAND_ROWS, lines: bandStack(f.shown, f.activity, { maxRows: BAND_ROWS, folded: f.folded ?? false, now: f.now, away: f.away === true }) },
        ...DRAWER_WIDTHS.map(width => ({ ...base, key: `${name} drawer ${width}`, view: 'drawer' as const, width, lines: drawerRows(f.shown, f.activity, { width, now: f.now }) })),
        { ...base, key: `${name} drawer desktop`, view: 'drawer' as const, lines: drawerRows(f.shown, f.activity, { now: f.now }) },
      ]
    }),
  )

export const shots = (): Shot[] => {
  const was = language()
  try {
    return LANGUAGES.flatMap(lang => {
      setLanguage(lang)
      return shotsIn(lang)
    })
  } finally {
    setLanguage(was)
  }
}

// A terminal shot as the screen shows it; a desktop one as its rows, each led by its kind.
export const shotText = (shot: Shot): string =>
  shot.lines.map(r => (shot.width === undefined ? `${r.kind.padEnd(8)}| ${rowText(r)}` : rowText(r)).replace(/\s+$/, '')).join('\n')
