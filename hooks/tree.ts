// The plan tree above the prompt, as lines of coloured pieces. Pure: register.tsx
// turns the pieces into Text elements, tests read them back as plain text.
import type { Activity } from '../types'
import { activityLabel } from './activity'
import { fitRows, foldedParents } from './fit'
import type { Plan, PlanNode, PlanStatus } from './plan'
import { checksOf, childrenOf, currentLeaf, hasChildren, hasOpenWork, leavesOf, leavesUnder, isFinished, progress, runningLeaves } from './plan'
import { cells, fit, padRight, wrap } from './width'
import { t } from './i18n'

// `color` is a theme key or a hex; `button` is the node a press on the piece folds; `href` makes the piece a link;
// `live` marks the running step's turning mark and swept title, which a surface that draws pictures animates itself.
export type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean; strike?: boolean; button?: string; href?: string; live?: 'mark' | 'title'; node?: string }
export type Line = Seg[]

// How long one frame of the running step's motion lasts.
export const FRAME_MS = 100
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

// Claude is at work (not waiting on the person, not between turns): only then does the running step move.
export const isLive = (a: Activity): boolean => a.phase === 'working' || a.phase === 'tool' || a.phase === 'compacting'

// The running step while Claude works: a turning mark, and a bright band three letters wide sweeping its title.
export const liveSegs = (title: string, now: number): Seg[] => {
  const tick = Math.floor(now / FRAME_MS)
  const chars = [...title]
  const at = (tick % (chars.length + 6)) - 3
  const out: Seg[] = [{ text: SPIN[tick % SPIN.length] ?? '●', color: 'text', bold: true, live: 'mark' }, { text: ' ', live: 'title' }]
  chars.forEach((ch, i) => {
    const color = Math.abs(i - at) <= 1 ? 'text' : 'inactive'
    const last = out[out.length - 1]
    if (last !== undefined && last.color === color) last.text += ch
    else out.push({ text: ch, color, bold: true, live: 'title' })
  })

  return out
}

export const GLYPH: Record<PlanStatus, string> = { completed: '✓', in_progress: '●', pending: '○', blocked: '■', skipped: '–', needs_check: '◐' }

// Three colours carry meaning: green for done, red for blocked, and the permission colour while
// Claude waits on the person. Everything else is plain text or muted.
export const WAIT_COLOR = 'permission'
export const glyphColor = (n: PlanNode, waiting = false): string =>
  n.status === 'completed' ? 'success' : n.status === 'blocked' ? 'error' : n.status === 'in_progress' ? (waiting ? WAIT_COLOR : 'text') : 'inactive'

// The glyph piece: finished steps dim, so the running one stands out.
export const glyphSeg = (n: PlanNode, waiting = false): Seg => ({ text: GLYPH[n.status], color: glyphColor(n, waiting) })

// Claude waits on the person: a question or a permission is open, or its turn ended with work still open.
export const isWaiting = (plan: Plan, a: Activity): boolean => a.phase === 'question' || a.phase === 'permission' || (a.phase === 'idle' && hasOpenWork(plan))

// The activity line's words: what Claude is doing, else that it waits for an answer.
export const activityWords = (plan: Plan, a: Activity): string | undefined => activityLabel(a) ?? (isWaiting(plan, a) ? t().activity.question : undefined)

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

export const counts = (plan: Plan, id: string): string => {
  const under = leavesUnder(plan.nodes, id)

  return `${under.filter(n => isFinished(n.status)).length}/${under.length}`
}

// The leaves marked as in hand: every running one, else the one up next.
export const markedLeaves = (plan: Plan): Set<string> => {
  const run = runningLeaves(plan)
  const cur = currentLeaf(plan)

  return new Set(run.length > 0 ? run.map(n => n.id) : cur === null ? [] : [cur.id])
}

// The mark a step carries while the request that changed it is the latest.
export const markSeg = (plan: Plan, id: string): Seg[] =>
  // A step just added carries no mark; a step reopened ends in a bold ↺.
  plan.marks?.[id] === 'redo' ? [{ text: ' ↺', color: 'text', bold: true }] : []

export const noteText = (n: PlanNode): string =>
  n.note === undefined ? '' : n.status === 'blocked' || n.status === 'skipped' ? ` (${n.status}: ${n.note})` : ` (${n.note})`

const isLastSibling = (plan: Plan, n: PlanNode): boolean => {
  const sibs = childrenOf(plan.nodes, n.parentId)

  return sibs[sibs.length - 1]?.id === n.id
}

