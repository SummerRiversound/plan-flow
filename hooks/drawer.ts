// The `/flow` drawer: the plan as a card flowchart. Stages are rounded boxes on one
// axis joined by `▼`; a parallel stage splits into boxes side by side and joins again.
// An open box lists its tasks, a `╭ 동시에` block for tasks that run together, and the
// checkpoints of every open task. Pure: register.tsx turns the lines into elements and
// each piece marked `button` into a Button that folds or unfolds that node.
import type { DrawerState, Shelved } from '../types'
import type { Plan, PlanNode } from './plan'
import { checksOf, childrenOf, currentLeaf, hasChildren, isFinished, progress } from './plan'
import type { Line, Seg } from './tree'
import type { Activity } from '../types'
import { drawTree, duration, fitLine, isLive, liveSegs, glyphColor, glyphSeg, lineText, markSeg, noteText, planHead } from './tree'
import { cells, padRight, wrap } from './width'

export type { DrawerState }

// `live`: Claude is at work, so the running steps move.
export type FlowOptions = { width: number; now: number; live?: boolean }
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

// Open unless the person folded it: the nodes above the leaf Claude is on and above the
// steps waiting for the person to check; finished stages stay folded.
const defaultOpen = (plan: Plan): Set<string> => {
  const leaf = currentLeaf(plan)
  const ids = [...(leaf === null ? [] : [leaf.id]), ...checksOf(plan).map(n => n.id)]

  return new Set(ids.flatMap(id => {
    const parts = id.split('.')
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.'))
  }))
}

export const isOpen = (plan: Plan, drawer: DrawerState, id: string): boolean => drawer.open[id] ?? defaultOpen(plan).has(id)

export const toggleFold = (plan: Plan, drawer: DrawerState, id: string): DrawerState => ({
  ...drawer,
  open: { ...drawer.open, [id]: !isOpen(plan, drawer, id) },
})

// Every box with something inside, open or folded at once.
export const foldAll = (plan: Plan, drawer: DrawerState, open: boolean): DrawerState => ({
  ...drawer,
  open: Object.fromEntries(plan.nodes.filter(n => hasChildren(plan.nodes, n.id)).map(n => [n.id, open])),
})

// The drawer's own buttons, drawn as buttons (`[ 모두 펼치기 ]`) so they read as something to press.
export const EXPAND_ALL = 'expand-all'
export const COLLAPSE_ALL = 'collapse-all'
export const FOLLOW = 'follow'
export const VIEW = 'view'
export const BOXED: ReadonlySet<string> = new Set([EXPAND_ALL, COLLAPSE_ALL, FOLLOW, VIEW])
// Under a picked step: mark it checked, or start a message about it in the prompt box. Their
// brackets are drawn as text, so the box walls around them count the cells right.
export const CONFIRM = 'confirm'
export const ASK = 'ask'

// A press on a step's row picks it (again: lets it go); a box's row folds it as before.
export const pickStep = (drawer: DrawerState, id: string): DrawerState => ({ ...drawer, pick: drawer.pick === id ? undefined : id, focus: id })

// A row of buttons, `w` cells wide, while they fit; `chrome` is what the engine draws around each (`[ ` and ` ]`).
const buttonRow = (bs: ReadonlyArray<[string, string]>, w: number, lead = ' ', chrome = 4): Line =>
  bs.reduce<Line>((l, [id, text]) => (cells(lineText(l)) + (l.length === 0 ? cells(lead) : 2) + chrome + cells(text) > w ? l : [...l, { text: l.length === 0 ? lead : '  ' }, { text, color: 'text', bold: true, button: id }]), [])

// The buttons under the picked step: "확인했어요" only while it waits for the person's check.
const actionLines = (drawer: DrawerState, n: PlanNode, w: number, lead: string): Line[] =>
  drawer.pick !== n.id ? [] : [buttonRow([...(n.status === 'needs_check' ? [[CONFIRM, '[ 확인했어요 ]'] as [string, string]] : []), [ASK, '[ 질문 ]']], w, lead, 0)]

