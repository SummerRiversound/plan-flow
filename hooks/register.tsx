// Wiring only: hook events in, the pure modules beside this file decide, state out.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { DrawerState, Shelved } from '../types'
import type { ActivityEvent } from './activity'
import { idleActivity, step } from './activity'
import { drawerView, toggleFold } from './drawer'
import { PAUSE_NOTICE, decide, denyReason, onPlanWritten, onTurnStart } from './gate'
import type { Plan } from './plan'
import { clearMarks, currentLeaf, emptyPlan, finishedAt, hasOpenWork, runningLeaves } from './plan'
import { TOOL_DESCRIPTION, TOOL_NAME, TOOL_SCHEMA, boardNote, instruction, parseOp, runOp } from './plan-tool'
import type { DemoAt } from './scenarios'
import { DEMO_NEXT, DEMO_PREV, DEMO_STOP, SCENARIOS, demoFind, demoFrame, demoList, demoStep } from './scenarios'
import type { Line } from './tree'
import { BAND_ROWS, FOLD_BUTTON, OPEN_BUTTON, drawTree, fitLine, statusLine } from './tree'

const PLUGIN = 'plan-flow'
const TOOL = `mcp__${PLUGIN}__${TOOL_NAME}`
const PANE = 'plan-flow'
const HIDE_AFTER_MS = 5000
const KEPT_SESSIONS = 20

const planAtom = atom({ plugin: 'plan-flow', key: 'plan' } as const, emptyPlan())
const activityAtom = atom({ plugin: 'plan-flow', key: 'activity' } as const, idleActivity())
const shelfAtom = atom({ plugin: 'plan-flow', key: 'shelf' } as const, [] as Shelved[])
const gateAtom = atom({ plugin: 'plan-flow', key: 'gate' } as const, { planned: false, denies: 0 })
const drawerAtom = atom({ plugin: 'plan-flow', key: 'drawer' } as const, { open: {}, focus: null } as DrawerState)
const askedAtom = atom({ plugin: 'plan-flow', key: 'asked' } as const, false)
const demoAtom = atom({ plugin: 'plan-flow', key: 'demo' } as const, null as DemoAt | null)
const paneAtom = atom({ plugin: 'plan-flow', key: 'pane' } as const, false)
const foldAtom = atom({ plugin: 'plan-flow', key: 'fold' } as const, false)

type $ = EngineInterface
type Saved = Record<string, { plan: Plan; shelf?: Shelved[]; savedAt: number }>

// Draws one line of pieces; the pieces marked with a node id become that node's fold Button.
const row = ($: $, e: Parameters<$['ui']['resolve']>[0], line: Line, focus: string | null, onPress: (id: string) => void) => {
  const { Box, Text, Button, Link } = $.ui.resolve(e)
  const text = (s: Line[number]) => (
    <Text color={s.color} bold={s.bold === true ? true : undefined} dimColor={s.dim === true ? true : undefined} strikethrough={s.strike === true ? true : undefined}>
      {s.href === undefined ? s.text : <Link href={s.href}>{s.text}</Link>}
    </Text>
  )
  const parts: Array<{ id?: string; segs: Line }> = []
  for (const s of line) {
    const last = parts[parts.length - 1]
    if (last !== undefined && last.id === s.button) last.segs.push(s)
    else parts.push({ id: s.button, segs: [s] })
  }
  if (parts.length === 0) return <Text> </Text>

  return (
    <Box flexDirection="row">
      {parts.map(p =>
        p.id === undefined ? (
          p.segs.map(text)
        ) : (
          <Button key={p.id} plain autoFocus={p.id === focus ? true : undefined} onPress={() => onPress(p.id ?? '')}>
            {p.segs.map(text)}
          </Button>
        ),
      )}
    </Box>
  )
}

async function shown($: $, autoShow: boolean): Promise<boolean> {
  return autoShow || (await read($, askedAtom))
}

