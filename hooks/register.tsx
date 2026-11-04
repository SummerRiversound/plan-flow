// Wiring only: hook events in, the pure modules beside this file decide, state out.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { DrawerState } from '../types'
import type { ActivityEvent } from './activity'
import { idleActivity, step } from './activity'
import { drawFlow, toggleFold } from './drawer'
import { PAUSE_NOTICE, decide, denyReason, onPlanWritten, onTurnStart } from './gate'
import type { Plan } from './plan'
import { currentLeaf, emptyPlan, finishedAt, hasOpenWork, runningLeaves } from './plan'
import { TOOL_DESCRIPTION, TOOL_NAME, TOOL_SCHEMA, instruction, parseOp, runOp } from './plan-tool'
import type { Line } from './tree'
import { layoutTree, statusLine } from './tree'

const PLUGIN = 'plan-flow'
const TOOL = `mcp__${PLUGIN}__${TOOL_NAME}`
const PANE = 'plan-flow'
const HIDE_AFTER_MS = 5000
const KEPT_SESSIONS = 20
// The most rows the tree takes above the prompt; past that it scrolls.
const BAND_ROWS = 12

const planAtom = atom({ plugin: 'plan-flow', key: 'plan' } as const, emptyPlan())
const activityAtom = atom({ plugin: 'plan-flow', key: 'activity' } as const, idleActivity())
const gateAtom = atom({ plugin: 'plan-flow', key: 'gate' } as const, { planned: false, denies: 0 })
const drawerAtom = atom({ plugin: 'plan-flow', key: 'drawer' } as const, { open: {}, focus: null } as DrawerState)
const askedAtom = atom({ plugin: 'plan-flow', key: 'asked' } as const, false)
const scrollAtom = atom({ plugin: 'plan-flow', key: 'scroll' } as const, null as number | null)

type $ = EngineInterface
type Saved = Record<string, { plan: Plan; savedAt: number }>

// Draws one line of pieces; the pieces marked with a node id become that node's fold Button.
const row = ($: $, e: Parameters<$['ui']['resolve']>[0], line: Line, focus: string | null, onPress: (id: string) => void) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  const text = (s: Line[number]) => (
    <Text color={s.color} bold={s.bold === true ? true : undefined} dimColor={s.dim === true ? true : undefined} strikethrough={s.strike === true ? true : undefined}>
      {s.text}
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

// One plan per session, the most recent sessions kept.
async function save($: $, plan: Plan): Promise<void> {
  const sid = await $.session.id()
  const saved = ((await $.store.get('plans')) ?? {}) as Saved
  saved[sid] = { plan, savedAt: await $.clock.now() }
  const kept = Object.entries(saved)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, KEPT_SESSIONS)
  await $.store.set('plans', Object.fromEntries(kept))
}

export const register: Register = (on, options) => {
  const autoShow = options.autoShow !== false
  const enforce = options.enforce === true
  const accent = typeof options.accentColor === 'string' && options.accentColor.trim() !== '' ? options.accentColor.trim() : 'claude'
  let offered = false
  // The band's window as last drawn, for the next scroll.
  let band = { offset: 0, maxOffset: 0 }

  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA, isDeferred: false })
    offered = true
    await $.command.register({ name: 'flow', description: '계획 흐름도를 열거나 닫아요', immediate: true })
    const saved = ((await $.store.get('plans')) ?? {}) as Saved
    const plan = saved[await $.session.id()]?.plan ?? emptyPlan()
    await update($, planAtom, () => plan)
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

  // The plan tool itself.
  on('tool.call', { tool: 'mcp__plan-flow__plan' }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: 'The plan belongs to the main conversation; a subagent does not change it.' }
    const { tool: _tool, tool_use_id: _id, agentId: _agent, requestMeta: _meta, ...input } = e as Record<string, unknown>
    const parsed = parseOp(input)
    if ('error' in parsed) return { result: parsed.error }
    const before = await read($, planAtom)
    const ran = runOp(before, parsed.op, await $.clock.now())
    if ('error' in ran) return { result: ran.error }
    if (ran.plan !== before) {
      await update($, planAtom, () => ran.plan)
      await update($, gateAtom, onPlanWritten)
      // A step moved: the band follows it again.
      await update($, scrollAtom, () => null)
      if (ran.plan.title !== before.title) await update($, drawerAtom, (): DrawerState => ({ open: {}, focus: null }))
      await save($, ran.plan)
      await tick($, true)
      if (finishedAt(ran.plan) !== null) {
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

  on('command.run', { command: 'flow' }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })

      return { text: '흐름도를 닫았어요' }
    }
    await update($, askedAtom, () => true)
    await refresh($, autoShow)
    const opened = await $.ui.open({ id: PANE, title: '흐름도', focus: true, closeOnEscape: true })

    return { text: opened.isPlaced ? '흐름도를 열었어요' : '흐름도를 열었어요. 화면이 넓어지면 보여요' }
  })

  // The tree above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const plan = await read($, planAtom)
    if (await hidden($, plan, autoShow)) return next(e)
    const { Box } = $.ui.resolve(e)
    const view = layoutTree(plan, await read($, activityAtom), {
      maxRows: Math.min(e.props.maxRows, BAND_ROWS),
      width: e.props.bodyColumns,
      accent,
      now: await $.clock.now(),
      scroll: await read($, scrollAtom),
    })
    band = view

    return <Box flexDirection="column">{view.lines.map(l => row($, e, l, null, () => undefined))}</Box>
  })

  // The band is capped below the engine's rows, so it scrolls its own window.
  on('ui.scroll', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (band.maxOffset === 0) return next(e)
    const to = Math.max(0, Math.min(band.maxOffset, band.offset + e.by))
    await update($, scrollAtom, () => to)

    return {}
  })

  // The drawer.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const plan = await read($, planAtom)
    if (plan.nodes.length === 0) return <Text dimColor>아직 계획이 없어요. Claude가 계획을 세우면 여기에 그려져요.</Text>
    const drawer = await read($, drawerAtom)
    const flow = drawFlow(plan, drawer, { width: e.props.bodyColumns, accent, now: await $.clock.now() })
    const stage = currentLeaf(plan)?.id.split('.')[0] ?? null
    const focus = [drawer.focus, stage, runningLeaves(plan)[0]?.id ?? null].find(id => id !== null && flow.buttons.includes(id)) ?? flow.buttons[0] ?? null
    const fold = (id: string) => {
      void read($, planAtom).then(p => update($, drawerAtom, d => ({ ...toggleFold(p, d, id), focus: id })))
    }

    return <Box flexDirection="column">{flow.lines.map(l => row($, e, l, focus, fold))}</Box>
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