type Ctx = { plan: Plan; drawer: DrawerState; buttons: string[]; cut: boolean; live: boolean; now: number }

const right = (ctx: Ctx, n: PlanNode): Seg | null => {
  if (hasChildren(ctx.plan.nodes, n.id)) return { text: `${count(ctx.plan, n.id)} ${isOpen(ctx.plan, ctx.drawer, n.id) ? '▾' : '▸'}`, color: 'inactive' }
  if (n.status === 'completed' && n.startedAt !== undefined && n.doneAt !== undefined) return { text: duration(n.doneAt - n.startedAt), color: 'inactive' }
  if (n.status === 'in_progress') return { text: '진행 중', color: glyphColor(n) }

  return null
}

// The note, when asked for, comes last so a box may cut it without cutting the title.
const titleSegs = (ctx: Ctx, n: PlanNode, withNote = true): Line => {
  const run = n.status === 'in_progress'
  const out: Line = [
    ...(run && ctx.live && !hasChildren(ctx.plan.nodes, n.id)
      ? liveSegs(n.title, ctx.now)
      : [glyphSeg(n), { text: ` ${n.title}`, color: 'text', dim: isFinished(n.status) && n.status !== 'needs_check', bold: run, strike: n.status === 'skipped' }]),
    ...markSeg(ctx.plan, n.id),
  ]
  const note = withNote ? noteText(n) : ''
  if (note !== '') out.push({ text: note, color: n.status === 'blocked' ? 'error' : 'inactive' })
  // The row the drawer follows finds its step by this.
  if (out[0] !== undefined) out[0] = { ...out[0], node: n.id }

  return out
}