// The tree and the status line step aside a while after the last step is done.
async function hidden($: $, plan: Plan, autoShow: boolean): Promise<boolean> {
  const done = finishedAt(plan)

  return plan.nodes.length === 0 || !(await shown($, autoShow)) || (done !== null && (await $.clock.now()) - done >= HIDE_AFTER_MS)
}

async function refresh($: $, autoShow: boolean): Promise<void> {
  const plan = await read($, planAtom)
  const activity = await read($, activityAtom)
  $.ui.status((await hidden($, plan, autoShow)) ? undefined : statusLine(plan, activity))
}

async function act($: $, ev: ActivityEvent, autoShow: boolean): Promise<void> {
  await update($, activityAtom, a => step(a, ev))
  await refresh($, autoShow)
}

let ticker: Timer | null = null

// Elapsed times redraw each second, only while a turn runs on an open plan.
async function tick($: $, running: boolean): Promise<void> {
  const want = running && hasOpenWork(await read($, planAtom))
  if (want && ticker === null) ticker = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  if (!want && ticker !== null) {
    ticker.cancel()
    ticker = null
  }
}

// One board per session, the most recent sessions kept.
async function save($: $, plan: Plan, shelf: Shelved[]): Promise<void> {
  const sid = await $.session.id()
  const saved = ((await $.store.get('plans')) ?? {}) as Saved
  saved[sid] = { plan, shelf, savedAt: await $.clock.now() }
  const kept = Object.entries(saved)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, KEPT_SESSIONS)
  await $.store.set('plans', Object.fromEntries(kept))
}

// Opens the drawer; the band steps aside while it is on screen.
async function openDrawer($: $): Promise<boolean> {
  await update($, askedAtom, () => true)
  const opened = await $.ui.open({ id: PANE, title: '흐름도', focus: true, closeOnEscape: true })
  await update($, paneAtom, () => true)

  return opened.isPlaced
}

// `/flow demo [scenario|next|prev|stop]`: canned boards in the real views; the board itself is untouched.
async function demo($: $, arg: string | undefined): Promise<string> {
  const at = await read($, demoAtom)
  const to: DemoAt | null =
    arg === 'stop'
      ? null
      : arg === 'next' || arg === 'prev'
        ? demoStep(at ?? { scenario: 0, frame: -1 }, arg === 'next' ? 1 : -1)
        : arg === undefined
          ? { scenario: 0, frame: 0 }
          : (() => {
              const i = demoFind(arg)
              return i === undefined ? at : { scenario: i, frame: 0 }
            })()
  if (arg !== undefined && !['stop', 'next', 'prev'].includes(arg) && demoFind(arg) === undefined) return `그런 시연이 없어요. 고를 수 있는 것:\n${demoList()}`
  await update($, demoAtom, () => to)
  await update($, drawerAtom, (): DrawerState => ({ open: {}, focus: null }))
  if (to === null) return '시연을 끝냈어요'
  const s = SCENARIOS[to.scenario]

  return `시연 ${to.scenario + 1}/${SCENARIOS.length}: ${s?.title ?? ''} — ${demoFrame(to)?.label ?? ''}\n/flow demo next 로 다음, /flow demo stop 으로 끝내요.\n${demoList()}`
}