// The guide lines a node's own row and everything under it start with.
const guidesOf = (plan: Plan, n: PlanNode): string => {
  let out = ''
  let up = n.parentId === null ? undefined : plan.nodes.find(p => p.id === n.parentId)
  while (up !== undefined) {
    out = (isLastSibling(plan, up) ? '   ' : '│  ') + out
    up = up.parentId === null ? undefined : plan.nodes.find(p => p.id === up?.parentId)
  }

  return out
}

const prefixOf = (plan: Plan, n: PlanNode): string => guidesOf(plan, n) + (isLastSibling(plan, n) ? '└─ ' : '├─ ')

// A running step's detail, under its title: two rows when it runs alone, one when others run too.
const detailRows = (plan: Plan, n: PlanNode, width: number, marked: Set<string>): Line[] => {
  if (n.detail === undefined || !marked.has(n.id) || n.status !== 'in_progress') return []
  const guide = `${guidesOf(plan, n)}${isLastSibling(plan, n) ? '   ' : '│  '}  `

  return wrap(n.detail, width - cells(guide), marked.size > 1 ? 1 : 2).map(t => [
    { text: guide, color: 'inactive' },
    { text: t, color: 'inactive' },
  ])
}

const nodeRow = (plan: Plan, n: PlanNode, width: number, marked: Set<string>, folded: ReadonlySet<string>, live: boolean, now: number, waiting = false): Line => {
  const done = isFinished(n.status) && n.status !== 'needs_check'
  const running = n.status === 'in_progress' && !hasChildren(plan.nodes, n.id)
  const left: Line = [
    { text: prefixOf(plan, n), color: 'inactive', node: n.id },
    ...(running && live
      ? liveSegs(n.title, now)
      : [glyphSeg(n, waiting), { text: ` ${n.title}`, color: 'text', dim: done, strike: n.status === 'skipped', bold: marked.has(n.id) }]),
    ...markSeg(plan, n.id),
  ]
  if (n.parallel === true) left.push({ text: ` ∥ ${t().parallel}`, color: 'inactive' })
  const note = noteText(n)
  if (note !== '') left.push({ text: note, color: n.status === 'blocked' ? 'warning' : 'inactive' })
  if (running) return fitLine(left, width)
  // The step up next while nothing runs.
  if (marked.has(n.id)) return [...fitLine(left, width - 2), { text: ' ◂', color: glyphColor(n) }]
  const right = hasChildren(plan.nodes, n.id) ? counts(plan, n.id) + (folded.has(n.id) ? ' ▸' : '') : ''
  if (right === '') return fitLine(left, width)
  const room = width - cells(right) - 1
  if (room < 8) return fitLine(left, width)
  const cut = fitLine(left, room)

  return [...cut, { text: padRight('', width - cells(lineText(cut)) - cells(right)) }, { text: right, color: 'inactive' }]
}

// The progress bar: one heavy line along its length, each half cell a stretch of leaves in
// plan order; done ones in green (white for those waiting on a check) over a dim track.
const strip = (plan: Plan, bar: number): Line => {
  const leaves = leavesOf(plan)
  const done = (j: number) => {
    const leaf = leaves[Math.floor((j * leaves.length) / (bar * 2))]
    return leaf !== undefined && isFinished(leaf.status) ? leaf : undefined
  }
  const fill = (leaf: PlanNode): string => (leaf.status === 'completed' ? 'success' : 'text')
  const out: Line = []
  for (let i = 0; i < bar; i++) {
    const a = done(i * 2)
    const b = done(i * 2 + 1)
    const seg: Seg =
      a !== undefined && b !== undefined
        ? { text: '━', color: fill(a) }
        : a !== undefined
          ? { text: '╸', color: fill(a) }
          : b !== undefined
            ? { text: '╺', color: fill(b) }
            : { text: '━', color: 'inactive', dim: true }
    const last = out[out.length - 1]
    if (last !== undefined && last.color === seg.color && last.dim === seg.dim && seg.text === '━' && last.text.endsWith('━')) last.text += seg.text
    else out.push(seg)
  }

  return out
}

// The steps waiting for the person to check, on one line: `◐ 확인할 것 2: 화면 (폰에서 눌러 보기) · API`.
export const checkLine = (plan: Plan, width: number, lead = ''): Line | null => {
  const checks = checksOf(plan)
  if (checks.length === 0) return null

  return fitLine([{ text: `${lead}${t().checks(checks.length)}`, color: 'text', bold: true }, { text: checks.map(n => `${n.title}${noteText(n)}`).join(' · '), color: 'text' }], width)
}

