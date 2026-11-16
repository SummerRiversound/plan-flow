// The request-list board as rows: the band above the prompt, the note when the person comes back,
// and the drawer's long list of chapters. Pure: register.tsx draws the rows, as characters on a
// terminal (given a `width`: rows are cut and wrapped to it) and in the app's own type elsewhere
// (no width: one row per text, the app wraps it). Both surfaces draw the same rows.
import type { Activity } from '../types'
import { activityLabel } from './activity'
import type { Board, Chapter, Kind, Receipt } from './chapters'
import { t } from './i18n'
import { cells, fit, padRight, wrap } from './width'

// `color` is a theme key; `button` the id a press on the piece reports; `href` makes it a link;
// `live` marks the running chapter's turning mark, which a surface that draws pictures turns itself.
export type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean; button?: string; href?: string; live?: boolean }
export type Line = Seg[]
// What a row is, so a surface with its own type can set it: a heading, a footnote, a row of links.
export type RowKind = 'title' | 'goal' | 'chapter' | 'detail' | 'links' | 'heading' | 'item' | 'activity' | 'rule' | 'blank' | 'note'
// `indent` in cells, before the row's pieces.
export type Row = { kind: RowKind; indent: number; line: Line }
// The board with what the rules keep beside it: open dialog questions and background work.
export type Shown = { board: Board; asked: readonly string[]; running: number }

// The most rows the band takes above the prompt.
export const BAND_ROWS = 10
// How long one frame of the running chapter's turning mark lasts.
export const FRAME_MS = 100
export const OPEN_BUTTON = 'open-drawer'
export const FOLD_BUTTON = 'fold-band'
export const REFRESH = 'refresh'
// Buttons the terminal frames as `[ … ]`, and the band's main one.
export const BOXED: ReadonlySet<string> = new Set([OPEN_BUTTON, REFRESH])
export const PRIMARY: ReadonlySet<string> = new Set([OPEN_BUTTON])
// Three colours carry meaning: green for done, red for an error, and the permission colour for
// what waits on the person. Everything else is plain text or muted.
export const WAIT_COLOR = 'permission'
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

// Claude is at work, not waiting on the person and not between turns.
export const isLive = (a: Activity): boolean => a.phase === 'working' || a.phase === 'tool' || a.phase === 'compacting'

export const lineText = (line: Line): string => line.map(s => s.text).join('')

// Cuts a line to `max` cells, with an ellipsis where it is cut.
export const fitLine = (line: Line, max: number): Line => {
  const out: Line = []
  let room = Math.max(0, max)
  for (const seg of line) {
    const c = cells(seg.text)
    if (c <= room) {
      out.push(seg)
      room -= c
      continue
    }
    if (room > 0) out.push({ ...seg, text: fit(seg.text, room) })
    break
  }

  return out
}

