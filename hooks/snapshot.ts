// Every scenario frame drawn at a few sizes, the way the views draw it: the tree above
// the prompt (capped as the band caps it) and the drawer. Snapshots and the preview page
// read these; the test compares their text with `snapshots.data.ts`.
import { drawerView } from './drawer'
import { SCENARIOS } from './scenarios'
import type { Line } from './tree'
import { BAND_ROWS, layoutTree, lineText } from './tree'

export type Shot = { key: string; scenario: string; label: string; view: 'band' | 'drawer'; width: number; rows?: number; lines: Line[] }

export const BAND_SIZES: ReadonlyArray<{ width: number; rows: number }> = [
  { width: 40, rows: BAND_ROWS },
  { width: 80, rows: BAND_ROWS },
  { width: 60, rows: 6 },
]
export const DRAWER_WIDTHS: readonly number[] = [30, 53, 90]

export const shots = (): Shot[] =>
  SCENARIOS.flatMap(s =>
    s.frames.flatMap((f, i) => {
      const name = `${s.id}${s.frames.length > 1 ? `#${i + 1}` : ''}`
      const scenario = `${s.title}${s.frames.length > 1 ? ` ${i + 1}/${s.frames.length}` : ''}`
      const parked = f.board.shelf.filter(x => x.state === 'parked').length
      const band = BAND_SIZES.map(({ width, rows }) => ({
        key: `${name} band ${width}x${rows}`,
        scenario,
        label: f.label,
        view: 'band' as const,
        width,
        rows,
        lines: layoutTree(f.board.plan, f.activity, { maxRows: rows, width, accent: 'claude', now: f.now, open: '흐름도 보기 ▸', parked }).lines,
      }))
      const drawer = DRAWER_WIDTHS.map(width => ({
        key: `${name} drawer ${width}`,
        scenario,
        label: f.label,
        view: 'drawer' as const,
        width,
        lines: drawerView(f.board.plan, f.board.shelf, { open: {}, focus: null }, f.activity, { width, accent: 'claude', now: f.now }).lines,
      }))

      return [...band, ...drawer]
    }),
  )

export const shotText = (shot: Shot): string => shot.lines.map(l => lineText(l).replace(/\s+$/, '')).join('\n')