// The plan's goal under its title, dim, in at most `rows` rows.
export const goalLines = (plan: Plan, width: number, rows: number): Line[] =>
  plan.goal === undefined ? [] : wrap(plan.goal, width, rows).map((t): Line => [{ text: t, color: 'inactive' }])

// The title, goal, progress bar, steps to check and what Claude is doing; the band's top and the drawer's pinned head.
// `goalRows`: how many rows the goal may wrap to.
export const planHead = (plan: Plan, activity: Activity, maxRows: number, width: number, now: number, open?: string, parked = 0, folded?: boolean, notice?: string, goalRows = 1): Line[] => {
  const { done, total } = progress(plan)
  if (maxRows < 6) {
    const right = `${done}/${total}`
    const title = fit(plan.title, Math.max(0, width - cells(right) - 1))

    return [fitLine([{ text: title, bold: true }, { text: padRight('', width - cells(title) - cells(right)) }, { text: right, color: 'inactive' }], width)]
  }
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  let label = `  ${done}/${total} · ${pct}%`
  if (parked > 0 && cells(label) + 8 + 4 <= width) label += t().parked(parked)
  const bar = Math.max(0, Math.min(24, width - cells(label)))
  // Pressing the title folds or unfolds the band; its arrow says which way a press goes.
  const arrow = folded === true ? ' ▾' : ' ▴'
  const title = (w: number): Line =>
    folded === undefined
      ? fitLine([{ text: plan.title, bold: true, color: 'text' }], w)
      : [
          { text: fit(plan.title, Math.max(0, w - cells(arrow))), bold: true, color: 'text', button: FOLD_BUTTON },
          { text: arrow, color: 'inactive', button: FOLD_BUTTON },
        ]
  // The flowchart button flush right; a newer plan-flow before it gives way first when room runs short.
  const all: Array<{ text: string; id?: string }> = open === undefined ? [] : [{ text: open, id: OPEN_BUTTON }]
  // The title keeps ten cells.
  const tag: Array<{ text: string; id?: string }> = notice === undefined ? [] : [{ text: notice }]
  // The engine frames each button in `[ ` and ` ]`, four cells the text does not count.
  const frame = (bs: ReadonlyArray<{ id?: string }>) => bs.filter(b => b.id !== undefined).length * 4
  const room = (bs: ReadonlyArray<{ text: string; id?: string }>) => bs.reduce((n, b) => n + cells(b.text) + 2, 0) + frame(bs) + 10 <= width
  const picks = [[...tag, ...all], all]
  const chosen = picks.find(room) ?? []
  const right: Line = chosen.flatMap((b, i) => [
    ...(i === 0 ? [] : [{ text: '  ' }]),
    // A button's label takes the colour the surface gives its kind of button.
    b.id === undefined ? { text: b.text, color: 'text' } : { text: b.text, bold: true, button: b.id },
  ])
  const lines: Line[] = [
    right.length === 0
      ? title(width)
      : (() => {
          const used = cells(lineText(right)) + frame(chosen)
          const cut = title(width - used - 1)
          return [...cut, { text: padRight('', width - cells(lineText(cut)) - used) }, ...right]
        })(),
    ...goalLines(plan, width, goalRows),
    fitLine([...strip(plan, bar), { text: label, color: 'text' }], width),
  ]
  const words = activityWords(plan, activity)
  const run = runningLeaves(plan)[0]
  const waiting = isWaiting(plan, activity)
  const dot = activity.phase === 'error' ? 'error' : waiting ? WAIT_COLOR : run === undefined ? 'text' : glyphColor(run)
  const checks = checkLine(plan, width)
  if (checks !== null) lines.push(checks)
  if (words !== undefined) lines.push(fitLine([{ text: '● ', color: dot }, { text: words, color: waiting ? WAIT_COLOR : 'text' }], width))
  lines.push([])

  return lines
}

// The most rows the tree takes above the prompt; past that it shows a window around the current step.
export const BAND_ROWS = 10

// The `button` id of the piece that opens the drawer.
export const OPEN_BUTTON = 'open-flow'
// The `button` id of the piece that folds the band to its title and progress lines, and back.
export const FOLD_BUTTON = 'fold-band'

