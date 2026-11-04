// The `/flow` drawer: the plan as a card flowchart. Stages are rounded boxes on one
// axis joined by `▼`; a parallel stage splits into boxes side by side and joins again.
// An open box lists its tasks, a `╭ 동시에` block for tasks that run together, and the
// checkpoints of every open task. Pure: register.tsx turns the lines into elements and
// each piece marked `button` into a Button that folds or unfolds that node.
import type { DrawerState } from '../types'
import type { Plan, PlanNode } from './plan'
import { childrenOf, currentLeaf, hasChildren, isFinished } from './plan'
import type { Line, Seg } from './tree'
import { GLYPH, duration, elapsed, fitLine, lineText, noteText, statusColor } from './tree'
import { cells, padRight } from './width'

export type { DrawerState }

export type FlowOptions = { width: number; accent: string; now: number }
// `cut` is true when some title did not fit its box: the drawer then draws the tree instead.
export type Flow = { lines: Line[]; buttons: string[]; cut: boolean }

const GAP = 5
const MIN_BOX = 21
const MIN_INNER = 6

// A node's units: its children, with a parallel group standing for its own children.
const units = (plan: Plan, id: string | null): PlanNode[] =>
  childrenOf(plan.nodes, id).flatMap(n => (n.parallel === true ? units(plan, n.id) : [n]))

const count = (plan: Plan, id: string | null): string => {
  const u = units(plan, id)

  return `${u.filter(n => isFinished(n.status)).length}/${u.length}`
}

