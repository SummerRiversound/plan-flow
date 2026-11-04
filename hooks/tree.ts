// The plan tree above the prompt, as lines of coloured pieces. Pure: register.tsx
// turns the pieces into Text elements, tests read them back as plain text.
import type { Activity } from '../types'
import { activityLabel } from './activity'
import { fitRows, foldedParents } from './fit'
import type { Plan, PlanNode, PlanStatus } from './plan'
import { childrenOf, currentLeaf, finishedAt, hasChildren, leavesOf, leavesUnder, isFinished, progress, runningLeaves } from './plan'
import { cells, fit, padRight, wrap } from './width'

// `color` is a theme key or a hex; `button` is the node a press on the piece folds; `href` makes the piece a link.
export type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean; strike?: boolean; button?: string; href?: string }
export type Line = Seg[]

export const GLYPH: Record<PlanStatus, string> = { completed: '✓', in_progress: '●', pending: '○', blocked: '■', skipped: '–' }

// Only two colours carry meaning: green for done, red for blocked. Everything else is plain text or muted.
export const glyphColor = (n: PlanNode): string =>
  n.status === 'completed' ? 'success' : n.status === 'blocked' ? 'error' : n.status === 'in_progress' ? 'text' : 'inactive'

// The glyph piece: finished steps dim, so the running one stands out.
export const glyphSeg = (n: PlanNode): Seg => ({ text: GLYPH[n.status], color: glyphColor(n), dim: n.status === 'completed' })

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

const pad2 = (n: number): string => String(n).padStart(2, '0')

export const duration = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}초`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}분 ${pad2(s % 60)}초`

  return `${Math.floor(m / 60)}시간 ${pad2(m % 60)}분`
}

export const elapsed = (plan: Plan, now: number): number => (finishedAt(plan) ?? now) - plan.startedAt

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
export const markSeg = (plan: Plan, id: string): Seg[] => {
  const m = plan.marks?.[id]

  return m === undefined ? [] : [{ text: m === 'new' ? ' 새로' : ' ↺', color: 'text', bold: true }]
}

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

const nodeRow = (plan: Plan, n: PlanNode, width: number, marked: Set<string>, folded: ReadonlySet<string>): Line => {
  const done = isFinished(n.status)
  const left: Line = [
    { text: prefixOf(plan, n), color: 'inactive' },
    glyphSeg(n),
    { text: ` ${n.title}`, color: 'text', dim: done, strike: n.status === 'skipped', bold: marked.has(n.id) },
    ...markSeg(plan, n.id),
  ]
  if (n.parallel === true) left.push({ text: ' ∥ 동시에', color: 'inactive' })
  const note = noteText(n)
  if (note !== '') left.push({ text: note, color: n.status === 'blocked' ? 'warning' : 'inactive' })
  if (marked.has(n.id)) return [...fitLine(left, width - 2), { text: ' ◂', color: glyphColor(n) }]
  const right = hasChildren(plan.nodes, n.id)
    ? counts(plan, n.id) + (folded.has(n.id) ? ' ▸' : '')
    : n.status === 'completed' && n.startedAt !== undefined && n.doneAt !== undefined ? duration(n.doneAt - n.startedAt) : ''
  if (right === '') return fitLine(left, width)
  const room = width - cells(right) - 1
  if (room < 8) return fitLine(left, width)
  const cut = fitLine(left, room)

  return [...cut, { text: padRight('', width - cells(lineText(cut)) - cells(right)) }, { text: right, color: 'inactive' }]
}

// The progress bar: a cell per stretch of leaves in plan order, green once done.
const strip = (plan: Plan, bar: number): Line => {
  const leaves = leavesOf(plan)
  const out: Line = []
  for (let i = 0; i < bar; i++) {
    const leaf = leaves[Math.floor((i * leaves.length) / bar)]
    const seg: Seg = leaf !== undefined && isFinished(leaf.status) ? { text: '━', color: glyphColor(leaf) } : { text: '─', color: 'inactive' }
    const last = out[out.length - 1]
    if (last !== undefined && last.color === seg.color && last.text[0] === seg.text) last.text += seg.text
    else out.push(seg)
  }

  return out
}

