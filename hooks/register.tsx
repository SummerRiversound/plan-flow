// Wiring only: hook events in, the pure modules beside this file decide, state out.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer } from 'claude-code'
import type { Activity, DrawerState, Shelved } from '../types'
import type { ActivityEvent } from './activity'
import { idleActivity, step } from './activity'
import { ASK, BOXED, PRIMARY, COLLAPSE_ALL, CONFIRM, EXPAND_ALL, FOLLOW, VIEW, drawerPage, drawerView, foldAll, hrefOf, linkLabel, pickStep, toggleFold } from './drawer'
import type { AxisItem, CardItem, CardStep } from './cards'
import { cardButtons, cardsOf, headOf, isDone } from './cards'
import { GUARDED, REMINDER, decide, denyReason, idleWatch, longStepNote, onPlanWritten, onStepPlanWritten, onTurnStart, watchStep } from './gate'
import type { Plan } from './plan'
import { clearMarks, currentLeaf, emptyPlan, finishedAt, hasChildren, hasOpenWork, progress, runningLeaves } from './plan'
import type { PlanOp } from './plan-tool'
import { TOOL_DESCRIPTION, TOOL_NAME, TOOL_SCHEMA, boardNote, instruction, parseOp, runOp } from './plan-tool'
import type { DemoAt } from './scenarios'
import { DEMO_NEXT, DEMO_PREV, DEMO_STOP, scenarios, demoFind, demoFrame, demoList, demoStep } from './scenarios'
import { joinSvg, liveSvg, progressSvg, spinSvg, splitSvg, trunkSvg } from './gui'
import type { Line } from './tree'
import { BAND_ROWS, FOLD_BUTTON, FRAME_MS, OPEN_BUTTON, drawTree, fitLine, isLive } from './tree'
import { cells } from './width'
import { pickLanguage, setLanguage, t } from './i18n'
import type { Newer, ReleaseCheck } from './version'
import { manifestUrl, newerVersion, runningVersion, staleRelease } from './version'

const PLUGIN = 'plan-flow'
const TOOL = `mcp__${PLUGIN}__${TOOL_NAME}`
const PANE = 'plan-flow'
const HIDE_AFTER_MS = 5000
const KEPT_SESSIONS = 20

const planAtom = atom({ plugin: 'plan-flow', key: 'plan' } as const, emptyPlan())
const activityAtom = atom({ plugin: 'plan-flow', key: 'activity' } as const, idleActivity())
const shelfAtom = atom({ plugin: 'plan-flow', key: 'shelf' } as const, [] as Shelved[])
const gateAtom = atom({ plugin: 'plan-flow', key: 'gate' } as const, { planned: false, denies: 0 })
const stepAtom = atom({ plugin: 'plan-flow', key: 'step' } as const, idleWatch())
const drawerAtom = atom({ plugin: 'plan-flow', key: 'drawer' } as const, { open: {}, focus: null } as DrawerState)
const askedAtom = atom({ plugin: 'plan-flow', key: 'asked' } as const, false)
const demoAtom = atom({ plugin: 'plan-flow', key: 'demo' } as const, null as DemoAt | null)
const paneAtom = atom({ plugin: 'plan-flow', key: 'pane' } as const, false)
const foldAtom = atom({ plugin: 'plan-flow', key: 'fold' } as const, false)
const newerAtom = atom({ plugin: 'plan-flow', key: 'newer' } as const, null as Newer | null)

type $ = EngineInterface
type Saved = Record<string, { plan: Plan; shelf?: Shelved[]; savedAt: number }>

