// The plan tree above the prompt, as lines of coloured pieces. Pure: register.tsx
// turns the pieces into Text elements, tests read them back as plain text.
import type { Activity } from '../types'
import { activityLabel } from './activity'
import { fitRows, foldedParents } from './fit'
import type { Plan, PlanNode, PlanStatus } from './plan'
import { childrenOf, currentLeaf, finishedAt, hasChildren, leavesUnder, isFinished, progress, runningLeaves } from './plan'
import { cells, fit, padRight } from './width'

// `color` is a theme key or the accent setting; `button` is the node a press on the piece folds.
export type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean; strike?: boolean; button?: string }
export type Line = Seg[]

export const GLYPH: Record<PlanStatus, string> = { completed: '✓', in_progress: '●', pending: '○', blocked: '■', skipped: '–' }

export const statusColor = (s: PlanStatus, accent: string): string =>
  s === 'completed' ? 'success' : s === 'in_progress' ? accent : s === 'blocked' ? 'error' : 'inactive'

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
export const markSeg = (plan: Plan, id: string, accent: string): Seg[] => {
  const m = plan.marks?.[id]

  return m === undefined ? [] : [{ text: m === 'new' ? ' 새로' : ' ↺', color: accent }]
}

export const noteText = (n: PlanNode): string =>
  n.note === undefined ? '' : n.status === 'blocked' || n.status === 'skipped' ? ` (${n.status}: ${n.note})` : ` (${n.note})`

const isLastSibling = (plan: Plan, n: PlanNode): boolean => {
  const sibs = childrenOf(plan.nodes, n.parentId)

  return sibs[sibs.length - 1]?.id === n.id
}

const prefixOf = (plan: Plan, n: PlanNode): string => {
  let out = ''
  let up = n.parentId === null ? undefined : plan.nodes.find(p => p.id === n.parentId)
  while (up !== undefined) {
    out = (isLastSibling(plan, up) ? '   ' : '│  ') + out
    up = up.parentId === null ? undefined : plan.nodes.find(p => p.id === up?.parentId)
  }

  return out + (isLastSibling(plan, n) ? '└─ ' : '├─ ')
}

const nodeRow = (plan: Plan, n: PlanNode, width: number, accent: string, marked: Set<string>, folded: ReadonlySet<string>): Line => {
  const done = isFinished(n.status)
  const left: Line = [
    { text: prefixOf(plan, n), color: 'inactive' },
    { text: GLYPH[n.status], color: statusColor(n.status, accent) },
    { text: ` ${n.title}`, color: 'text', dim: done, strike: n.status === 'skipped', bold: marked.has(n.id) },
    ...markSeg(plan, n.id, accent),
  ]
  if (n.parallel === true) left.push({ text: ' ∥ 동시에', color: 'inactive' })
  const note = noteText(n)
  if (note !== '') left.push({ text: note, color: n.status === 'blocked' ? 'warning' : 'inactive' })
  if (marked.has(n.id)) return [...fitLine(left, width - 2), { text: ' ◂', color: accent }]
  const right = hasChildren(plan.nodes, n.id)
    ? counts(plan, n.id) + (folded.has(n.id) ? ' ▸' : '')
    : n.status === 'completed' && n.startedAt !== undefined && n.doneAt !== undefined ? duration(n.doneAt - n.startedAt) : ''
  if (right === '') return fitLine(left, width)
  const room = width - cells(right) - 1
  if (room < 8) return fitLine(left, width)
  const cut = fitLine(left, room)

  return [...cut, { text: padRight('', width - cells(lineText(cut)) - cells(right)) }, { text: right, color: 'inactive' }]
}

const head = (plan: Plan, activity: Activity, maxRows: number, width: number, accent: string, now: number, open?: string, parked = 0): Line[] => {
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
  const filled = total === 0 ? 0 : Math.round((bar * done) / total)
  const title: Line = [{ text: plan.title, bold: true, color: 'text' }]
  // The button that opens the drawer, flush right when the title leaves room.
  const button = open === undefined || cells(open) + 12 > width ? null : open
  const lines: Line[] = [
    button === null
      ? fitLine(title, width)
      : (() => {
          const cut = fitLine(title, width - cells(button) - 1)
          return [...cut, { text: padRight('', width - cells(lineText(cut)) - cells(button)) }, { text: button, color: accent, button: OPEN_BUTTON }]
        })(),
    fitLine([{ text: '━'.repeat(filled), color: accent }, { text: '─'.repeat(bar - filled), color: 'inactive' }, { text: label, color: 'text' }], width),
  ]
  const words = activityLabel(activity)
  if (words !== undefined) lines.push(fitLine([{ text: '● ', color: activity.phase === 'error' ? 'error' : accent }, { text: words, color: 'text' }], width))
  lines.push([])

  return lines
}

// The `button` id of the piece that opens the drawer.
export const OPEN_BUTTON = 'open-flow'

// `scroll` is the first tree row the person scrolled to; absent or null follows the current step.
// `open` labels a button on the title line that opens the drawer; `parked` counts the plans set aside.
export type TreeOptions = { maxRows: number; width: number; accent: string; now: number; scroll?: number | null; open?: string; parked?: number }
// `offset` is the first tree row shown, `maxOffset` the last one a scroll can reach.
export type TreeView = { lines: Line[]; offset: number; maxOffset: number }

export const layoutTree = (plan: Plan, activity: Activity, { maxRows, width, accent, now, scroll = null, open, parked = 0 }: TreeOptions): TreeView => {
  if (plan.nodes.length === 0 || maxRows <= 0 || width <= 0) return { lines: [], offset: 0, maxOffset: 0 }
  const top = head(plan, activity, maxRows, width, accent, now, open, parked)
  const marked = markedLeaves(plan)
  const rowsFor = (folded: ReadonlySet<string>) =>
    plan.nodes
      .filter(n => ![...folded].some(id => n.id.startsWith(`${id}.`)))
      .map(node => ({ node, line: nodeRow(plan, node, width, accent, marked, folded) }))
  const overflow = (hidden: readonly PlanNode[]): Line => {
    const fin = hidden.filter(n => n.status === 'completed').length
    const wait = hidden.filter(n => n.status === 'pending').length

    return fitLine([{ text: `+${hidden.length}개 더 · 완료 ${fin} · 대기 ${wait}`, color: 'inactive' }], width)
  }
  const budget = maxRows - top.length
  const body = rowsFor(foldedParents(plan))
  // Too few rows to scroll in: rows give way instead.
  if (body.length <= budget || budget < 3) return { lines: [...top, ...fitRows(plan, budget, rowsFor, overflow)], offset: 0, maxOffset: 0 }
  const room = budget - 1
  const maxOffset = body.length - room
  const at = body.findIndex(r => marked.has(r.node.id))
  const offset = Math.max(0, Math.min(maxOffset, scroll ?? (at < 0 ? 0 : at - Math.floor(room / 2))))
  const below = maxOffset - offset
  const hint = [offset > 0 ? `↑ ${offset}줄` : '', below > 0 ? `↓ ${below}줄` : ''].filter(t => t !== '').join(' · ')
  const lines = [...top, ...body.slice(offset, offset + room).map(r => r.line), fitLine([{ text: `${hint} · 스크롤로 더 보기`, color: 'inactive' }], width)]

  return { lines, offset, maxOffset }
}

export const drawTree = (plan: Plan, activity: Activity, options: TreeOptions): Line[] => layoutTree(plan, activity, options).lines

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
