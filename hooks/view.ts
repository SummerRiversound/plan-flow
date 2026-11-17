// The request-list board as rows: the band above the prompt, the note when the person comes back,
// and the drawer's timeline of chapters. Pure: register.tsx draws the rows, as characters on a
// terminal (given a `width`: rows are cut and wrapped to it) and in the app's own type elsewhere
// (no width: one row per text, the app wraps it). Both surfaces draw the same rows.
import type { Activity } from '../types'
import { activityLabel } from './activity'
import type { Board, Chapter, Kind, Receipt } from './chapters'
import { t } from './i18n'
import { cells, fit, padRight, wrap } from './width'

// `color` is a theme key, `bg` the theme key behind the piece; `button` the id a press on the piece
// reports; `href` makes it a link; `tag` marks a small label a surface with its own type draws as a
// tag; `live` marks the turning mark and the swept title, which a surface that draws pictures animates itself.
export type Seg = { text: string; color?: string; bg?: string; bold?: boolean; dim?: boolean; button?: string; href?: string; tag?: boolean; live?: 'mark' | 'title' }
export type Line = Seg[]
// What a row is, so a surface with its own type can set it: a heading, a footnote, a row of links.
export type RowKind = 'title' | 'goal' | 'rail' | 'chapter' | 'detail' | 'links' | 'heading' | 'item' | 'branch' | 'activity' | 'rule' | 'blank' | 'note'
// `indent` in cells, before the row's pieces. `edge`: the row's first piece is the line down its left
// (the drawer's timeline, the band's your-turn bar), which a surface with its own type draws as a line.
// `tint`: a faint fill behind the row.
export type Row = { kind: RowKind; indent: number; line: Line; edge?: true; tint?: true }
// The board with what the rules keep beside it: open dialog questions and background work.
export type Shown = { board: Board; asked: readonly string[]; running: number }

// The most rows the band takes above the prompt.
export const BAND_ROWS = 10
// How long one frame of the turning mark and the sweep lasts.
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
// The faint fill behind the drawer's current chapter on a terminal.
export const TINT = 'subtle'
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

const spinOf = (a: Activity, now: number): string | null => (isLive(a) ? (SPIN[Math.floor(now / FRAME_MS) % SPIN.length] ?? '●') : null)

// The session's state in one piece before the title: your turn with a count on the permission
// colour, working with the turning mark, done in green; nothing otherwise.
export const badgeOf = (s: Shown, a: Activity, now: number): Seg | undefined => {
  const mine = mineOf(s).length
  if (mine > 0) return { text: ` ${t().badge.mine(mine)} `, bg: WAIT_COLOR, color: 'inverseText', bold: true }
  const spin = spinOf(a, now)
  if (spin !== null) return { text: `${spin} ${t().badge.working}`, color: 'text', bold: true, live: 'mark' }
  if (last(s)?.done === true) return { text: `✓ ${t().badge.done}`, color: 'success' }

  return undefined
}

// A chapter's node on the rail and the timeline: turning while Claude works on the latest, green `●`
// done, `◐` when the latest waits on the person, else `○`.
const nodeOf = (s: Shown, i: number, spin: string | null): Seg => {
  const latest = i === s.board.chapters.length - 1
  if (latest && spin !== null) return { text: spin, color: 'text', bold: true, live: 'mark' }
  if (s.board.chapters[i]?.done === true) return { text: '●', color: 'success' }
  if (latest && mineOf(s).length > 0) return { text: '◐', color: WAIT_COLOR }

  return { text: '○', color: 'text' }
}

// A title while Claude works on it: muted letters with a bright band three letters wide sweeping across.
const sweep = (title: string, now: number): Seg[] => {
  const chars = [...title]
  const at = (Math.floor(now / FRAME_MS) % (chars.length + 6)) - 3
  const out: Seg[] = []
  chars.forEach((ch, i) => {
    const color = Math.abs(i - at) <= 1 ? 'text' : 'inactive'
    const prev = out[out.length - 1]
    if (prev !== undefined && prev.color === color) prev.text += ch
    else out.push({ text: ch, color, bold: true, live: 'title' })
  })

  return out
}

// The session's subject: the writer's title, else the first request's words.
export const titleOf = (b: Board): string => (b.title !== '' ? b.title : (b.chapters[0]?.title ?? ''))

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