// Draws one line of pieces; the pieces marked with a node id become that node's fold Button.
// Every piece is monospaced, so the cell counts the lines are built on hold off the terminal too.
const row = ($: $, e: Parameters<$['ui']['resolve']>[0], line: Line, focus: string | null, onPress: (id: string) => void, now: number) => {
  const t = $.ui.resolve(e)
  const { Box, Text, Button, Link } = t
  // A surface that draws pictures animates the running step itself; the terminal gets the frame drawn now.
  const Svg = e.surface !== 'terminal' && 'Svg' in t ? t.Svg : null
  const text = (s: Line[number]) => (
    <Text mono color={s.color} bold={s.bold === true ? true : undefined} dimColor={s.dim === true ? true : undefined} strikethrough={s.strike === true ? true : undefined}>
      {s.href === undefined ? s.text : <Link href={s.href}>{s.text}</Link>}
    </Text>
  )
  // A gap that grows on surfaces drawing native buttons, whose widths the cell count cannot know.
  const piece = (s: Line[number]) => (s.fill === true && e.surface !== 'terminal' ? <Box flexGrow={1} /> : text(s))
  const segs = (ss: Line) => {
    if (Svg === null) return ss.map(piece)
    const title = ss.filter(s => s.live === 'title').map(s => s.text).join('').trimStart()
    return ss.flatMap(s => {
      if (s.live === 'title') return []
      if (s.live !== 'mark') return [piece(s)]
      const pic = liveSvg(title, cells(title), now)
      return [<Svg source={pic.source} alt={title} width={pic.width} height={pic.height} />]
    })
  }
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
          segs(p.segs)
        ) : (
          <Button key={p.id} plain={BOXED.has(p.id ?? '') ? undefined : true} variant={PRIMARY.has(p.id ?? '') ? 'primary' : undefined} autoFocus={p.id === focus ? true : undefined} onPress={() => onPress(p.id ?? '')}>
            {segs(p.segs)}
          </Button>
        ),
      )}
    </Box>
  )
}

// The drawer on a surface that draws real boxes and its own type (the desktop app, the
// editor): a head set in the app's type, then each stage a rounded card (the running one in
// text colour), parallel stages side by side with lines between them, or the same steps as a
// plain list. A step's title is its Button: a box folds, a step is picked with its buttons under it.
type Ev = Parameters<$['ui']['resolve']>[0]