// A short name for a link: a PR, issue or commit by its number, an artifact as such,
// another URL by its host, a file by its name.
export const linkLabel = (link: string): string => {
  const gh = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues|commit)\/([^/?#]+)/.exec(link)
  if (gh !== null) return gh[1] === 'pull' ? `PR #${gh[2]}` : gh[1] === 'issues' ? t().link.issue(gh[2] ?? '') : t().link.commit((gh[2] ?? '').slice(0, 7))
  if (/^https?:\/\/claude\.ai\/(.*\/)?artifact\//.test(link)) return t().link.artifact
  const url = /^[a-z]+:\/\/(?:www\.)?([^/?#]+)/i.exec(link)
  if (url !== null) return url[1] ?? link

  return link.split('/').filter(p => p !== '').pop() ?? link
}

// Where a press on the link goes: URLs as they are, absolute paths as files; anything else stays plain.
export const hrefOf = (link: string): string | undefined =>
  /^[a-z]+:\/\//i.test(link) ? link : link.startsWith('/') ? `file://${encodeURI(link)}` : undefined

const last = (s: Shown): Chapter | undefined => s.board.chapters.at(-1)
const leftOf = (s: Shown, kind: Kind): string[] => last(s)?.left.filter(l => l.kind === kind).map(l => l.text) ?? []
// What waits on the person: the dialog questions still open, then what the last answer left to them.
export const mineOf = (s: Shown): string[] => [...s.asked, ...leftOf(s, 'mine')]

// A chapter's mark: turning while Claude works on the latest, `✓` done, `◐` when the latest waits on the person.
const markOf = (s: Shown, i: number, spin: string | null): Seg => {
  const c = s.board.chapters[i]
  const latest = i === s.board.chapters.length - 1
  if (latest && spin !== null) return { text: spin, color: 'text', bold: true, live: true }
  if (c?.done === true) return { text: '✓', color: 'success' }
  if (latest && mineOf(s).length > 0) return { text: '◐', color: WAIT_COLOR }

  return { text: '○', color: 'inactive' }
}

// The session's subject: the writer's title, else the first request's words.
export const titleOf = (b: Board): string => (b.title !== '' ? b.title : (b.chapters[0]?.title ?? ''))

// A chapter's row: number, mark, title (bold while it is the latest), and with `result` its result after `→`.
const chapterLine = (s: Shown, i: number, spin: string | null, result: boolean): Line => {
  const c = s.board.chapters[i] as Chapter
  const latest = i === s.board.chapters.length - 1

  return [
    { text: `${i + 1} `, color: 'inactive' },
    markOf(s, i, spin),
    { text: ' ' },
    { text: c.title, bold: latest ? true : undefined, color: c.done && !latest ? 'inactive' : 'text' },
    ...(result && c.result !== '' ? [{ text: `  → ${c.result}`, color: 'inactive' }] : []),
  ]
}

// What became of a PR anywhere in the session: the last thing done to it.
const prState = (b: Board): Map<string, Receipt['what']> => {
  const m = new Map<string, Receipt['what']>()
  for (const c of b.chapters) for (const r of c.receipts) if (r.what !== 'release') m.set(r.ref, r.what)

  return m
}

// A chapter's receipts (a PR once each, as it stands now) and its links, each `↗ name`, pressable where it has a target.
const linkPieces = (b: Board, c: Chapter): Seg[] => {
  const now = prState(b)
  const seen = new Set<string>()
  const out: Seg[] = []
  for (const r of c.receipts) {
    if (seen.has(r.ref)) continue
    seen.add(r.ref)
    if (r.url !== undefined) seen.add(r.url)
    const text = `↗ ${r.what === 'release' ? t().receipt.release(r.ref) : `${r.ref} ${t().receipt[now.get(r.ref) ?? r.what]}`}`
    out.push({ text, color: 'text', ...(r.url === undefined ? {} : { href: r.url }) })
  }
  for (const l of c.links) {
    const label = linkLabel(l)
    if (seen.has(l) || seen.has(label)) continue
    seen.add(l)
    const href = hrefOf(l)
    out.push({ text: `↗ ${label}`, color: 'text', ...(href === undefined ? {} : { href }) })
  }

  return out
}

// Pieces two cells apart, in rows of `w` cells: one row ending in `+N` with `oneRow`, else as many as they need.
const pieceRows = (pieces: readonly Seg[], w: number | undefined, oneRow: boolean): Line[] => {
  if (pieces.length === 0) return []
  const join = (ps: readonly Seg[]): Line => ps.flatMap((p, i) => (i === 0 ? [p] : [{ text: '  ' }, p]))
  if (w === undefined) return [join(pieces)]
  const rows: Seg[][] = [[]]
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i] as Seg
    const row = rows[rows.length - 1] as Seg[]
    const used = cells(lineText(join(row)))
    const more = oneRow && i < pieces.length - 1 ? cells(`  +${pieces.length - i - 1}`) : 0
    if (row.length === 0 || used + 2 + cells(p.text) + more <= w) {
      row.push(row.length === 0 ? { ...p, text: fit(p.text, w) } : p)
      continue
    }
    if (oneRow) return [[...join(row), { text: `  +${pieces.length - i}`, color: 'inactive' }]]
    rows.push([{ ...p, text: fit(p.text, w) }])
  }

  return rows.map(join)
}

// What is left, grouped by who moves next, in the order the person reads it.
const GROUPS: ReadonlyArray<{ kind: Kind; mark: string; color: string }> = [
  { kind: 'mine', mark: '◐', color: WAIT_COLOR },
  { kind: 'claude', mark: '○', color: 'inactive' },
  { kind: 'others', mark: '○', color: 'inactive' },
  { kind: 'optional', mark: '·', color: 'inactive' },
  { kind: 'unverified', mark: '?', color: 'inactive' },
]
type Group = { kind: Kind; heading: Line; items: Line[] }
const groupsOf = (s: Shown, kinds: readonly Kind[]): Group[] =>
  GROUPS.filter(g => kinds.includes(g.kind)).flatMap(g => {
    const texts = g.kind === 'mine' ? mineOf(s) : leftOf(s, g.kind)
    if (texts.length === 0) return []
    const heading: Line = [{ text: t().left[g.kind], bold: true, color: g.kind === 'mine' ? WAIT_COLOR : 'text' }]
    return [{ kind: g.kind, heading, items: texts.map(x => [{ text: `${g.mark} `, color: g.color }, { text: x }]) }]
  })

// What Claude is doing now, and the background work still running.
const activityLines = (s: Shown, a: Activity): Line[] => {
  const label = a.phase === 'idle' ? undefined : activityLabel(a)
  const waiting = a.phase === 'question' || a.phase === 'permission'
  const dot = a.phase === 'error' ? 'error' : waiting ? WAIT_COLOR : 'text'
  const bg = Math.max(s.running, a.phase === 'idle' ? (a.background ?? 0) : 0)

  return [
    ...(label === undefined ? [] : [[{ text: '● ', color: dot }, { text: label, color: waiting ? WAIT_COLOR : 'text' }]]),
    ...(bg === 0 ? [] : [[{ text: t().activity.background(bg) }]]),
  ]
}

const spinOf = (a: Activity, now: number): string | null => (isLive(a) ? (SPIN[Math.floor(now / FRAME_MS) % SPIN.length] ?? '●') : null)

// A row cut to the terminal's width, less its indent; untouched where the app sets its own type.
const row = (kind: RowKind, indent: number, line: Line, w: number | undefined): Row => ({ kind, indent, line: w === undefined ? line : fitLine(line, w - indent) })

// The title, then flush right a newer version's notice (given way first) and the band's or drawer's button.
const titleRow = (title: string, w: number | undefined, o: { fold?: boolean; folded?: boolean; button?: { id: string; text: string }; notice?: string }): Row => {
  const arrow = o.fold === true ? (o.folded === true ? ' ▾' : ' ▴') : ''
  const press = o.fold === true ? { button: FOLD_BUTTON } : {}
  const head = (room: number): Line => [{ text: fit(title, Math.max(0, room - cells(arrow))), bold: true, color: 'text', ...press }, ...(arrow === '' ? [] : [{ text: arrow, color: 'inactive', ...press }])]
  const tag: Line = o.notice === undefined ? [] : [{ text: o.notice, color: 'text' }]
  const btn: Line = o.button === undefined ? [] : [{ text: o.button.text, bold: true, button: o.button.id }]
  if (w === undefined) return { kind: 'title', indent: 0, line: [...head(Number.POSITIVE_INFINITY), ...tag, ...btn] }
  // The engine frames a button in `[ ` and ` ]`, four cells its text does not count; the title keeps ten.
  const size = (l: Line) => cells(lineText(l)) + (l.some(x => x.button !== undefined) ? 4 : 0)
  const both: Line = tag.length === 0 || btn.length === 0 ? [...tag, ...btn] : [...tag, { text: '  ' }, ...btn]
  const right = size(both) + 10 <= w ? both : size(btn) + 10 <= w ? btn : []
  if (right.length === 0) return { kind: 'title', indent: 0, line: head(w) }
  const cut = head(w - size(right) - 1)

  return { kind: 'title', indent: 0, line: [...cut, { text: padRight('', w - cells(lineText(cut)) - size(right)) }, ...right] }
}

const goalRows = (goal: string, w: number | undefined, rows: number): Row[] =>
  goal === '' ? [] : (w === undefined ? [goal] : wrap(goal, w, rows)).map(g => ({ kind: 'goal', indent: 0, line: [{ text: g, color: 'inactive' }] }))

export type BandOptions = { width?: number; maxRows: number; folded: boolean; now: number; notice?: string }

// The band above the prompt: the subject and goal, the latest three chapters with what came of them,
// under the latest its receipts and links and what Claude is doing, then what is left by who moves next.
// Past `maxRows` the least needed rows go first: older chapters, then what others and Claude do, then
// the rest of the goal; the title, the latest chapter and what waits on the person stay longest.
export const bandRows = (s: Shown, a: Activity, o: BandOptions): Row[] => {
  const w = o.width
  const n = s.board.chapters.length
  const out: Array<Row & { p: number }> = []
  const add = (p: number, r: Row) => out.push({ ...r, p })
  add(0, titleRow(titleOf(s.board), w, { fold: true, folded: o.folded, button: { id: OPEN_BUTTON, text: t().bandOpen }, ...(o.notice === undefined ? {} : { notice: o.notice }) }))
  goalRows(s.board.goal, w, o.folded ? 1 : 3).forEach((r, i) => add(i === 0 ? 1 : 12, r))
  if (!o.folded) {
    const spin = spinOf(a, o.now)
    for (let i = Math.max(0, n - 3); i < n; i++) add(i === n - 1 ? 2 : i === n - 2 ? 7 : 11, row('chapter', 0, chapterLine(s, i, spin, true), w))
    const latest = last(s)
    if (latest !== undefined) for (const l of pieceRows(linkPieces(s.board, latest), w === undefined ? undefined : w - 2, true)) add(6, row('links', 2, l, w))
    for (const l of activityLines(s, a)) add(3, row('activity', 2, l, w))
    const rank: Partial<Record<Kind, number>> = { mine: 4, claude: 8, others: 9 }
    for (const g of groupsOf(s, ['mine', 'claude', 'others'])) {
      const p = rank[g.kind] ?? 20
      add(p, row('heading', 2, g.heading, w))
      // A group's first item goes with its heading; the rest of what waits on the person stays
      // longer than other headings, the rest of the others' go first.
      g.items.forEach((it, k) => add(k === 0 ? p : g.kind === 'mine' ? 5 : 20 + k, row('item', 2, it, w)))
    }
  }
  let kept = out
  for (const p of [...new Set(out.map(r => r.p))].sort((x, y) => y - x)) {
    if (kept.length <= o.maxRows) break
    kept = kept.filter(r => r.p !== p)
  }

  return kept.slice(0, Math.max(1, o.maxRows)).map(({ p: _, ...r }) => r)
}

// The note above the band when the person comes back: how the latest chapter ended, its receipts
// and links, and what waits on them. Empty when there is nothing to tell. On a terminal it is framed
// down its left edge; the app draws its own frame.
export const awayRows = (s: Shown, w: number | undefined): Row[] => {
  const latest = last(s)
  if (latest === undefined) return []
  const inner = w === undefined ? undefined : w - 2
  const body: Line[] = [
    ...(latest.result === '' ? [] : [[latest.done ? { text: '✓ ', color: 'success' } : { text: '· ', color: 'inactive' }, { text: latest.result }]]),
    ...pieceRows(linkPieces(s.board, latest), inner, true),
    ...mineOf(s).map((m): Line => [{ text: '◐ ', color: WAIT_COLOR }, { text: m }]),
  ]
  if (body.length === 0) return []
  const edge = (c: string): Seg[] => (w === undefined ? [] : [{ text: `${c} `, color: 'inactive' }])

  return [
    row('note', 0, [...edge('╭'), { text: t().away.head, bold: true }], w),
    ...body.map(l => row('note', 0, [...edge('│'), ...l], w)),
    row('note', 0, [...edge('╰'), { text: t().away.foot, color: 'inactive' }], w),
  ]
}

// Wraps `text` under a label column: the label on the first row, the text's later rows under its start.
const labelled = (label: string, col: number, text: string, w: number | undefined): Row[] => {
  const lab = (x: string): Seg => ({ text: padRight(x, col + 2), color: 'inactive' })
  if (w === undefined) return [{ kind: 'detail', indent: 2, line: [lab(label), { text }] }]
  const rows = wrap(text, Math.max(1, w - 2 - col - 2), Number.POSITIVE_INFINITY)

  return rows.map((r, i) => ({ kind: 'detail', indent: 2, line: [lab(i === 0 ? label : ''), { text: r }] }))
}

// The drawer: the subject, the whole goal, what waits on the person and what Claude is doing, `↻`
// flush right; then every chapter with the request, its result, its receipts and links, and under
// the latest everything left, the optional and what Claude did not check included.
export const drawerRows = (s: Shown, a: Activity, o: { width?: number; now: number }): Row[] => {
  const w = o.width
  const n = s.board.chapters.length
  if (n === 0) return (w === undefined ? [t().empty] : wrap(t().empty, w, 4)).map(x => ({ kind: 'goal', indent: 0, line: [{ text: x, color: 'inactive' }] }))
  const mine = mineOf(s)
  const head: Row[] = [
    titleRow(titleOf(s.board), w, { button: { id: REFRESH, text: '↻' } }),
    ...goalRows(s.board.goal, w, Number.POSITIVE_INFINITY),
    ...(mine.length === 0 ? [] : [row('heading', 0, [{ text: t().mineLine(mine.length), bold: true, color: WAIT_COLOR }, { text: mine.join(' · ') }], w)]),
    ...activityLines(s, a).map(l => row('activity', 0, l, w)),
    { kind: 'rule', indent: 0, line: [{ text: '┄'.repeat(w ?? 1), color: 'inactive' }] },
  ]
  const col = Math.max(cells(t().label.request), cells(t().label.result))
  const spin = spinOf(a, o.now)
  const body = s.board.chapters.flatMap((c, i): Row[] => [
    row('chapter', 0, chapterLine(s, i, spin, false), w),
    ...(c.request === '' ? [] : labelled(t().label.request, col, c.request, w)),
    ...(c.result === '' ? [] : labelled(t().label.result, col, c.result, w)),
    ...pieceRows(linkPieces(s.board, c), w === undefined ? undefined : w - 2, false).map(l => row('links', 2, l, w)),
    ...(i < n - 1 ? [] : groupsOf(s, ['mine', 'claude', 'others', 'optional', 'unverified']).flatMap(g => [row('heading', 2, g.heading, w), ...g.items.map(it => row('item', 2, it, w))])),
    ...(i < n - 1 ? [{ kind: 'blank' as const, indent: 0, line: [] }] : []),
  ])

  return [...head, ...body]
}

// What shows above the prompt: the note for a person coming back, when `away` and it leaves the band
// three rows (its title, goal and latest chapter), then the band in the rows left, at most BAND_ROWS of them.
export const bandStack = (s: Shown, a: Activity, o: BandOptions & { away: boolean }): Row[] => {
  const all = o.away ? awayRows(s, o.width) : []
  const note = all.length + 3 <= o.maxRows ? all : []

  return [...note, ...bandRows(s, a, { ...o, maxRows: Math.min(o.maxRows - note.length, BAND_ROWS) })]
}

// A row as the terminal shows it.
export const rowText = (r: Row): string => `${' '.repeat(r.indent)}${lineText(r.line)}`