// Exactly `w` cells: the left cut to fit, the right flush right (dropped when there is no room).
// With `ctx`, a cut into the first `keep` cells of the left (all of it by default) marks the flow as cut.
const spread = (left: Line, r: Seg | null, w: number, ctx?: Ctx, keep = cells(lineText(left))): Line => {
  if (w <= 0) return []
  const fitted = (room: number): Line => {
    const out = fitLine(left, room)
    if (ctx !== undefined && room < keep && lineText(out) !== lineText(left)) ctx.cut = true
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

// A step's detail, `w` cells wide, while its box is open or it runs.
// A short name for a link: a PR, issue or commit by its number, an artifact as such,
// another URL by its host, a file by its name.
export const linkLabel = (link: string): string => {
  const gh = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues|commit)\/([^/?#]+)/.exec(link)
  if (gh !== null) return gh[1] === 'pull' ? `PR #${gh[2]}` : gh[1] === 'issues' ? `이슈 #${gh[2]}` : `커밋 ${(gh[2] ?? '').slice(0, 7)}`
  if (/^https?:\/\/claude\.ai\/(.*\/)?artifact\//.test(link)) return '아티팩트'
  const url = /^[a-z]+:\/\/(?:www\.)?([^/?#]+)/i.exec(link)
  if (url !== null) return url[1] ?? link

  return link.split('/').filter(p => p !== '').pop() ?? link
}

// Where a press on the link goes: URLs as they are, absolute paths as files; anything else stays plain.
const hrefOf = (link: string): string | undefined =>
  /^[a-z]+:\/\//i.test(link) ? link : link.startsWith('/') ? `file://${encodeURI(link)}` : undefined

// One row of links, `↗ PR #12  ↗ 아티팩트`, ending in `+N` for those that do not fit.
export const linkRow = (links: readonly string[], w: number): Line[] => {
  if (links.length === 0) return []
  const out: Line = [{ text: '  ' }]
  let used = 2
  for (let i = 0; i < links.length; i++) {
    const link = links[i] ?? ''
    const label = `↗ ${linkLabel(link)}`
    const gap = i === 0 ? 0 : 2
    const after = i === links.length - 1 ? 0 : cells(`  +${links.length - i - 1}`)
    if (used + gap + cells(label) + after > w) {
      out.push({ text: `${i === 0 ? '' : '  '}+${links.length - i}`, color: 'inactive' })
      break
    }
    if (gap > 0) out.push({ text: '  ' })
    out.push({ text: label, color: 'text', href: hrefOf(link) })
    used += gap + cells(label)
  }

  return [fitLine(out, w)]
}

// Under a step: its detail while it runs or is open, and its links wherever its row shows
// (a leaf always, a parent once open).
const detailLines = (ctx: Ctx, n: PlanNode, w: number): Line[] => {
  const parent = hasChildren(ctx.plan.nodes, n.id)
  const open = parent && isOpen(ctx.plan, ctx.drawer, n.id)
  const detail = n.detail === undefined || !(open || n.status === 'in_progress') ? [] : wrap(n.detail, w - 2, 2).map((t): Line => [{ text: `  ${t}`, color: 'inactive' }])

  return [...detail, ...(parent && !open ? [] : linkRow(n.links ?? [], w))]
}

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
    const content = spread(titleSegs(ctx, n), right(ctx, n), w - cells(indent), ctx, cells(lineText(titleSegs(ctx, n, false))))
    ctx.buttons.push(n.id)
    rows.push([{ text: indent }, ...press(content, n.id)])
    for (const d of detailLines(ctx, n, w - cells(indent))) rows.push([{ text: indent }, ...d])
    if (!parent) for (const a of actionLines(ctx.drawer, n, w - cells(indent), '  ')) rows.push([{ text: indent }, ...a])
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

// The cells a box needs for its whole title row.
const natural = (ctx: Ctx, n: PlanNode): number => {
  const r = right(ctx, n)

  return cells(lineText(titleSegs(ctx, n))) + (r === null ? 0 : cells(r.text) + 1) + 4
}

// One stage as a box `width` cells wide (odd); `tail` puts `┬` under its middle for what comes next.
const box = (ctx: Ctx, n: PlanNode, width: number, tail: boolean): Block => {
  const open = hasChildren(ctx.plan.nodes, n.id) && isOpen(ctx.plan, ctx.drawer, n.id)
  const r = right(ctx, n)
  const inner = width - 4
  const edge = { color: n.status === 'in_progress' ? glyphColor(n) : 'inactive' }
  const wall = (row: Line): Line => [{ text: '│ ', ...edge }, ...pad(row, inner), { text: ' │', ...edge }]
  const head = press(spread(titleSegs(ctx, n), r, inner, ctx, cells(lineText(titleSegs(ctx, n, false)))), n.id)
  ctx.buttons.push(n.id)
  const acts = hasChildren(ctx.plan.nodes, n.id) ? [] : actionLines(ctx.drawer, n, inner, '  ')
  const lines: Line[] = [[{ text: `╭${'─'.repeat(width - 2)}╮`, ...edge }], wall(head), ...detailLines(ctx, n, inner).map(wall), ...acts.map(wall)]
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

// Boxes side by side under a parallel stage, all one width: as many to a row as fit with
// every title whole, sharing the axis boxes' width evenly so the outer edges line up.
const branches = (ctx: Ctx, group: PlanNode, span: number, axis: number, first: boolean, last: boolean): Line[] => {
  const kids = childrenOf(ctx.plan.nodes, group.id)
  const need = Math.max(MIN_INNER + 4, ...kids.map(n => natural(ctx, n)))
  // Odd for the middle `┬`, rounded down so the row still fits.
  const share = (k: number): number => {
    const w = Math.floor((span - GAP * (k - 1)) / k)
    return k === 1 ? span : w % 2 === 1 ? w : w - 1
  }
  const per = [...Array(kids.length).keys()].map(i => kids.length - i).find(k => k === 1 || share(k) >= need) ?? 1
  const w = share(per)
  const blocks = kids.map(n => box(ctx, n, w, true))
  // What rounding to odd left over widens the gaps, so the row ends where the axis boxes do.
  const gap = per === 1 ? GAP : Math.floor((span - per * w) / (per - 1))
  const rows: Block[][] = []
  for (let i = 0; i < blocks.length; i += per) rows.push(blocks.slice(i, i + per))
  const out: Line[] = []
  rows.forEach((row, i) => {
    const total = row.reduce((s, b) => s + b.width, 0) + gap * (row.length - 1)
    let x = Math.max(0, axis - Math.floor((total - 1) / 2))
    const starts = row.map(b => {
      const at = x
      x += b.width + gap
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

export const drawFlow = (plan: Plan, drawer: DrawerState, { width, now, live = false }: FlowOptions): Flow => {
  const ctx: Ctx = { plan, drawer, buttons: [], cut: false, live, now }
  if (plan.nodes.length === 0 || width <= 0) return { lines: [], buttons: [], cut: false }
  // Too narrow for a box.
  if (width < MIN_INNER + 4) return { lines: [], buttons: [], cut: true }
  const lines: Line[] = []
  const axis = Math.floor((width - 1) / 2)
  const stages = childrenOf(plan.nodes, null)
  // Every box on the axis is as wide, open or folded, so the stages line up: the drawer less a
  // margin, or wider to keep the longest title whole.
  const span = oddFit(Math.max(MIN_BOX, width - 8, ...stages.filter(n => n.parallel !== true).map(n => natural(ctx, n))), width)
  stages.forEach((n, i) => {
    const last = i === stages.length - 1
    if (n.parallel === true) {
      lines.push(...branches(ctx, n, span, axis, i === 0, last))
      if (!last && stages[i + 1]?.parallel !== true) lines.push(arrows([axis]))
      return
    }
    if (i > 0 && stages[i - 1]?.parallel !== true) lines.push(arrows([axis]))
    const b = box(ctx, n, span, !last)
    for (const l of b.lines) lines.push(place([{ x: axis - (b.width - 1) / 2, line: l }]))
  })

  return { lines: lines.map(l => fitLine(l, width)), buttons: ctx.buttons, cut: ctx.cut }
}

// The plans set aside to come back to, under the flowchart.
export const shelfLines = (shelf: readonly Shelved[], width: number): Line[] => {
  const parked = shelf.filter(s => s.state === 'parked')
  if (parked.length === 0 || width <= 0) return []

  return [
    [],
    fitLine([{ text: ' 보관한 계획', bold: true, color: 'text' }], width),
    ...parked.map(s => {
      const { done, total } = progress(s.plan)
      return spread([{ text: ` ▸ ${s.plan.title}`, color: 'inactive' }], { text: `${done}/${total}`, color: 'inactive' }, width)
    }),
  ]
}

// What the drawer shows. `head` stays put: the plan's title, progress, steps to check and
// what Claude is doing, then the buttons that fold every box. `body` scrolls under it: the
// flowchart, or the tree with a hint when the boxes would cut titles, then the parked plans.
// `at` is the body row of the step Claude is on, for the drawer to follow.
export type DrawerView = { head: Line[]; body: Line[]; buttons: string[]; at: number | null }

const rule = (width: number): Line => [{ text: ` ${'┄'.repeat(Math.max(0, width - 2))}`, color: 'inactive' }]

export const drawerView = (plan: Plan, shelf: readonly Shelved[], drawer: DrawerState, activity: Activity, { width, now }: FlowOptions): DrawerView => {
  const shelved = shelfLines(shelf, width)
  if (plan.nodes.length === 0) return { head: [], body: [[{ text: '아직 계획이 없어요. Claude가 계획을 세우면 여기에 그려져요.', color: 'inactive' }], ...shelved], buttons: [], at: null }
  const parked = shelf.filter(s => s.state === 'parked').length
  const top = planHead(plan, activity, 6, width - 1, now, undefined, parked)
    .filter(l => l.length > 0)
    .map((l): Line => [{ text: ' ' }, ...l])
  const flow = drawFlow(plan, drawer, { width, now, live: isLive(activity) })
  // The head's button row: `right` (the view switch) flush with the rule's end, so it stays put
  // when the view changes; the others from the left, while they fit before it.
  const tools = (left: ReadonlyArray<[string, string]>, [id, text]: [string, string]): Line => {
    const r = 4 + cells(text)
    if (r + 1 > width - 1) return buttonRow([[id, text]], width)
    const l = buttonRow(left, width - 1 - r - 2)
    const used = cells(lineText(l)) + 4 * l.filter(s => s.button !== undefined).length

    return [...l, { text: padRight('', width - 1 - r - used) }, { text, color: 'text', bold: true, button: id }]
  }
  const leaf = currentLeaf(plan)
  // The step Claude is on, else the nearest row above it that shows.
  const ids = leaf === null ? [] : leaf.id.split('.').map((_, i, parts) => parts.slice(0, parts.length - i).join('.'))
  const find = (lines: Line[]) => ids.map(id => lines.findIndex(l => l.some(s => s.node === id))).find(i => i >= 0) ?? null
  // Too narrow for the boxes, or the person asked for the list: the tree.
  if (flow.cut || drawer.list === true) {
    // Each step's row picks it, with its buttons under it, as in the flowchart.
    const steps: string[] = []
    const tree = drawTree(plan, activity, { maxRows: plan.nodes.length + 6, width, now })
      .slice(top.length + 1)
      .flatMap((l): Line[] => {
        const n = plan.nodes.find(x => l[0]?.node === x.id)
        if (n === undefined || hasChildren(plan.nodes, n.id)) return [l]
        steps.push(n.id)
        return [press(l, n.id), ...actionLines(drawer, n, width, `${' '.repeat(cells(l[0]?.text ?? '') + 2)}`)]
      })
    const hint: Line[] = flow.cut ? [fitLine([{ text: ' 창을 넓히면 흐름도로 보여요', color: 'inactive' }], width), []] : [[]]
    const at = find(tree)
    const toggle = flow.cut ? [] : [tools([], [VIEW, '흐름도 보기'])]

    return { head: [...top, ...toggle, rule(width)], body: [...hint, ...tree, ...shelved], buttons: steps, at: at === null ? null : at + hint.length }
  }
  const row = tools(
    [
      [EXPAND_ALL, '모두 펼치기'],
      [COLLAPSE_ALL, '모두 접기'],
    ],
    [VIEW, '목록 보기'],
  )
  const at = find(flow.lines)

  return { head: [...top, row, rule(width)], body: [[], ...flow.lines, ...shelved], buttons: flow.buttons, at: at === null ? null : at + 1 }
}

// The rows the pane shows, `rows` tall. When the body runs past them it scrolls under the
// head, and a foot pins under it: following the step Claude is on (`top` undefined), or
// stopped where the person scrolled with a button back. Half a window of blank rows above
// and below the body lets the step Claude is on sit in the middle even near either end. One
// blank row past the pane keeps the engine sending the person's scrolls here, while its own
// window stays at the top.
export type Page = { lines: Line[]; top: number; max: number; pinned: boolean }

export const drawerPage = (v: DrawerView, rows: number, top: number | undefined, width: number): Page => {
  const all = [...v.head, ...v.body]
  const room = rows - v.head.length - 2
  if (all.length <= rows || room < 3) return { lines: all, top: 0, max: 0, pinned: false }
  const margin = Math.floor(room / 2)
  const blank = Array.from({ length: margin }, (): Line => [])
  const body = [...blank, ...v.body, ...blank]
  const max = body.length - room
  // Following: the step Claude is on in the middle; with none, the body's first row on top.
  const t = Math.max(0, Math.min(max, top ?? (v.at === null ? margin : v.at)))
  const foot: Line =
    top === undefined
      ? [{ text: v.at === null ? ' 휠로 스크롤해요' : ' 진행 중인 단계를 따라가는 중 · 휠로 둘러보면 멈춰요', color: 'inactive' }]
      : [{ text: ' 따라가기 멈춤   ', color: 'inactive' }, { text: '진행 중으로', color: 'text', bold: true, button: FOLLOW }]

  return { lines: [...v.head, ...body.slice(t, t + room), rule(width), fitLine(foot, width), []], top: t, max, pinned: true }
}