const head = (plan: Plan, activity: Activity, maxRows: number, width: number, now: number, open?: string, parked = 0, folded?: boolean): Line[] => {
  const { done, total } = progress(plan)
  if (maxRows < 6) {
    const right = `${done}/${total}`
    const title = fit(plan.title, Math.max(0, width - cells(right) - 1))

    return [fitLine([{ text: title, bold: true }, { text: padRight('', width - cells(title) - cells(right)) }, { text: right, color: 'inactive' }], width)]
  }
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  let label = `  ${done}/${total} · ${pct}%`
  const time = ` · ${duration(elapsed(plan, now))}`
  if (cells(label) + cells(time) + 4 <= width) label += time
  if (parked > 0 && cells(label) + 8 + 4 <= width) label += ` · 보관 ${parked}`
  const bar = Math.max(0, Math.min(24, width - cells(label)))
  const title: Line = [{ text: plan.title, bold: true, color: 'text' }]
  // Buttons flush right on the title line: fold, then open the drawer; the open button goes first when room runs short.
  const all = [
    ...(folded === undefined ? [] : [{ text: folded ? '펼치기 ▾' : '접기 ▴', id: FOLD_BUTTON }]),
    ...(open === undefined ? [] : [{ text: open, id: OPEN_BUTTON }]),
  ]
  const room = (bs: typeof all) => bs.reduce((n, b) => n + cells(b.text) + 2, 0) + 10 <= width
  const buttons = room(all) ? all : room(all.slice(0, 1)) ? all.slice(0, 1) : []
  const right: Line = buttons.flatMap((b, i) => [...(i === 0 ? [] : [{ text: '  ' }]), { text: b.text, color: 'text', bold: true, button: b.id }])
  const lines: Line[] = [
    right.length === 0
      ? fitLine(title, width)
      : (() => {
          const cut = fitLine(title, width - cells(lineText(right)) - 1)
          return [...cut, { text: padRight('', width - cells(lineText(cut)) - cells(lineText(right))) }, ...right]
        })(),
    fitLine([...strip(plan, bar), { text: label, color: 'text' }], width),
  ]
  const words = activityLabel(activity)
  const run = runningLeaves(plan)[0]
  const dot = activity.phase === 'error' ? 'error' : run === undefined ? 'text' : glyphColor(run)
  if (words !== undefined) lines.push(fitLine([{ text: '● ', color: dot }, { text: words, color: 'text' }], width))
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
export type TreeOptions = { maxRows: number; width: number; now: number; open?: string; parked?: number; folded?: boolean }
export const drawTree = (plan: Plan, activity: Activity, { maxRows, width, now, open, parked = 0, folded }: TreeOptions): Line[] => {
  if (plan.nodes.length === 0 || maxRows <= 0 || width <= 0) return []
  const top = head(plan, activity, maxRows, width, now, open, parked, folded)
  if (folded === true) return top.slice(0, 2)
  const marked = markedLeaves(plan)
  const rowsFor = (folded: ReadonlySet<string>) =>
    plan.nodes
      .filter(n => ![...folded].some(id => n.id.startsWith(`${id}.`)))
      .flatMap(node => [nodeRow(plan, node, width, marked, folded), ...detailRows(plan, node, width, marked)].map(line => ({ node, line })))
  const overflow = (hidden: readonly PlanNode[]): Line => {
    const fin = hidden.filter(n => n.status === 'completed').length
    const wait = hidden.filter(n => n.status === 'pending').length

    return fitLine([{ text: `+${hidden.length}개 더 · 완료 ${fin} · 대기 ${wait}`, color: 'inactive' }], width)
  }
  const budget = maxRows - top.length
  const body = rowsFor(foldedParents(plan))
  // Too few rows for a window: rows give way instead.
  if (body.length <= budget || budget < 3) return [...top, ...fitRows(plan, budget, rowsFor, overflow)]
  const room = budget - 1
  const maxOffset = body.length - room
  const at = body.findIndex(r => marked.has(r.node.id))
  const offset = Math.max(0, Math.min(maxOffset, at < 0 ? 0 : at - Math.floor(room / 2)))
  const below = maxOffset - offset
  const hint = [offset > 0 ? `위 ${offset}줄` : '', below > 0 ? `아래 ${below}줄` : '', '전체는 흐름도에서'].filter(t => t !== '').join(' · ')

  return [...top, ...body.slice(offset, offset + room).map(r => r.line), fitLine([{ text: hint, color: 'inactive' }], width)]
}

// One line for the status bar: progress, the step in hand, what Claude is doing.
export const statusLine = (plan: Plan, activity: Activity): string | undefined => {
  const words = activityLabel(activity)
  if (plan.nodes.length === 0) return words
  const { done, total } = progress(plan)
  const parts = [`계획 ${done}/${total}`]
  const run = runningLeaves(plan)
  const first = run[0]
  if (first !== undefined) parts.push(`${first.title}${run.length > 1 ? ` 외 ${run.length - 1}개` : ''} 진행 중`)
  if (words !== undefined) parts.push(words)

  return parts.join(' · ')
}