// A row cut to the terminal's width, less its indent; untouched where the app sets its own type.
const row = (kind: RowKind, indent: number, line: Line, w: number | undefined): Row => ({ kind, indent, line: w === undefined ? line : fitLine(line, w - indent) })
const edged = (kind: RowKind, line: Line, w: number | undefined): Row => ({ ...row(kind, 0, line, w), edge: true })

// The badge, the title, then flush right a newer version's notice (given way first) and the band's or drawer's button.
const titleRow = (title: string, w: number | undefined, o: { fold?: boolean; folded?: boolean; button?: { id: string; text: string }; notice?: string; badge?: Seg }): Row => {
  const arrow = o.fold === true ? (o.folded === true ? ' ▾' : ' ▴') : ''
  const press = o.fold === true ? { button: FOLD_BUTTON } : {}
  const badge: Line = o.badge === undefined ? [] : [o.badge, { text: ' ' }]
  const lead = cells(lineText(badge))
  const head = (room: number): Line => [
    ...badge,
    { text: fit(title, Math.max(0, room - lead - cells(arrow))), bold: true, color: 'text', ...press },
    ...(arrow === '' ? [] : [{ text: arrow, color: 'inactive', ...press }]),
  ]
  const tag: Line = o.notice === undefined ? [] : [{ text: o.notice, color: 'text' }]
  const btn: Line = o.button === undefined ? [] : [{ text: o.button.text, bold: true, button: o.button.id }]
  if (w === undefined) return { kind: 'title', indent: 0, line: [...head(Number.POSITIVE_INFINITY), ...tag, ...btn] }
  // The engine frames a button in `[ ` and ` ]`, four cells its text does not count; the badge and title keep ten more.
  const size = (l: Line) => cells(lineText(l)) + (l.some(x => x.button !== undefined) ? 4 : 0)
  const both: Line = tag.length === 0 || btn.length === 0 ? [...tag, ...btn] : [...tag, { text: '  ' }, ...btn]
  const right = size(both) + lead + 10 <= w ? both : size(btn) + lead + 10 <= w ? btn : []
  if (right.length === 0) return { kind: 'title', indent: 0, line: fitLine(head(w), w) }
  const cut = head(w - size(right) - 1)

  return { kind: 'title', indent: 0, line: [...cut, { text: padRight('', w - cells(lineText(cut)) - size(right)) }, ...right] }
}

const goalRows = (goal: string, w: number | undefined, rows: number): Row[] =>
  goal === '' ? [] : (w === undefined ? [goal] : wrap(goal, w, rows)).map(g => ({ kind: 'goal', indent: 0, line: [{ text: g, color: 'inactive' }] }))

// The rail: the latest eight chapters as nodes joined by `━` (green up to the last done one), `…`
// before them when there are more; beside it the chapters' titles cut to fit, the current one bold.
const RAIL_NODES = 8
const RAIL_JOIN = 5
const MIN_NAME = 10
// A surface with its own type wraps the row itself; names stay this short there.
const APP_NAMES = 60
// The latest names that fit in `room` cells three apart, each cut no shorter than MIN_NAME; the oldest go first.
const fitNames = (names: readonly string[], room: number): string[] => {
  for (let m = names.length; m > 0; m--) {
    const keep = names.slice(-m)
    const avail = room - 3 * (m - 1)
    for (let c = Math.max(...keep.map(cells)); c >= MIN_NAME; c--) if (keep.reduce((n, k) => n + Math.min(cells(k), c), 0) <= avail) return keep.map(k => fit(k, c))
  }

  return []
}
const railRow = (s: Shown, spin: string | null, w: number | undefined): Row => {
  const cs = s.board.chapters
  const from = Math.max(0, cs.length - RAIL_NODES)
  const more: Line = from > 0 ? [{ text: '… ', color: 'inactive' }] : []
  const k = cs.length - from
  const width = (join: number) => cells(lineText(more)) + k + (k - 1) * join
  let join = RAIL_JOIN
  while (w !== undefined && join > 1 && width(join) + 3 + MIN_NAME > w) join--
  const nodes: Line = cs.slice(from).flatMap((c, j) => [...(j === 0 ? [] : [{ text: '━'.repeat(join), color: c.done ? 'success' : 'inactive' }]), nodeOf(s, from + j, spin)])
  const names = fitNames(
    cs.slice(from).map((c, j) => `${from + j + 1} ${c.title}`),
    (w ?? APP_NAMES + width(join) + 3) - width(join) - 3,
  )
  const named: Line = names.flatMap((x, j) => [...(j === 0 ? [{ text: '   ' }] : [{ text: ' · ', color: 'inactive' }]), j === names.length - 1 ? { text: x, bold: true, color: 'text' } : { text: x, color: 'inactive' }])

  return row('rail', 0, [...more, ...nodes, ...named], w)
}

