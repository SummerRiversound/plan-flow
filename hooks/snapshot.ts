// Every scenario frame drawn at a few sizes, the way the views draw it: the tree above
// the prompt (capped as the band caps it) and the drawer. Snapshots and the preview page
// read these; the test compares their text with `snapshots.data.ts`.
import { drawerView } from './drawer'
import { scenarios } from './scenarios'
import type { Line } from './tree'
import { BAND_ROWS, drawTree, lineText } from './tree'
import { t } from './i18n'

export type Shot = { key: string; scenario: string; label: string; view: 'band' | 'drawer'; width: number; rows?: number; lines: Line[] }

export const BAND_SIZES: ReadonlyArray<{ width: number; rows: number }> = [
  { width: 40, rows: BAND_ROWS },
  { width: 80, rows: BAND_ROWS },
  { width: 60, rows: 6 },
]
export const DRAWER_WIDTHS: readonly number[] = [30, 53, 90]

export const shots = (): Shot[] =>
  scenarios().flatMap(s =>
    s.frames.flatMap((f, i) => {
      const name = `${s.id}${s.frames.length > 1 ? `#${i + 1}` : ''}`
      const scenario = `${s.title}${s.frames.length > 1 ? ` ${i + 1}/${s.frames.length}` : ''}`
      const parked = f.board.shelf.filter(x => x.state === 'parked').length
      const finished = f.board.shelf.filter(x => x.state === 'done').map(x => x.plan.title)
      const band = BAND_SIZES.map(({ width, rows }) => ({
        key: `${name} band ${width}x${rows}`,
        scenario,
        label: f.label,
        view: 'band' as const,
        width,
        rows,
        lines: drawTree(f.board.plan, f.activity, { maxRows: rows, width, now: f.now, open: t().bandOpen, parked, folded: f.folded ?? false, finished }),
      }))
      const drawer = DRAWER_WIDTHS.map(width => ({
        key: `${name} drawer ${width}`,
        scenario,
        label: f.label,
        view: 'drawer' as const,
        width,
        lines: (() => {
          const v = drawerView(f.board.plan, f.board.shelf, { open: {}, focus: null }, f.activity, { width, now: f.now })
          return [...v.head, ...v.body]
        })(),
      }))

      return [...band, ...drawer]
    }),
  )

export const shotText = (shot: Shot): string => shot.lines.map(l => lineText(l).replace(/\s+$/, '')).join('\n')
