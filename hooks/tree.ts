// The plan tree above the prompt, as lines of coloured pieces. Pure: register.tsx
// turns the pieces into Text elements, tests read them back as plain text.
import type { Activity } from '../types'
import { activityLabel } from './activity'
import { fitRows } from './fit'
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

const nodeRow = (plan: Plan, n: PlanNode, width: number, accent: string, marked: Set<string>): Line => {
  const done = isFinished(n.status)
  const left: Line = [
    { text: prefixOf(plan, n), color: 'inactive' },
    { text: GLYPH[n.status], color: statusColor(n.status, accent) },
    { text: ` ${n.id} ${n.title}`, color: 'text', dim: done, strike: n.status === 'skipped', bold: marked.has(n.id) },
  ]
  if (n.parallel === true) left.push({ text: ' ∥ parallel', color: 'inactive' })
  const note = noteText(n)
  if (note !== '') left.push({ text: note, color: n.status === 'blocked' ? 'warning' : 'inactive' })
  if (marked.has(n.id)) return [...fitLine(left, width - 2), { text: ' ◂', color: accent }]
  if (!hasChildren(plan.nodes, n.id)) return fitLine(left, width)
  const right = counts(plan, n.id)
  const room = width - cells(right) - 1
  if (room < 8) return fitLine(left, width)
  const cut = fitLine(left, room)

  return [...cut, { text: padRight('', width - cells(lineText(cut)) - cells(right)) }, { text: right, color: 'inactive' }]
}

const head = (plan: Plan, activity: Activity, maxRows: number, width: number, accent: string, now: number): Line[] => {
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
  const bar = Math.max(0, Math.min(24, width - cells(label)))
  const filled = total === 0 ? 0 : Math.round((bar * done) / total)
  const lines: Line[] = [
    fitLine([{ text: plan.title, bold: true, color: 'text' }], width),
    fitLine([{ text: '━'.repeat(filled), color: accent }, { text: '─'.repeat(bar - filled), color: 'inactive' }, { text: label, color: 'text' }], width),
  ]
  const words = activityLabel(activity)
  if (words !== undefined) lines.push(fitLine([{ text: '● ', color: activity.phase === 'error' ? 'error' : accent }, { text: words, color: 'text' }], width))
  lines.push([])

  return lines
}

export type TreeOptions = { maxRows: number; width: number; accent: string; now: number }

export const drawTree = (plan: Plan, activity: Activity, { maxRows, width, accent, now }: TreeOptions): Line[] => {
  if (plan.nodes.length === 0 || maxRows <= 0 || width <= 0) return []
  const top = head(plan, activity, maxRows, width, accent, now)
  const marked = markedLeaves(plan)
  const rowsFor = (folded: ReadonlySet<string>) =>
    plan.nodes
      .filter(n => ![...folded].some(id => n.id.startsWith(`${id}.`)))
      .map(node => ({ node, line: nodeRow(plan, node, width, accent, marked) }))
  const overflow = (hidden: readonly PlanNode[]): Line => {
    const fin = hidden.filter(n => n.status === 'completed').length
    const wait = hidden.filter(n => n.status === 'pending').length

    return fitLine([{ text: `+${hidden.length}개 더 · 완료 ${fin} · 대기 ${wait}`, color: 'inactive' }], width)
  }

  return [...top, ...fitRows(plan, maxRows - top.length, rowsFor, overflow)]
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