const nativeDrawer = ($: $, e: Ev, plan: Plan, shelf: readonly Shelved[], drawer: DrawerState, activity: Activity, onPress: (id: string) => void, now: number) => {
  const el = $.ui.resolve(e)
  const { Box, Text, Button, Link } = el
  const Svg = 'Svg' in el ? el.Svg : null
  const live = isLive(activity)
  const list = drawer.list === true
  const axis = cardsOf(plan, drawer)
  const stage = currentLeaf(plan)?.id.split('.')[0] ?? null
  const ring = [drawer.focus, stage, runningLeaves(plan)[0]?.id ?? null].find(id => id !== null && cardButtons(axis).includes(id)) ?? null
  const parked = shelf.filter(s => s.state === 'parked')

  // A small rounded tag: tasks that run together, a link.
  const tag = (child: RenderChildren) => (
    <Box borderStyle="round" borderColor="inactive" paddingX="xs" alignSelf="flex-start">
      {child}
    </Box>
  )
  const links = (ls: readonly string[]) =>
    ls.length === 0 ? null : (
      <Box flexDirection="row" flexWrap="wrap" gap="xs">
        {ls.map(l => {
          const href = hrefOf(l)
          return tag(<Text size="caption">{href === undefined ? `↗ ${linkLabel(l)}` : <Link href={href}>↗ {linkLabel(l)}</Link>}</Text>)
        })}
      </Box>
    )
  const title = (s: CardStep, top: boolean, glyph: boolean) => (
    <Text weight={s.running || top ? 'semibold' : undefined} dimColor={isDone(s) ? true : undefined} strikethrough={s.status === 'skipped' ? true : undefined}>
      {glyph ? <Text color={s.glyph.color}>{s.glyph.text} </Text> : null}
      {s.title}
      {s.redo ? ' ↺' : ''}
    </Text>
  )
  const head = (s: CardStep, top: boolean) => {
    // The running step turns while Claude works; the mark is a picture, so it sits beside the title's Button.
    const spin = s.running && live && !s.parent && Svg !== null
    return (
      <Box flexDirection="row" alignItems="center" gap="xs">
        {spin ? <Svg source={spinSvg(now)} alt={t().running} width={14} height={14} /> : null}
        <Button key={s.id} plain autoFocus={s.id === ring ? true : undefined} onPress={() => onPress(s.id)}>
          {title(s, top, !spin)}
        </Button>
        <Box flexGrow={1} />
        {s.right === null ? null : (
          <Text size="footnote" tabular color={s.right.color}>
            {s.right.text}
          </Text>
        )}
      </Box>
    )
  }
  const stepBlock = (s: CardStep, top: boolean): RenderChildren => (
    <Box flexDirection="column" gap="xs">
      {head(s, top)}
      {s.detail === undefined ? null : (
        <Text size="footnote" color="inactive">
          {s.detail}
        </Text>
      )}
      {s.note === undefined ? null : (
        <Text size="footnote" color={s.status === 'blocked' ? 'error' : 'inactive'}>
          {s.note}
        </Text>
      )}
      {links(s.links)}
      {s.actions.length === 0 ? null : (
        <Box flexDirection="row" gap="xs">
          {s.actions.map(([id, label]) => (
            <Button key={id} onPress={() => onPress(id)}>
              {label}
            </Button>
          ))}
        </Box>
      )}
      {s.children.length === 0 ? null : (
        <Box flexDirection="column" gap="xs" paddingLeft="md">
          {s.children.map(item)}
        </Box>
      )}
    </Box>
  )
  const together = (child: RenderChildren) => (
    <Box flexDirection="column" gap="xs">
      {tag(
        <Text size="caption" color="inactive">
          {t().parallel}
        </Text>,
      )}
      <Box flexDirection="column" gap="xs" paddingLeft="sm">
        {child}
      </Box>
    </Box>
  )
  const item = (i: CardItem): RenderChildren => (i.kind === 'step' ? stepBlock(i.step, false) : together(i.items.map(item)))
  const card = (s: CardStep) => (
    <Box flexDirection="column" borderStyle="round" borderColor={s.running ? 'text' : 'inactive'} paddingX="sm" paddingY="xs">
      {stepBlock(s, true)}
    </Box>
  )
  // The app drops a picture with no alt.
  const pic = (source: string, key: string) => (Svg === null ? null : <Svg key={key} source={source} alt={t().line} />)
  const summary = (a: Extract<AxisItem, { kind: 'summary' }>) => {
    const part = (label: string, text: string) => (
      <Box flexDirection="column">
        <Text size="caption" color="inactive">
          {label}
        </Text>
        <Text size="footnote">{text}</Text>
      </Box>
    )
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX="sm" paddingY="xs" gap="xs">
        <Text weight="semibold">
          <Text color="success">✓</Text> {t().summary.title}
        </Text>
        {part(t().summary.goal, a.goal)}
        {part(t().summary.result, a.result)}
        {links(a.links)}
      </Box>
    )
  }

  const flow: RenderChildren[] = []
  axis.forEach((a, i) => {
    const first = i === 0
    const last = i === axis.length - 1
    if (list) {
      flow.push(a.kind === 'stage' ? stepBlock(a.stage, true) : a.kind === 'split' ? together(a.stages.map(s => stepBlock(s, true))) : summary(a))
      return
    }
    if (a.kind === 'split') {
      flow.push(pic(splitSvg(a.stages.length, !first), `split-${i}`))
      flow.push(
        <Box flexDirection="row">
          {a.stages.map(s => (
            <Box width={`${100 / a.stages.length}%`} flexDirection="column" paddingX="xs">
              {card(s)}
            </Box>
          ))}
        </Box>,
      )
      flow.push(pic(joinSvg(a.stages.length, !last), `join-${i}`))
      return
    }
    if (!first && axis[i - 1]?.kind !== 'split') flow.push(pic(trunkSvg(), `trunk-${i}`))
    flow.push(
      <Box flexDirection="column" paddingX="xs">
        {a.kind === 'stage' ? card(a.stage) : summary(a)}
      </Box>,
    )
  })

  const hd = headOf(plan, parked.length, activity)
  const top =
    plan.nodes.length === 0 ? (
      <Text color="inactive">{t().empty}</Text>
    ) : (
      <Box flexDirection="column" gap="xs" paddingX="xs">
        <Text size="heading" weight="semibold">
          {hd.title}
        </Text>
        {hd.goal === undefined ? null : (
          <Text size="footnote" color="inactive">
            {hd.goal}
          </Text>
        )}
        <Box flexDirection="row" alignItems="center" gap="sm">
          <Box flexGrow={1} flexDirection="column">
            {Svg === null ? null : <Svg source={progressSvg(hd.slots)} alt={t().progress(hd.done, hd.total)} />}
          </Box>
          <Text size="footnote" tabular color="inactive">
            {`${hd.done}/${hd.total} · ${hd.pct}%${hd.parked > 0 ? t().parked(hd.parked) : ''}`}
          </Text>
        </Box>
        {hd.checks.length === 0 ? null : (
          <Text size="footnote">
            <Text weight="semibold">{t().checks(hd.checks.length).replace(/:\s*$/, '')}</Text> {hd.checks.join(' · ')}
          </Text>
        )}
        {hd.activity === undefined ? null : (
          <Text size="footnote">
            <Text color={hd.activity.color}>●</Text> {hd.activity.text}
          </Text>
        )}
        <Box flexDirection="row" alignItems="center" gap="xs">
          {list ? null : (
            <Button key={EXPAND_ALL} onPress={() => onPress(EXPAND_ALL)}>
              {t().expandAll}
            </Button>
          )}
          {list ? null : (
            <Button key={COLLAPSE_ALL} onPress={() => onPress(COLLAPSE_ALL)}>
              {t().collapseAll}
            </Button>
          )}
          <Box flexGrow={1} />
          <Button key={VIEW} onPress={() => onPress(VIEW)}>
            {list ? t().toFlow : t().toList}
          </Button>
        </Box>
      </Box>
    )

  return (
    <Box flexDirection="column" gap="md">
      {top}
      {flow.length === 0 ? null : (
        <Box flexDirection="column" gap={list ? 'sm' : 'xs'}>
          {flow}
        </Box>
      )}
      {parked.length === 0 ? null : (
        <Box flexDirection="column" gap="xs" paddingX="xs">
          <Text size="footnote" weight="semibold">
            {t().shelf}
          </Text>
          {parked.map(p => {
            const { done, total } = progress(p.plan)
            return (
              <Box flexDirection="row">
                <Text size="footnote" color="inactive">
                  ▸ {p.plan.title}
                </Text>
                <Box flexGrow={1} />
                <Text size="footnote" tabular color="inactive">
                  {`${done}/${total}`}
                </Text>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

async function shown($: $, autoShow: boolean): Promise<boolean> {
  return autoShow || (await read($, askedAtom))
}

// The tree steps aside a while after the last step is done.
async function hidden($: $, plan: Plan, autoShow: boolean): Promise<boolean> {
  const done = finishedAt(plan)

  return plan.nodes.length === 0 || !(await shown($, autoShow)) || (done !== null && (await $.clock.now()) - done >= HIDE_AFTER_MS)
}

async function act($: $, ev: ActivityEvent): Promise<void> {
  await update($, activityAtom, a => step(a, ev))
}

let ticker: Timer | null = null
// Where the drawer's own window stood when it was last drawn, for the person's next scroll.
let page = { top: 0, max: 0, pinned: false }
// The band or drawer was drawn on a terminal, where the running step moves by redrawing.
// shortcut: one flag for the session, so a desktop viewer beside a terminal redraws as often; split per surface if that costs.
let onTerminal = false

// While a turn runs on an open plan: each frame on a terminal, for the running step's motion;
// each second elsewhere, for the elapsed times.
async function tick($: $, running: boolean): Promise<void> {
  const want = running && hasOpenWork(await read($, planAtom))
  if (want && ticker === null) ticker = $.clock.every(onTerminal ? FRAME_MS : 1000, () => $.ui.invalidate('ui.render'))
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
  const opened = await $.ui.open({ id: PANE, title: t().pane, focus: true, closeOnEscape: true })
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
  if (arg !== undefined && !['stop', 'next', 'prev'].includes(arg) && demoFind(arg) === undefined) return t().demo.unknown(demoList())
  await update($, demoAtom, () => to)
  await update($, drawerAtom, (): DrawerState => ({ open: {}, focus: null }))
  if (to === null) return t().demo.ended
  const s = scenarios()[to.scenario]

  return t().demo.at(to.scenario + 1, scenarios().length, s?.title ?? '', demoFrame(to)?.label ?? '', demoList())
}

// What the person changed on the board from the drawer, told to Claude with the next request.
// shortcut: a module variable, lost on a reload of the mod; move to $.state if that bites.
let byPerson: string[] = []

// Runs one op on the board, from the plan tool or a press in the drawer, and redraws.
async function apply($: $, op: PlanOp): Promise<{ text: string } | { error: string }> {
  const before = await read($, planAtom)
  const shelf = await read($, shelfAtom)
  const ran = runOp({ plan: before, shelf }, op, await $.clock.now())
  if ('error' in ran) return ran
  if (ran.notice !== undefined) $.ui.toast(ran.notice)
  if (ran.board.shelf !== shelf) await update($, shelfAtom, () => ran.board.shelf)
  if (ran.board.plan !== before || ran.board.shelf !== shelf) {
    const plan = ran.board.plan
    await update($, planAtom, () => plan)
    await update($, gateAtom, onPlanWritten)
    await update($, stepAtom, onStepPlanWritten)
    if (plan.title !== before.title) await update($, drawerAtom, (): DrawerState => ({ open: {}, focus: null }))
    await save($, plan, ran.board.shelf)
    await tick($, true)
    if (finishedAt(plan) !== null) {
      $.clock.after(HIDE_AFTER_MS + 100, () => $.ui.invalidate('ui.render'))
    }
  }

  return { text: ran.text }
}

// Whether a newer plan-flow is installed beside this one or out in its repository. The repository
// is asked at most once a day, never while nonessential traffic is off; any failure leaves the band as it is.
async function checkVersion($: $): Promise<void> {
  const here = runningVersion($.plugin.root)
  if (here === null) return
  const installed = (await $.fs.list(here.parent).catch(() => [])).filter(f => f.kind === 'dir').map(f => f.name)
  const now = await $.clock.now()
  let last = (await $.store.get('release').catch(() => undefined)) as ReleaseCheck | undefined
  if (staleRelease(last, now) && !(await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC').catch(() => undefined))) {
    const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => '{}')) as { repository?: string }
    const url = manifestUrl(manifest.repository)
    const res = url === undefined ? undefined : await $.http.fetch(url).catch(() => undefined)
    const version = res?.ok === true ? (JSON.parse(res.text) as { version?: unknown }).version : undefined
    last = { checkedAt: now, version: typeof version === 'string' ? version : last?.version }
    await $.store.set('release', last)
  }
  const newer = newerVersion(here.version, installed, last?.version)
  const before = await read($, newerAtom)
  if (newer?.kind !== before?.kind || newer?.version !== before?.version) await update($, newerAtom, () => newer)
}

// The language the mod speaks: its option, else Claude Code's language setting, else the locale.
async function resolveLanguage($: $, option: unknown): Promise<void> {
  // A policy can refuse a read; the language then falls through to the next source.
  const safe = async <T,>(get: () => Promise<T>): Promise<T | undefined> => get().catch(() => undefined)
  const setting = await safe(() => $.settings.read({ key: 'language' }))
  const locale = await safe(async () => (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG')))
  setLanguage(pickLanguage(option, setting, locale))
}

export const register: Register = (on, options) => {
  const autoShow = options.autoShow !== false
  const enforce = options.enforce === true
  let offered = false

  on('session.start', async ($, e, next) => {
    await resolveLanguage($, options.language)
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA, isDeferred: false })
    offered = true
    await $.command.register({ name: 'flow', description: t().command, immediate: true })
    const saved = ((await $.store.get('plans')) ?? {}) as Saved
    const mine = saved[await $.session.id()]
    const plan = mine?.plan ?? emptyPlan()
    await update($, planAtom, () => plan)
    await update($, shelfAtom, () => mine?.shelf ?? [])
    await update($, activityAtom, () => idleActivity())
    await update($, gateAtom, () => onTurnStart(plan))
    // A reload runs this again: forget what the older copy saw, then look afresh without holding the start.
    await update($, newerAtom, () => null)
    void checkVersion($).catch(() => undefined)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (e.traits.includes('bare') || !e.tools.includes(TOOL)) return composed

    return { sections: [...composed.sections, { id: `${PLUGIN}:plan`, text: instruction(TOOL), scope: 'session' as const }] }
  })

  // Each request the person sends: last request's marks go, and the model gets the board.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true || !offered) return next(e)
    const plan = await read($, planAtom)
    if (plan.marks !== undefined) await update($, planAtom, clearMarks)
    const note = boardNote({ plan, shelf: await read($, shelfAtom) }, byPerson)
    byPerson = []

    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  // The plan tool itself.
  on('tool.call', { tool: 'mcp__plan-flow__plan' }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: 'The plan belongs to the main conversation; a subagent does not change it.' }
    const { tool: _tool, tool_use_id: _id, agentId: _agent, requestMeta: _meta, ...input } = e as Record<string, unknown>
    const parsed = parseOp(input)
    if ('error' in parsed) return { result: parsed.error }
    const ran = await apply($, parsed.op)

    return { result: 'error' in ran ? ran.error : ran.text }
  })

  // Every other tool: the optional gate, then the activity line.
  on('tool.call', async ($, e, next) => {
    if (e.tool === TOOL) return next(e)
    const verdict = decide({ tool: e.tool, agentId: e.agentId, enforce, toolOffered: offered, gate: await read($, gateAtom) })
    if (verdict.verdict === 'deny' || verdict.verdict === 'pause') await update($, gateAtom, () => verdict.gate)
    if (verdict.verdict === 'deny') return { deny: denyReason(TOOL) }
    if (verdict.verdict === 'pause') $.ui.toast(t().pause)
    if (e.agentId !== undefined) return next(e)
    const question = e.tool === 'AskUserQuestion'
    await act($, question ? { type: 'questionOpen' } : { type: 'toolStart', id: e.tool_use_id, tool: e.tool })
    try {
      const out = await next(e)
      // Only a call that changed something counts: a read-only `ls` neither uses up the reminder nor adds to a step.
      if (out.deny !== undefined || out.isReadOnly === true || !GUARDED.has(e.tool)) return out
      if (verdict.verdict === 'remind') {
        await update($, gateAtom, () => verdict.gate)
        return { ...out, context: [...(out.context ?? []), REMINDER] }
      }
      // The step Claude is on: the running one, else the one up next when Claude has not marked it.
      const run = currentLeaf(await read($, planAtom)) ?? undefined
      const watched = watchStep(await read($, stepAtom), run?.id ?? null)
      await update($, stepAtom, () => watched.watch)
      if (!watched.nudge || run === undefined) return out

      return { ...out, context: [...(out.context ?? []), longStepNote(run.id, run.title)] }
    } finally {
      await act($, question ? { type: 'questionClose' } : { type: 'toolEnd', id: e.tool_use_id })
      await act($, { type: 'permissionEnd' })
    }
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.agent_id === undefined) await act($, { type: 'permissionAsk', tool: e.tool_name })

    return next(e)
  })
  on('classic.PreCompact', async ($, e, next) => (await act($, { type: 'compactStart' }), next(e)))
  on('classic.PostCompact', async ($, e, next) => (await act($, { type: 'compactEnd' }), next(e)))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const plan = await read($, planAtom)
      await update($, gateAtom, () => onTurnStart(plan))
      await act($, { type: 'turnStart' })
      await tick($, true)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await act($, { type: 'turnEnd', reason: e.reason })
      await tick($, false)
      void checkVersion($).catch(() => undefined)
    }

    return next(e)
  })

  on('command.run', { command: 'flow' }, async ($, e) => {
    const [word, arg] = e.args.trim().split(/\s+/)
    if (word === 'demo') return { text: await demo($, arg) }
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })

      return { text: t().closed }
    }
    const placed = await openDrawer($)

    return { text: placed ? t().opened : t().openedLater }
  })

  // The tree above the prompt.
  // The band is one slot: what the plugins beneath draw stays, under the tree.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.surface === 'terminal') onTerminal = true
    if (e.props.hasSurvey) return below
    const at = await read($, demoAtom)
    const frame = at === null ? undefined : demoFrame(at)
    const plan = frame?.board.plan ?? (await read($, planAtom))
    if (frame === undefined && (await hidden($, plan, autoShow))) return below
    if ((await read($, paneAtom)) && (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced && p.isShown)) return below
    const { Box } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    const now = frame?.now ?? (await $.clock.now())
    const top: Line[] =
      at === null || frame === undefined
        ? []
        : [
            fitLine(
              [
                { text: t().demo.bar(at.scenario + 1, scenarios().length, scenarios()[at.scenario]?.title ?? ''), color: 'text', bold: true },
                { text: t().demo.prev, color: 'inactive', button: DEMO_PREV },
                { text: '  ' },
                { text: t().demo.next, color: 'text', bold: true, button: DEMO_NEXT },
                { text: '  ' },
                { text: t().demo.stop, color: 'inactive', button: DEMO_STOP },
              ],
              width,
            ),
            fitLine([{ text: frame.label, color: 'inactive' }], width),
          ]
    const view = drawTree(plan, frame?.activity ?? (await read($, activityAtom)), {
      maxRows: Math.min(e.props.maxRows, BAND_ROWS) - top.length,
      width,
      now,
      open: t().bandOpen,
      folded: frame?.folded ?? (await read($, foldAtom)),
      parked: (frame?.board.shelf ?? (await read($, shelfAtom))).filter(s => s.state === 'parked').length,
      notice: frame === undefined ? await read($, newerAtom).then(n => (n === null ? undefined : t().newer(n))) : undefined,
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
        {[...top, ...view].map(l => row($, e, l, null, press, now))}
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
    if (e.surface === 'terminal') onTerminal = true
    const now = frame?.now ?? (await $.clock.now())
    const activity = frame?.activity ?? (await read($, activityAtom))
    const view = drawerView(plan, frame?.board.shelf ?? (await read($, shelfAtom)), drawer, activity, {
      width: e.props.bodyColumns,
      now,
    })
    const shown = drawerPage(view, e.props.scroll.bodyRows, drawer.top, e.props.bodyColumns)
    page = shown
    // The ring goes back where it was if that row still shows, else to the box Claude is in.
    const ids = shown.lines.flatMap(l => l.flatMap(s => (s.button === undefined ? [] : [s.button])))
    const stage = currentLeaf(plan)?.id.split('.')[0] ?? null
    const focus = [drawer.focus, stage, runningLeaves(plan)[0]?.id ?? null].find(id => id !== null && view.buttons.includes(id) && ids.includes(id)) ?? null
    const picked = plan.nodes.find(n => n.id === drawer.pick)
    const press = (id: string) => {
      if (id === CONFIRM && picked !== undefined) {
        if (frame !== undefined) return $.ui.toast(t().demo.untouched)
        byPerson.push(`"${picked.title}" (id ${picked.id}) marked completed: the person checked it.`)
        void apply($, { op: 'update', updates: [{ id: picked.id, status: 'completed', note: '' }] }).then(() => update($, drawerAtom, d => ({ ...d, pick: undefined })))
        return
      }
      // A draft, not a send: the person writes the rest and sends it themselves.
      if (id === ASK && picked !== undefined) {
        void $.prompt.fill({ text: `[${picked.title}] `, mode: 'insert' }).then(r => $.ui.toast(r.isFilled ? t().filled : t().notFilled))
        return
      }
      void update($, drawerAtom, (d): DrawerState =>
        id === EXPAND_ALL || id === COLLAPSE_ALL
          ? foldAll(plan, d, id === EXPAND_ALL)
          : id === FOLLOW
            ? { ...d, top: undefined }
            : id === VIEW
              ? { ...d, list: d.list !== true, top: undefined }
              : hasChildren(plan.nodes, id)
                ? { ...toggleFold(plan, d, id), focus: id }
                : pickStep(d, id),
      )
    }

    // A surface with real boxes and its own type draws the drawer natively and scrolls it itself.
    if (e.surface !== 'terminal') {
      page = { top: 0, max: 0, pinned: false }
      return nativeDrawer($, e, plan, frame?.board.shelf ?? (await read($, shelfAtom)), drawer, activity, press, now)
    }

    return <Box flexDirection="column">{shown.lines.map(l => row($, e, l, focus, press, now))}</Box>
  })

  // The person scrolls the drawer: its body moves under the pinned head and foot, and
  // following the running step stops until they press "진행 중으로".
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!page.pinned) return next(e)
    const top = Math.max(0, Math.min(page.max, page.top + e.by))
    await update($, drawerAtom, d => ({ ...d, top }))

    return next({ ...e, offset: 0 })
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