// Open unless the person folded it: the nodes above the leaf Claude is on.
const defaultOpen = (plan: Plan): Set<string> => {
  const leaf = currentLeaf(plan)
  if (leaf === null) return new Set()
  const parts = leaf.id.split('.')

  return new Set(parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.')))
}

export const isOpen = (plan: Plan, drawer: DrawerState, id: string): boolean => drawer.open[id] ?? defaultOpen(plan).has(id)

export const toggleFold = (plan: Plan, drawer: DrawerState, id: string): DrawerState => ({
  ...drawer,
  open: { ...drawer.open, [id]: !isOpen(plan, drawer, id) },
})

type Ctx = { plan: Plan; drawer: DrawerState; accent: string; buttons: string[]; cut: boolean }

const right = (ctx: Ctx, n: PlanNode): Seg | null => {
  if (hasChildren(ctx.plan.nodes, n.id)) return { text: `${count(ctx.plan, n.id)} ${isOpen(ctx.plan, ctx.drawer, n.id) ? '▾' : '▸'}`, color: 'inactive' }
  if (n.status === 'completed' && n.startedAt !== undefined && n.doneAt !== undefined) return { text: duration(n.doneAt - n.startedAt), color: 'inactive' }
  if (n.status === 'in_progress') return { text: '진행 중', color: ctx.accent }

  return null
}

const titleSegs = (ctx: Ctx, n: PlanNode): Line => {
  const run = n.status === 'in_progress'
  const out: Line = [
    { text: GLYPH[n.status], color: statusColor(n.status, ctx.accent) },
    { text: ` ${n.title}`, color: run || n.status === 'completed' ? 'text' : 'inactive', bold: run, strike: n.status === 'skipped' },
  ]
  const note = noteText(n)
  if (note !== '') out.push({ text: note, color: n.status === 'blocked' ? 'error' : 'inactive' })

  return out
}

// Exactly `w` cells: the left cut to fit, the right flush right (dropped when there is no room).
const spread = (left: Line, r: Seg | null, w: number, ctx?: Ctx): Line => {
  if (w <= 0) return []
  const fitted = (room: number): Line => {
    const out = fitLine(left, room)
    if (ctx !== undefined && lineText(out) !== lineText(left)) ctx.cut = true
    return out
  }
  if (r === null || cells(r.text) + 4 > w) return pad(fitted(w), w)
  const cut = fitted(w - cells(r.text) - 1)

  return [...cut, { text: padRight('', w - cells(lineText(cut)) - cells(r.text)) }, r]
}

const pad = (line: Line, w: number): Line => {
  const c = cells(lineText(line))

  return c >= w ? line : [...line, { text: padRight('', w - c) }]
}

const press = (line: Line, id: string): Line => line.map(s => ({ ...s, button: id }))

// The rows inside an open box, `w` cells wide.
const inside = (ctx: Ctx, parentId: string, w: number, indent: string): Line[] => {
  const rows: Line[] = []
  for (const n of childrenOf(ctx.plan.nodes, parentId)) {
    if (n.parallel === true) {
      const border = { color: 'inactive' }
      const room = w - cells(indent)
      rows.push([{ text: indent }, { text: `╭ 동시에 ${'─'.repeat(Math.max(0, room - 9))}`, ...border }])
      for (const row of inside(ctx, n.id, room - 2, '')) rows.push([{ text: indent }, { text: '│ ', ...border }, ...row])
      rows.push([{ text: indent }, { text: `╰${'─'.repeat(Math.max(0, room - 1))}`, ...border }])
      continue
    }
    const parent = hasChildren(ctx.plan.nodes, n.id)
    const content = spread(titleSegs(ctx, n), right(ctx, n), w - cells(indent), ctx)
    if (parent) ctx.buttons.push(n.id)
    rows.push([{ text: indent }, ...(parent ? press(content, n.id) : content)])
    if (parent && isOpen(ctx.plan, ctx.drawer, n.id)) rows.push(...inside(ctx, n.id, w, `${indent}    `))
  }

  return rows
}

type Block = { lines: Line[]; width: number }

// Odd, so `┬` sits in the middle: rounded up to keep the title whole, down only at `max`.
const oddFit = (n: number, max: number): number => {
  const w = Math.min(n, max)

  return w % 2 === 1 ? w : w + 1 <= max ? w + 1 : w - 1
}

// One stage as a box; `tail` puts `┬` under its middle for what comes next.
const box = (ctx: Ctx, n: PlanNode, max: number, tail: boolean): Block => {
  const open = hasChildren(ctx.plan.nodes, n.id) && isOpen(ctx.plan, ctx.drawer, n.id)
  const r = right(ctx, n)
  const natural = cells(lineText(titleSegs(ctx, n))) + (r === null ? 0 : cells(r.text) + 1) + 4
  const width = oddFit(open ? Math.max(MIN_BOX, max - 8) : Math.max(MIN_BOX, natural), max)
  const inner = width - 4
  const edge = { color: n.status === 'in_progress' ? ctx.accent : 'inactive' }
  const wall = (row: Line): Line => [{ text: '│ ', ...edge }, ...pad(row, inner), { text: ' │', ...edge }]
  let head = spread(titleSegs(ctx, n), r, inner, ctx)
  if (hasChildren(ctx.plan.nodes, n.id)) {
    ctx.buttons.push(n.id)
    head = press(head, n.id)
  }
  const lines: Line[] = [[{ text: `╭${'─'.repeat(width - 2)}╮`, ...edge }], wall(head)]
  if (open) {
    lines.push(wall([{ text: '┄'.repeat(inner), color: 'inactive' }]))
    for (const row of inside(ctx, n.id, inner, '')) lines.push(wall(row))
  }
  const half = (width - 3) / 2
  lines.push([{ text: tail ? `╰${'─'.repeat(half)}┬${'─'.repeat(half)}╯` : `╰${'─'.repeat(width - 2)}╯`, ...edge }])

  return { lines, width }
}

// Pieces placed at columns, joined into one line.
const place = (parts: ReadonlyArray<{ x: number; line: Line }>): Line => {
  const out: Line = []
  let col = 0
  for (const { x, line } of [...parts].sort((a, b) => a.x - b.x)) {
    if (x < col) continue
    if (x > col) out.push({ text: padRight('', x - col) })
    out.push(...line)
    col = x + cells(lineText(line))
  }

  return out
}

// A split (`trunk` above, branches below) or a join (branches above, trunk below).
const connector = (trunk: number | null, branches: readonly number[], kind: 'split' | 'join'): Line => {
  const at = new Set(branches)
  const all = trunk === null ? [...branches] : [...branches, trunk]
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  if (lo === hi) return place([{ x: lo, line: [{ text: '│', color: 'inactive' }] }])
  let text = ''
  for (let x = lo; x <= hi; x++) {
    const up = kind === 'split' ? x === trunk : at.has(x)
    const down = kind === 'split' ? at.has(x) : x === trunk
    const glyphs = x === lo ? ['─', '╭', '╰', '├'] : x === hi ? ['─', '╮', '╯', '┤'] : ['─', '┬', '┴', '┼']
    text += glyphs[(down ? 1 : 0) + (up ? 2 : 0)]
  }

  return place([{ x: lo, line: [{ text, color: 'inactive' }] }])
}

const arrows = (xs: readonly number[]): Line => place(xs.map(x => ({ x, line: [{ text: '▼', color: 'inactive' }] })))

// Boxes side by side under a parallel stage, as many to a row as fit.
const branches = (ctx: Ctx, group: PlanNode, width: number, axis: number, first: boolean, last: boolean): Line[] => {
  const blocks = childrenOf(ctx.plan.nodes, group.id).map(n => box(ctx, n, width, true))
  const rows: Block[][] = []
  for (const b of blocks) {
    const row = rows[rows.length - 1]
    const used = row === undefined ? 0 : row.reduce((s, x) => s + x.width + GAP, 0)
    if (row !== undefined && used + b.width <= width) row.push(b)
    else rows.push([b])
  }
  const out: Line[] = []
  rows.forEach((row, i) => {
    const total = row.reduce((s, b) => s + b.width, 0) + GAP * (row.length - 1)
    let x = Math.max(0, axis - Math.floor((total - 1) / 2))
    const starts = row.map(b => {
      const at = x
      x += b.width + GAP
      return at
    })
    const mids = row.map((b, j) => (starts[j] ?? 0) + (b.width - 1) / 2)
    if (i === 0) out.push(connector(first ? null : axis, mids, 'split'))
    out.push(arrows(mids))
    const height = Math.max(...row.map(b => b.lines.length))
    for (let k = 0; k < height; k++) {
      // A shorter box goes on as a line down its middle.
      out.push(place(row.map((b, j) => (k < b.lines.length ? { x: starts[j] ?? 0, line: b.lines[k] ?? [] } : { x: mids[j] ?? 0, line: [{ text: '│', color: 'inactive' }] }))))
    }
    if (i === rows.length - 1) out.push(connector(last ? null : axis, mids, 'join'))
  })

  return out
}

export const drawFlow = (plan: Plan, drawer: DrawerState, { width, accent, now }: FlowOptions): Flow => {
  const ctx: Ctx = { plan, drawer, accent, buttons: [], cut: false }
  if (plan.nodes.length === 0 || width <= 0) return { lines: [], buttons: [], cut: false }
  const r = `${count(plan, null)} · ${duration(elapsed(plan, now))}`
  const head = spread([{ text: ` ${plan.title}`, bold: true, color: 'text' }], { text: r, color: 'inactive' }, width)
  // Too narrow for a box: the head alone.
  if (width < MIN_INNER + 4) return { lines: [head], buttons: [], cut: true }
  const lines: Line[] = [head, []]
  const axis = Math.floor((width - 1) / 2)
  const stages = childrenOf(plan.nodes, null)
  stages.forEach((n, i) => {
    const last = i === stages.length - 1
    if (n.parallel === true) {
      lines.push(...branches(ctx, n, width, axis, i === 0, last))
      if (!last && stages[i + 1]?.parallel !== true) lines.push(arrows([axis]))
      return
    }
    if (i > 0 && stages[i - 1]?.parallel !== true) lines.push(arrows([axis]))
    const b = box(ctx, n, width, !last)
    for (const l of b.lines) lines.push(place([{ x: axis - (b.width - 1) / 2, line: l }]))
  })

  return { lines: lines.map(l => fitLine(l, width)), buttons: ctx.buttons, cut: ctx.cut }
}