export const register: Register = (on, options) => {
  const autoShow = options.autoShow !== false
  const enforce = options.enforce === true
  let offered = false

  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA, isDeferred: false })
    offered = true
    await $.command.register({ name: 'flow', description: '계획 흐름도를 열거나 닫아요', immediate: true })
    const saved = ((await $.store.get('plans')) ?? {}) as Saved
    const mine = saved[await $.session.id()]
    const plan = mine?.plan ?? emptyPlan()
    await update($, planAtom, () => plan)
    await update($, shelfAtom, () => mine?.shelf ?? [])
    await update($, activityAtom, () => idleActivity())
    await update($, gateAtom, () => onTurnStart(plan))
    await refresh($, autoShow)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.traits.includes('bare') || !e.tools.includes(TOOL)) return composed

    return { sections: [...composed.sections, { id: `${PLUGIN}:plan`, text: instruction(TOOL), scope: 'session' as const }] }
  })

  // Each request the person sends: last request's marks go, and the model gets the board.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true) return next(e)
    const plan = await read($, planAtom)
    if (plan.marks !== undefined) await update($, planAtom, clearMarks)
    const note = boardNote({ plan, shelf: await read($, shelfAtom) })

    return next(note === undefined ? e : { ...e, context: [...(e.context ?? []), note] })
  })

  // The plan tool itself.
  on('tool.call', { tool: 'mcp__plan-flow__plan' }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: 'The plan belongs to the main conversation; a subagent does not change it.' }
    const { tool: _tool, tool_use_id: _id, agentId: _agent, requestMeta: _meta, ...input } = e as Record<string, unknown>
    const parsed = parseOp(input)
    if ('error' in parsed) return { result: parsed.error }
    const before = await read($, planAtom)
    const shelf = await read($, shelfAtom)
    const ran = runOp({ plan: before, shelf }, parsed.op, await $.clock.now())
    if ('error' in ran) return { result: ran.error }
    if (ran.notice !== undefined) $.ui.toast(ran.notice)
    if (ran.board.shelf !== shelf) await update($, shelfAtom, () => ran.board.shelf)
    if (ran.board.plan !== before || ran.board.shelf !== shelf) {
      const plan = ran.board.plan
      await update($, planAtom, () => plan)
      await update($, gateAtom, onPlanWritten)
      // A step moved: the band follows it again.
          if (plan.title !== before.title) await update($, drawerAtom, (): DrawerState => ({ open: {}, focus: null }))
      await save($, plan, ran.board.shelf)
      await tick($, true)
      if (finishedAt(plan) !== null) {
        $.clock.after(HIDE_AFTER_MS + 100, () => {
          $.ui.invalidate('ui.render')
          void refresh($, autoShow)
        })
      }
      await refresh($, autoShow)
    }

    return { result: ran.text }
  })

  // Every other tool: the optional gate, then the activity line.
  on('tool.call', async ($, e, next) => {
    if (e.tool === TOOL) return next(e)
    const verdict = decide({ tool: e.tool, agentId: e.agentId, enforce, toolOffered: offered, gate: await read($, gateAtom) })
    if (verdict.verdict !== 'allow') await update($, gateAtom, () => verdict.gate)
    if (verdict.verdict === 'deny') return { deny: denyReason(TOOL) }
    if (verdict.verdict === 'pause') $.ui.toast(PAUSE_NOTICE)
    if (e.agentId !== undefined) return next(e)
    const question = e.tool === 'AskUserQuestion'
    await act($, question ? { type: 'questionOpen' } : { type: 'toolStart', id: e.tool_use_id, tool: e.tool }, autoShow)
    try {
      return await next(e)
    } finally {
      await act($, question ? { type: 'questionClose' } : { type: 'toolEnd', id: e.tool_use_id }, autoShow)
      await act($, { type: 'permissionEnd' }, autoShow)
    }
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.agent_id === undefined) await act($, { type: 'permissionAsk', tool: e.tool_name }, autoShow)

    return next(e)
  })
  on('classic.PreCompact', async ($, e, next) => (await act($, { type: 'compactStart' }, autoShow), next(e)))
  on('classic.PostCompact', async ($, e, next) => (await act($, { type: 'compactEnd' }, autoShow), next(e)))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const plan = await read($, planAtom)
      await update($, gateAtom, () => onTurnStart(plan))
      await act($, { type: 'turnStart' }, autoShow)
      await tick($, true)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await act($, { type: 'turnEnd', reason: e.reason }, autoShow)
      await tick($, false)
    }

    return next(e)
  })

  on('command.run', { command: 'flow' }, async ($, e) => {
    const [word, arg] = e.args.trim().split(/\s+/)
    if (word === 'demo') return { text: await demo($, arg) }
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })

      return { text: '흐름도를 닫았어요' }
    }
    const placed = await openDrawer($)
    await refresh($, autoShow)

    return { text: placed ? '흐름도를 열었어요' : '흐름도를 열었어요. 화면이 넓어지면 보여요' }
  })

  // The tree above the prompt.
  // The band is one slot: what the plugins beneath draw stays, under the tree.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const at = await read($, demoAtom)
    const frame = at === null ? undefined : demoFrame(at)
    const plan = frame?.board.plan ?? (await read($, planAtom))
    if (frame === undefined && (await hidden($, plan, autoShow))) return below
    if ((await read($, paneAtom)) && (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced && p.isShown)) return below
    const { Box } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    const top: Line[] =
      at === null || frame === undefined
        ? []
        : [
            fitLine(
              [
                { text: `▶ 시연 ${at.scenario + 1}/${SCENARIOS.length} · ${SCENARIOS[at.scenario]?.title ?? ''}  `, color: 'text', bold: true },
                { text: '◂ 이전', color: 'inactive', button: DEMO_PREV },
                { text: '  ' },
                { text: '다음 ▸', color: 'text', bold: true, button: DEMO_NEXT },
                { text: '  ' },
                { text: '끝 ✕', color: 'inactive', button: DEMO_STOP },
              ],
              width,
            ),
            fitLine([{ text: frame.label, color: 'inactive' }], width),
          ]
    const view = drawTree(plan, frame?.activity ?? (await read($, activityAtom)), {
      maxRows: Math.min(e.props.maxRows, BAND_ROWS) - top.length,
      width,
      now: frame?.now ?? (await $.clock.now()),
      open: '흐름도 보기 ▸',
      folded: frame?.folded ?? (await read($, foldAtom)),
      parked: (frame?.board.shelf ?? (await read($, shelfAtom))).filter(s => s.state === 'parked').length,
    })
    const press = (id: string) => {
      if (id === OPEN_BUTTON) void openDrawer($)
      if (id === FOLD_BUTTON) void update($, foldAtom, f => !f)
      if (id === DEMO_NEXT) void demo($, 'next')
      if (id === DEMO_PREV) void demo($, 'prev')
      if (id === DEMO_STOP) void demo($, 'stop')
    }

    return (
      <Box flexDirection="column">
        {[...top, ...view].map(l => row($, e, l, null, press))}
        {below}
      </Box>
    )
  })

  // The drawer.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box } = $.ui.resolve(e)
    const at = await read($, demoAtom)
    const frame = at === null ? undefined : demoFrame(at)
    const plan = frame?.board.plan ?? (await read($, planAtom))
    const drawer = await read($, drawerAtom)
    const view = drawerView(plan, frame?.board.shelf ?? (await read($, shelfAtom)), drawer, frame?.activity ?? (await read($, activityAtom)), {
      width: e.props.bodyColumns,
      now: frame?.now ?? (await $.clock.now()),
    })
    const stage = currentLeaf(plan)?.id.split('.')[0] ?? null
    const focus = [drawer.focus, stage, runningLeaves(plan)[0]?.id ?? null].find(id => id !== null && view.buttons.includes(id)) ?? view.buttons[0] ?? null
    const fold = (id: string) => {
      void update($, drawerAtom, d => ({ ...toggleFold(plan, d, id), focus: id }))
    }

    return <Box flexDirection="column">{view.lines.map(l => row($, e, l, focus, fold))}</Box>
  })

  // The drawer closed (Esc, /flow, the person): the band comes back.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await update($, paneAtom, () => false)

    return closed
  })

  // Where the ring stands, so a redraw puts it back.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (!('deny' in moved && moved.deny !== undefined) && (e.plugin ?? PLUGIN) === PLUGIN && e.element !== undefined) {
      const element = e.element
      await update($, drawerAtom, d => ({ ...d, focus: element }))
    }

    return moved
  })
}