// `open` labels a button on the title line that opens the drawer; `parked` counts the plans set aside.
// `folded` shows the fold button, and when true draws only the title and progress lines.
// `notice` says a newer plan-flow is installed or out, on the title line.
export type TreeOptions = { maxRows: number; width: number; now: number; open?: string; parked?: number; folded?: boolean; notice?: string }
// The tree's rows under the head, in `budget` rows: each a step, a running step's detail, or a
// line counting the steps left out. Each keeps its drawn line and what it stands for, so a
// surface with its own type can draw the same rows its own way.
export type BandRow =
  | { kind: 'step'; node: PlanNode; folded: boolean; line: Line }
  | { kind: 'detail'; node: PlanNode; text: string; line: Line }
  | { kind: 'more'; text: string; line: Line }
  | { kind: 'expected'; text: string; line: Line }

// Work expected after the plan, hanging dotted and dim under its last row, in the most rows it
// may take: a lone `┆` then one row each, else one row each, else all in one row. `text` is
// what the row names, '' on the lone row.
export const expectedRows = (plan: Plan, width: number, rows = Infinity): BandRow[] => {
  const titles = plan.expected ?? []
  if (titles.length === 0 || rows < 1) return []
  const faint = { color: 'inactive', dim: true }
  const row = (text: string): BandRow => ({ kind: 'expected', text, line: fitLine([{ text: '   ┆ ', ...faint }, { text: `◌ ${text}`, ...faint }], width) })
  const each = titles.map(row)
  if (rows > titles.length) return [{ kind: 'expected', text: '', line: [{ text: '   ┆', ...faint }] }, ...each]

  return rows === titles.length ? each : [row(titles.join(' · '))]
}

// The steps first: expected work takes the rows left once the end of the plan shows.
export const bandRows = (plan: Plan, activity: Activity, budget: number, width: number, now: number): BandRow[] => {
  const all = stepRows(plan, activity, budget, width, now)
  for (const room of [Infinity, (plan.expected ?? []).length, 1]) {
    const tail = expectedRows(plan, width, room)
    if (tail.length === 0 || budget - tail.length < 1) continue
    const steps = stepRows(plan, activity, budget - tail.length, width, now)
    if (steps.end) return [...steps.rows, ...tail]
  }

  return all.rows
}

// The steps' rows in `budget` rows, and whether they reach the end of the plan.
const stepRows = (plan: Plan, activity: Activity, budget: number, width: number, now: number): { rows: BandRow[]; end: boolean } => {
  const marked = markedLeaves(plan)
  const rowsFor = (folded: ReadonlySet<string>) =>
    plan.nodes
      .filter(n => ![...folded].some(id => n.id.startsWith(`${id}.`)))
      .flatMap((node): Array<{ node: PlanNode; line: BandRow }> => [
        { node, line: { kind: 'step', node, folded: folded.has(node.id), line: nodeRow(plan, node, width, marked, folded, isLive(activity), now, isWaiting(plan, activity)) } },
        ...detailRows(plan, node, width, marked).map(line => ({ node, line: { kind: 'detail' as const, node, text: line[1]?.text ?? '', line } })),
      ])
  const overflow = (hidden: readonly PlanNode[]): BandRow => {
    const fin = hidden.filter(n => n.status === 'completed').length
    const wait = hidden.filter(n => n.status === 'pending').length
    const text = t().more(hidden.length, fin, wait)

    return { kind: 'more', text, line: fitLine([{ text, color: 'inactive' }], width) }
  }
  const body = rowsFor(foldedParents(plan))
  // Too few rows for a window: rows give way instead.
  if (body.length <= budget || budget < 3) return { rows: fitRows(plan, budget, rowsFor, overflow), end: body.length <= budget }
  // A window around the current step; the drawer has the rest.
  const at = body.findIndex(r => marked.has(r.node.id))
  const offset = Math.max(0, Math.min(body.length - budget, at < 0 ? 0 : at - Math.floor(budget / 2)))

  return { rows: body.slice(offset, offset + budget).map(r => r.line), end: offset + budget >= body.length }
}

export const drawTree = (plan: Plan, activity: Activity, { maxRows, width, now, open, parked = 0, folded, notice }: TreeOptions): Line[] => {
  if (plan.nodes.length === 0 || maxRows <= 0 || width <= 0) return []
  const top = planHead(plan, activity, maxRows, width, now, open, parked, folded, notice)
  if (folded === true) return top.slice(0, 2 + goalLines(plan, width, 1).length)

  return [...top, ...bandRows(plan, activity, maxRows - top.length, width, now).map(r => r.line)]
}