// The current chapter: number and title in bold, swept while Claude works, then `→ result` muted.
const currentLine = (s: Shown, spin: string | null, now: number): Line => {
  const n = s.board.chapters.length
  const c = s.board.chapters[n - 1] as Chapter
  const title: Line = spin === null ? [{ text: `${n} ${c.title}`, bold: true, color: 'text' }] : [{ text: `${n} `, bold: true, color: 'text' }, ...sweep(c.title, now)]

  return [...title, ...(c.result === '' ? [] : [{ text: `  → ${c.result}`, color: 'inactive' }])]
}

export type BandOptions = { width?: number; maxRows: number; folded: boolean; now: number; notice?: string }

// The band above the prompt: the state badge, subject and goal, the rail of chapters, the current
// chapter with what came of it, its receipts and links and what Claude is doing, what waits on the
// person under a bar, and what Claude and others do next in one line each. Past `maxRows` the least
// needed rows go first: the rest of the goal, what others and Claude do, the links, the rail; the
// title, the current chapter and what waits on the person stay longest.
export const bandRows = (s: Shown, a: Activity, o: BandOptions): Row[] => {
  const w = o.width
  const out: Array<Row & { p: number }> = []
  const add = (p: number, r: Row) => out.push({ ...r, p })
  const badge = badgeOf(s, a, o.now)
  add(0, titleRow(titleOf(s.board), w, { fold: true, folded: o.folded, button: { id: OPEN_BUTTON, text: t().bandOpen }, ...(o.notice === undefined ? {} : { notice: o.notice }), ...(badge === undefined ? {} : { badge }) }))
  goalRows(s.board.goal, w, o.folded ? 1 : 3).forEach((r, i) => add(i === 0 ? 1 : 12, r))
  const latest = last(s)
  if (!o.folded && latest !== undefined) {
    const spin = spinOf(a, o.now)
    // One chapter alone needs no rail: the current chapter row says it all.
    if (s.board.chapters.length > 1) add(6, railRow(s, spin, w))
    add(2, row('chapter', 0, currentLine(s, spin, o.now), w))
    for (const l of pieceRows(linkPieces(s.board, latest), w === undefined ? undefined : w - 2, true)) add(7, row('links', 2, l, w))
    for (const l of activityLines(s, a)) add(3, row('activity', 2, l, w))
    const bar: Seg = { text: '▌', color: WAIT_COLOR }
    const mine = mineOf(s)
    if (mine.length > 0) add(4, edged('heading', [bar, { text: ' ' }, { text: t().tag.mine, bold: true, color: WAIT_COLOR }], w))
    // The first thing waiting goes with its heading; the rest stay longer than the rail.
    mine.forEach((m, k) => add(k === 0 ? 4 : 5, edged('item', [bar, { text: ' ' }, { text: '◐ ', color: WAIT_COLOR }, { text: m }], w)))
    for (const [kind, p] of [['claude', 8], ['others', 9]] as const) {
      const xs = leftOf(s, kind)
      if (xs.length > 0) add(p, row('item', 2, [{ text: `${t().folded[kind]}: ${xs[0]}${xs.length > 1 ? t().more(xs.length - 1) : ''}`, color: 'inactive' }], w))
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

// Wraps `text` under a label column after `lead`: the label on the first row, the text's later rows under its start.
const labelled = (lead: Line, label: string, col: number, text: string, w: number | undefined): Row[] => {
  const lab = (x: string): Seg => ({ text: padRight(x, col + 2), color: 'inactive' })
  if (w === undefined) return [edged('detail', [...lead, lab(label), { text }], w)]
  const rows = wrap(text, Math.max(1, w - cells(lineText(lead)) - col - 2), Number.POSITIVE_INFINITY)

  return rows.map((r, i) => edged('detail', [...lead, lab(i === 0 ? label : ''), { text: r }], w))
}

// What is left under the current chapter, branching off the line, each tagged with whose it is:
// the person's on the permission colour, the rest muted.
const BRANCHED: readonly Kind[] = ['mine', 'claude', 'others', 'optional', 'unverified']
const branchRows = (s: Shown, color: string, w: number | undefined): Row[] => {
  const items = BRANCHED.flatMap(kind => (kind === 'mine' ? mineOf(s) : leftOf(s, kind)).map(text => ({ kind, text })))
  const col = Math.max(0, ...items.map(it => cells(t().tag[it.kind])))

  return items.map((it, j) => {
    const label = t().tag[it.kind]
    const tag: Seg = it.kind === 'mine' ? { text: ` ${label} `, bg: WAIT_COLOR, color: 'inverseText', bold: true, tag: true } : { text: ` ${label} `, color: 'inactive', tag: true }
    return edged('branch', [{ text: j === items.length - 1 ? '└─' : '├─', color }, tag, { text: padRight('', col - cells(label) + 1) }, { text: it.text }], w)
  })
}

// The drawer: the subject with `↻` flush right, the whole goal, what waits on the person and what
// Claude is doing; then every chapter as a dot on one line down the left, green under the done ones,
// with its request, result, receipts and links beside the line, and off the current chapter, tinted,
// everything left as branches.
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
  ]
  const col = Math.max(cells(t().label.request), cells(t().label.result))
  const spin = spinOf(a, o.now)
  const body = s.board.chapters.flatMap((c, i): Row[] => {
    const latest = i === n - 1
    const color = c.done ? 'success' : 'inactive'
    const branches = latest ? branchRows(s, color, w) : []
    // Below the last chapter the line runs on only to its branches.
    const lead: Line = [latest && branches.length === 0 ? { text: ' ' } : { text: '│', color }, { text: '    ' }]
    const title: Line = latest && spin !== null ? [{ text: `${i + 1} `, bold: true, color: 'text' }, ...sweep(c.title, o.now)] : [{ text: `${i + 1} ${c.title}`, bold: latest ? true : undefined, color: c.done && !latest ? 'inactive' : 'text' }]
    const mark = nodeOf(s, i, spin)

    return [
      latest ? tinted([mark, { text: '  ' }, ...title], w) : edged('chapter', [mark, { text: '  ' }, ...title], w),
      ...(c.request === '' ? [] : labelled(lead, t().label.request, col, c.request, w)),
      ...(c.result === '' ? [] : labelled(lead, t().label.result, col, c.result, w)),
      ...pieceRows(linkPieces(s.board, c), w === undefined ? undefined : w - 5, false).map(l => edged('links', [...lead, ...l], w)),
      ...branches,
      ...(latest ? [] : [{ kind: 'blank' as const, indent: 0, edge: true as const, line: [{ text: '│', color }] }]),
    ]
  })

  return [...head, ...body]
}

// The current chapter's row with a faint fill behind all but its mark; on a terminal the fill runs to the edge.
const tinted = (line: Line, w: number | undefined): Row => {
  if (w === undefined) return { kind: 'chapter', indent: 0, line, edge: true, tint: true }
  const cut = fitLine(line, w)
  const [mark, ...rest] = cut

  return { kind: 'chapter', indent: 0, edge: true, tint: true, line: [...(mark === undefined ? [] : [mark]), ...[...rest, { text: padRight('', w - cells(lineText(cut))) }].map(x => ({ ...x, bg: TINT }))] }
}

// What shows above the prompt: the note for a person coming back, when `away` and it leaves the band
// three rows (its title, goal and current chapter), then the band in the rows left, at most BAND_ROWS of them.
export const bandStack = (s: Shown, a: Activity, o: BandOptions & { away: boolean }): Row[] => {
  const all = o.away ? awayRows(s, o.width) : []
  const note = all.length + 3 <= o.maxRows ? all : []

  return [...note, ...bandRows(s, a, { ...o, maxRows: Math.min(o.maxRows - note.length, BAND_ROWS) })]
}

// A row as the terminal shows it.
export const rowText = (r: Row): string => `${' '.repeat(r.indent)}${lineText(r.line)}`
