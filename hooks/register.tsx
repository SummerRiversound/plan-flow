// Wiring only: hook events in, the pure modules beside this file decide, state out.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Space, Timer } from 'claude-code'
import type { Activity, DrawerState, Shelved } from '../types'
import type { ActivityEvent } from './activity'
import { idleActivity, step } from './activity'
import { ASK, BOXED, PRIMARY, COLLAPSE_ALL, CONFIRM, EXPAND_ALL, FOLLOW, VIEW, drawFlow, drawerPage, drawerView, foldAll, hrefOf, linkLabel, pickStep, toggleFold } from './drawer'
import type { AxisItem, CardItem, CardStep } from './cards'
import type { CardHead } from './cards'
import { cardButtons, cardsOf, headOf, isDone } from './cards'
import { GUARDED, REMINDER, decide, denyReason, idleWatch, longStepNote, onPlanWritten, onStepPlanWritten, onTurnStart, watchStep } from './gate'
import type { Plan, PlanNode } from './plan'
import { clearMarks, currentLeaf, emptyPlan, finishedAt, hasChildren, hasOpenWork, isFinished, progress, runningLeaves } from './plan'
import type { PlanOp } from './plan-tool'
import { TOOL_DESCRIPTION, TOOL_NAME, TOOL_SCHEMA, boardNote, instruction, parseOp, runOp } from './plan-tool'
import type { DemoAt } from './scenarios'
import { DEMO_NEXT, DEMO_PREV, DEMO_STOP, scenarios, demoFind, demoFrame, demoList, demoStep } from './scenarios'
import { joinSvg, progressSvg, ruleSvg, spinSvg, splitSvg, trunkSvg } from './gui'
import type { Line } from './tree'
import type { BandRow } from './tree'
import type { StepRowProps } from './step-row'
import { BAND_ROWS, FOLD_BUTTON, FRAME_MS, OPEN_BUTTON, bandRows, counts, drawTree, fitLine, glyphSeg, isLive, noteText, planHead } from './tree'
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
type Ev = Parameters<$['ui']['resolve']>[0]

// Neutral greys at low opacity for the desktop app and the editor: one value reads on the
// light and the dark theme, where no theme key gives a faint edge or a pointer highlight.
const HOVER = '#8080801a'
const EDGE = '#80808033'
const EDGE_RUN = '#80808080'
type Saved = Record<string, { plan: Plan; shelf?: Shelved[]; savedAt: number }>

// Draws one line of pieces; the pieces marked with a node id become that node's fold Button.
// The terminal's lines (and a demo's bar); surfaces with their own type draw natively.
const row = ($: $, e: Ev, line: Line, focus: string | null, onPress: (id: string) => void) => {
  const { Box, Text, Button, Link } = $.ui.resolve(e)
  const segs = (ss: Line) =>
    ss.map(s => (
      <Text mono color={s.color} bold={s.bold === true ? true : undefined} dimColor={s.dim === true ? true : undefined} strikethrough={s.strike === true ? true : undefined}>
        {s.href === undefined ? s.text : <Link href={s.href}>{s.text}</Link>}
      </Text>
    ))
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
// The head the native drawer and band share: the title row, the goal, the progress bar and
// counts, then (unless folded) the steps to check and what Claude is doing, then `tools`.
const nativeHead = ($: $, e: Ev, hd: CardHead, o: { title: RenderChildren; goalRows: number; folded?: boolean; tools?: RenderChildren }) => {
  const el = $.ui.resolve(e)
  const { Box, Text } = el
  const Svg = 'Svg' in el ? el.Svg : null

  return (
    <Box flexDirection="column" gap="xs" paddingX="xs">
      {o.title}
      {hd.goal === undefined ? null : (
        <Text size="footnote" color="inactive" wrap={o.goalRows === 1 ? 'truncate-end' : undefined}>
          {hd.goal}
        </Text>
      )}
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Box flexGrow={1} flexDirection="column">
          {Svg === null ? null : <Svg source={progressSvg(hd.slots)} alt={t().progress(hd.done, hd.total)} />}
        </Box>
        <Box flexShrink={0}>
          <Text size="footnote" tabular color="inactive">
            {`${hd.done}/${hd.total} · ${hd.pct}%${hd.parked > 0 ? t().parked(hd.parked) : ''}`}
          </Text>
        </Box>
      </Box>
      {o.folded === true || hd.checks.length === 0 ? null : (
        <Text size="footnote">
          <Text weight="semibold">{t().checks(hd.checks.length).replace(/:\s*$/, '')}</Text> {hd.checks.join(' · ')}
        </Text>
      )}
      {o.folded === true || hd.activity === undefined ? null : (
        <Text size="footnote">
          <Text color={hd.activity.color}>●</Text> {hd.activity.text}
        </Text>
      )}
      {o.tools ?? null}
    </Box>
  )
}

// The band above the prompt on a surface with its own type: the shared head, its title the
// fold Button, the flowchart Button flush right, then the tree's rows, each step in by its level.
const nativeBand = ($: $, e: Ev, plan: Plan, activity: Activity, o: { folded: boolean; parked: number; notice?: string; budget: number; width: number; now: number; onPress: (id: string) => void }) => {
  const el = $.ui.resolve(e)
  const { Box, Text, Button } = el
  const Svg = 'Svg' in el ? el.Svg : null
  const live = isLive(activity)
  const rows = o.folded ? [] : bandRows(plan, activity, o.budget, o.width, o.now)
  const depth = (n: PlanNode) => n.id.split('.').length - 1
  const row = (r: BandRow): RenderChildren => {
    if (r.kind === 'more')
      return (
        <Text size="footnote" color="inactive">
          {r.text}
        </Text>
      )
    if (r.kind === 'detail')
      return (
        <Box paddingLeft={depth(r.node) * 2 + 3}>
          <Text size="footnote" color="inactive">
            {r.text}
          </Text>
        </Box>
      )
    const n = r.node
    const parent = hasChildren(plan.nodes, n.id)
    const spin = n.status === 'in_progress' && !parent && live && Svg !== null
    const done = isFinished(n.status) && n.status !== 'needs_check'
    const glyph = glyphSeg(n)
    const note = noteText(n)
    return (
      <Box key={n.id} flexDirection="row" alignItems="center" gap="xs" paddingLeft={depth(n) * 2}>
        {spin ? <Svg source={spinSvg(o.now)} alt={t().running} width={14} height={14} /> : <Text color={glyph.color}>{glyph.text}</Text>}
        <Text weight={r.line.some(s => s.bold === true) || n.status === 'in_progress' ? 'semibold' : undefined} dimColor={done ? true : undefined} strikethrough={n.status === 'skipped' ? true : undefined} wrap="truncate-end">
          {n.title}
          {plan.marks?.[n.id] === 'redo' ? ' ↺' : ''}
        </Text>
        {n.parallel === true ? (
          // A tint, not a border: the app pads a bordered box itself, which would make the tag taller than the row.
          <Box backgroundColor={EDGE} paddingX="xs">
            <Text size="caption" color="inactive">
              {t().parallel}
            </Text>
          </Box>
        ) : null}
        {note === '' ? null : (
          <Text size="footnote" color={n.status === 'blocked' ? 'error' : 'inactive'} wrap="truncate-end">
            {note.trim()}
          </Text>
        )}
        <Box flexGrow={1} />
        {parent ? (
          <Box flexShrink={0}>
            <Text size="footnote" tabular color="inactive">
              {`${counts(plan, n.id)}${r.folded ? ' ▸' : ''}`}
            </Text>
          </Box>
        ) : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap="xs">
      {nativeHead($, e, headOf(plan, o.parked, activity), {
        folded: o.folded,
        goalRows: 1,
        title: (
          <Box flexDirection="row" alignItems="center" gap="xs">
            {e.surface === 'desktop' && 'Client' in el ? (
              // The whole title row folds the band, not only its words.
              <el.Client key="band-title" module="./step-row.tsx" flexGrow={1} props={{ id: FOLD_BUTTON, guide: null, mark: null, title: plan.title, strong: true, muted: false, strike: false, redo: false, pill: null, after: o.folded ? '▾' : '▴', right: null, hover: HOVER, edge: EDGE } satisfies StepRowProps} />
            ) : (
              <Button key={FOLD_BUTTON} plain onPress={() => o.onPress(FOLD_BUTTON)}>
                <Text weight="semibold">
                  {plan.title}
                  <Text color="inactive">{o.folded ? ' ▾' : ' ▴'}</Text>
                </Text>
              </Button>
            )}
            {e.surface === 'desktop' ? null : <Box flexGrow={1} />}
            {o.notice === undefined ? null : <Text size="footnote">{o.notice}</Text>}
            <Button key={OPEN_BUTTON} variant="primary" onPress={() => o.onPress(OPEN_BUTTON)}>
              {t().bandOpen}
            </Button>
          </Box>
        ),
      })}
      {rows.length === 0 ? null : (
        <Box flexDirection="column" paddingX="xs">
          {rows.map(row)}
        </Box>
      )}
    </Box>
  )
}

const nativeDrawer = ($: $, e: Ev, plan: Plan, shelf: readonly Shelved[], drawer: DrawerState, activity: Activity, onPress: (id: string) => void, now: number, width: number) => {
  const el = $.ui.resolve(e)
  const { Box, Text, Button, Link } = el
  const Svg = 'Svg' in el ? el.Svg : null
  // The editor's table may carry the name, but only the desktop app draws Clients.
  const Client = e.surface === 'desktop' && 'Client' in el ? el.Client : null
  const live = isLive(activity)
  // Too narrow for the cards side by side, as the terminal judges it: the list, with no switch.
  const narrow = drawFlow(plan, drawer, { width, now }).cut
  const list = drawer.list === true || narrow
  const axis = cardsOf(plan, drawer)
  const stage = currentLeaf(plan)?.id.split('.')[0] ?? null
  const ring = [drawer.focus, stage, runningLeaves(plan)[0]?.id ?? null].find(id => id !== null && cardButtons(axis).includes(id)) ?? null
  const parked = shelf.filter(s => s.state === 'parked')

  // The pill beside a task that runs with its siblings.
  const pill = () => (
    <Box borderStyle="round" borderColor={EDGE} paddingX="xs" flexShrink={0}>
      <Text size="caption" color="inactive">
        {t().parallel}
      </Text>
    </Box>
  )
  // Links sit at the end of their step's row as small underlined names.
  const links = (ls: readonly string[]) =>
    ls.length === 0 ? null : (
      <Box flexDirection="row" flexWrap="wrap" gap="sm" flexShrink={1}>
        {ls.map(l => {
          const href = hrefOf(l)
          return <Text size="caption">{href === undefined ? `↗ ${linkLabel(l)}` : <Link href={href}>↗ {linkLabel(l)}</Link>}</Text>
        })}
      </Box>
    )
  // A step's row: its mark and title as a plain button (the turning mark, a picture, beside it),
  // the pill, then links and its count at the right edge.
  const line = (s: CardStep, top: boolean, together: boolean) => {
    const spin = s.running && live && !s.parent && Svg !== null
    const strong = s.running || (top && !isDone(s) && s.status !== 'pending')
    // Where the surface draws Clients (the desktop app), the whole row is one: a press anywhere on it counts.
    if (Client !== null) {
      const props: StepRowProps = {
        id: s.id,
        guide: null,
        mark: spin ? null : { text: s.glyph.text, color: s.glyph.color ?? 'text' },
        title: s.title,
        strong,
        muted: isDone(s),
        strike: s.status === 'skipped',
        redo: s.redo,
        pill: together ? t().parallel : null,
        after: null,
        right: s.right === null ? null : { text: s.right.text, color: s.right.color === 'text' || s.right.color === undefined ? 'inactive' : s.right.color },
        hover: HOVER,
        edge: EDGE,
      }
      return (
        <Box flexDirection="row" alignItems="center" gap="xs">
          {spin ? <Svg source={spinSvg(now)} alt={t().running} width={14} height={14} /> : null}
          <Client key={`step-${s.id}`} module="./step-row.tsx" props={props} flexGrow={1} />
          {links(s.links)}
        </Box>
      )
    }
    return (
      <Box flexDirection="row" alignItems="center" gap="xs">
        {spin ? <Svg source={spinSvg(now)} alt={t().running} width={14} height={14} /> : null}
        <Button key={s.id} plain autoFocus={s.id === ring ? true : undefined} onPress={() => onPress(s.id)}>
          <Text weight={strong ? 'semibold' : undefined} color={isDone(s) ? 'inactive' : undefined} strikethrough={s.status === 'skipped' ? true : undefined}>
            {spin ? null : <Text color={s.glyph.color}>{s.glyph.text} </Text>}
            {s.title}
            {s.redo ? ' ↺' : ''}
          </Text>
        </Button>
        {together ? pill() : null}
        <Box flexGrow={1} />
        {links(s.links)}
        {s.right === null ? null : (
          <Box flexShrink={0}>
            <Text size="footnote" tabular color={s.right.color === 'text' ? 'inactive' : s.right.color}>
              {s.right.text}
            </Text>
          </Box>
        )}
      </Box>
    )
  }
  // What shows under a step's row: its detail and note, the picked step's buttons, its open steps.
  const under = (s: CardStep, inset: Space | undefined, nested: boolean): RenderChildren[] => [
    s.detail === undefined ? null : (
      <Box paddingLeft={inset}>
        <Text size="footnote" color="inactive">
          {s.detail}
        </Text>
      </Box>
    ),
    s.note === undefined ? null : (
      <Box paddingLeft={inset}>
        <Text size="footnote" color={s.status === 'blocked' ? 'error' : 'inactive'}>
          {s.note}
        </Text>
      </Box>
    ),
    // The step's own buttons: apart from the text above them, at the right, drawn as the actions to press.
    s.actions.length === 0 ? null : (
      <Box flexDirection="row" gap="xs" justifyContent="flex-end" marginTop="sm">
        {s.actions.map(([id, label]) => (
          <Button key={id} variant="primary" onPress={() => onPress(id)}>
            {label}
          </Button>
        ))}
      </Box>
    ),
    s.children.length === 0 ? null : (
      <Box flexDirection="column" paddingLeft="lg">
        {flat(s.children).map(([c, together]) => step(c, together, nested))}
      </Box>
    ),
  ]
  // Steps that run together stay at their siblings' level, each marked with the pill.
  const flat = (is: readonly CardItem[], together = false): Array<[CardStep, boolean]> => is.flatMap((i): Array<[CardStep, boolean]> => (i.kind === 'step' ? [[i.step, together]] : flat(i.items, true)))
  // A step inside a card: a row that lights under the pointer, with what shows under it.
  const step = (s: CardStep, together: boolean, nested: boolean): RenderChildren => (
    <Box key={`row-${s.id}`} flexDirection="column" gap="xs" paddingY={nested ? undefined : 'xs'} hover={{ backgroundColor: HOVER }}>
      {line(s, false, together)}
      {under(s, 'lg', true)}
    </Box>
  )
  // A hairline between the rows of a card's body.
  const rule = (key: string) => (Svg === null ? null : <Svg key={key} source={ruleSvg()} alt={t().divider} height={1} />)
  // A stage: a rounded card, its title row across the top, then a hairline and its open steps, one hairline between each.
  // The app pads a bordered Box itself, so a fill inside it would float short of the edges: the card has none.
  const card = (s: CardStep) => {
    const body = [...under({ ...s, children: [] }, undefined, false), ...flat(s.children).flatMap(([c, together]) => [rule(`rule-${c.id}`), step(c, together, false)])].filter(x => x !== null)
    return (
      <Box key={`card-${s.id}`} flexDirection="column" flexGrow={1} borderStyle="round" borderColor={s.running ? EDGE_RUN : EDGE} paddingX="sm" paddingY="xs" gap="xs">
        {line(s, true, false)}
        {body}
      </Box>
    )
  }
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
      <Box flexDirection="column" borderStyle="round" borderColor={EDGE} paddingX="sm" paddingY="xs" gap="sm">
        <Text weight="semibold">
          <Text color="success">✓</Text> {t().summary.title}
        </Text>
        {part(t().summary.goal, a.goal)}
        {part(t().summary.result, a.result)}
        {links(a.links)}
      </Box>
    )
  }

  // The list keeps the tree's guides, which show the levels best, monospaced at each row's start so they
  // line up; the rest of a row is in the app's type, and the whole row is pressable where Clients draw.
  const listRows = (): RenderChildren[] => {
    const out: RenderChildren[] = []
    const sub = (guide: string, child: RenderChildren, key: string) => (
      <Box key={key} flexDirection="row">
        <Text mono color="inactive">
          {guide}
        </Text>
        {child}
      </Box>
    )
    if (narrow)
      out.push(
        <Text size="footnote" color="inactive">
          {t().narrow}
        </Text>,
      )
    for (const r of bandRows(plan, activity, plan.nodes.length * 4 + 4, width, now)) {
      if (r.kind === 'more') {
        out.push(
          <Text size="footnote" color="inactive">
            {r.text}
          </Text>,
        )
        continue
      }
      const guide = r.line[0]?.text ?? ''
      // Under a step, the guides go on down past it.
      const on = guide.replace(/├─ $/, '│  ').replace(/└─ $/, '   ')
      if (r.kind === 'detail') {
        out.push(sub(`${guide}`, <Text size="footnote" color="inactive">{r.text}</Text>, `detail-${r.node.id}`))
        continue
      }
      const n = r.node
      const parent = hasChildren(plan.nodes, n.id)
      const spin = n.status === 'in_progress' && !parent && live && Svg !== null
      const glyph = glyphSeg(n)
      const right = parent ? `${counts(plan, n.id)}${r.folded ? ' ▸' : ''}` : n.status === 'in_progress' ? t().running : null
      const props: StepRowProps = {
        id: n.id,
        guide,
        mark: spin ? null : { text: glyph.text, color: glyph.color ?? 'text' },
        title: n.title,
        strong: r.line.some(x => x.bold === true) || n.status === 'in_progress',
        muted: isFinished(n.status) && n.status !== 'needs_check',
        strike: n.status === 'skipped',
        redo: plan.marks?.[n.id] === 'redo',
        pill: n.parallel === true ? t().parallel : null,
        after: null,
        right: right === null ? null : { text: right, color: 'inactive' },
        hover: HOVER,
        edge: EDGE,
      }
      out.push(
        <Box key={`list-${n.id}`} flexDirection="row" alignItems="center" gap="xs">
          {spin ? <Svg source={spinSvg(now)} alt={t().running} width={14} height={14} /> : null}
          {Client !== null ? (
            <Client key={`step-${n.id}`} module="./step-row.tsx" props={props} flexGrow={1} />
          ) : (
            <Button key={n.id} plain autoFocus={n.id === ring ? true : undefined} onPress={() => onPress(n.id)}>
              <Text>
                <Text mono color="inactive">
                  {guide}
                </Text>
                <Text color={glyph.color}>{glyph.text} </Text>
                {n.title}
              </Text>
            </Button>
          )}
        </Box>,
      )
      // A picked step shows its whole detail, its note and its buttons under it.
      if (drawer.pick === n.id && !parent) {
        if (n.detail !== undefined && n.status !== 'in_progress') out.push(sub(`${on}   `, <Text size="footnote" color="inactive">{n.detail}</Text>, `pdetail-${n.id}`))
        const note = noteText(n).trim()
        if (note !== '') out.push(sub(`${on}   `, <Text size="footnote" color={n.status === 'blocked' ? 'error' : 'inactive'}>{note}</Text>, `pnote-${n.id}`))
        // The guides run on beside the buttons, two rows tall to span them, so the tree's lines do not break.
        out.push(
          <Box key={`pact-${n.id}`} flexDirection="row" alignItems="center">
            <Text mono color="inactive">
              {`${on}\n${on}`}
            </Text>
            <Box flexDirection="row" flexGrow={1} gap="xs" justifyContent="flex-end">
              {[...(n.status === 'needs_check' ? [[CONFIRM, t().confirm.replace(/^\[ (.*) \]$/, '$1')] as const] : []), [ASK, t().discuss.replace(/^\[ (.*) \]$/, '$1')] as const].map(([id, label]) => (
                <Button key={id} variant="primary" onPress={() => onPress(id)}>
                  {label}
                </Button>
              ))}
            </Box>
          </Box>,
        )
      }
    }
    const end = axis.find(a => a.kind === 'summary')
    if (end !== undefined && end.kind === 'summary') out.push(<Box marginTop="sm">{summary(end)}</Box>)
    return out
  }
  const tree = list ? listRows() : []
  const flow: RenderChildren[] = []
  if (!list) axis.forEach((a, i) => {
    const first = i === 0
    const last = i === axis.length - 1
    if (a.kind === 'split') {
      // Lines only between cards: none above a first group or under a last one.
      if (!first) flow.push(pic(splitSvg(a.stages.length), `split-${i}`))
      flow.push(
        // Each card keeps its own height: one opened beside a short one leaves no empty box.
        <Box flexDirection="row" alignItems="flex-start">
          {a.stages.map(s => (
            <Box width={`${100 / a.stages.length}%`} flexDirection="column" paddingX="xs">
              {card(s)}
            </Box>
          ))}
        </Box>,
      )
      if (!last) flow.push(pic(joinSvg(a.stages.length), `join-${i}`))
      return
    }
    if (!first && axis[i - 1]?.kind !== 'split') flow.push(pic(trunkSvg(), `trunk-${i}`))
    flow.push(
      <Box flexDirection="column" paddingX="xs">
        {a.kind === 'stage' ? card(a.stage) : summary(a)}
      </Box>,
    )
  })

  const top =
    plan.nodes.length === 0 ? (
      <Text color="inactive">{t().empty}</Text>
    ) : (
      nativeHead($, e, headOf(plan, parked.length, activity), {
        title: (
          <Text size="heading" weight="semibold">
            {plan.title}
          </Text>
        ),
        goalRows: 3,
        tools: (
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
        ),
      })
    )

  return (
    <Box flexDirection="column" gap="md">
      {top}
      {flow.length === 0 ? null : (
        <Box flexDirection="column" gap="xs">
          {flow}
        </Box>
      )}
      {tree.length === 0 ? null : (
        <Box flexDirection="column" paddingX="xs">
          {tree}
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

// A press in the drawer: a Button's, or a row a desktop draws as a Client.
async function pressDrawer($: $, id: string): Promise<void> {
  const at = await read($, demoAtom)
  const frame = at === null ? undefined : demoFrame(at)
  const plan = frame?.board.plan ?? (await read($, planAtom))
  const pick = (await read($, drawerAtom)).pick
  const picked = plan.nodes.find(n => n.id === pick)
  if (id === CONFIRM && picked !== undefined) {
    if (frame !== undefined) return $.ui.toast(t().demo.untouched)
    byPerson.push(`"${picked.title}" (id ${picked.id}) marked completed: the person checked it.`)
    await apply($, { op: 'update', updates: [{ id: picked.id, status: 'completed', note: '' }] })
    await update($, drawerAtom, d => ({ ...d, pick: undefined }))
    return
  }
  // A draft, not a send: the person writes the rest and sends it themselves.
  if (id === ASK && picked !== undefined) {
    const r = await $.prompt.fill({ text: `[${picked.title}] `, mode: 'insert' })
    $.ui.toast(r.isFilled ? t().filled : t().notFilled)
    return
  }
  await update($, drawerAtom, (d): DrawerState =>
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
    const activity = frame?.activity ?? (await read($, activityAtom))
    const parked = (frame?.board.shelf ?? (await read($, shelfAtom))).filter(s => s.state === 'parked').length
    const notice = frame === undefined ? await read($, newerAtom).then(n => (n === null ? undefined : t().newer(n))) : undefined
    const view = drawTree(plan, activity, {
      maxRows: Math.min(e.props.maxRows, BAND_ROWS) - top.length,
      width,
      now,
      open: t().bandOpen,
      folded: frame?.folded ?? (await read($, foldAtom)),
      parked,
      notice,
    })
    const press = (id: string) => {
      if (id === OPEN_BUTTON) void openDrawer($)
      if (id === FOLD_BUTTON) void update($, foldAtom, f => !f)
      if (id === DEMO_NEXT) void demo($, 'next')
      if (id === DEMO_PREV) void demo($, 'prev')
      if (id === DEMO_STOP) void demo($, 'stop')
    }

    // A surface with its own type draws the band natively; a demo's bar stays as lines over it.
    if (e.surface !== 'terminal') {
      const folded = frame?.folded ?? (await read($, foldAtom))
      const budget = Math.min(e.props.maxRows, BAND_ROWS) - top.length - planHead(plan, activity, Math.min(e.props.maxRows, BAND_ROWS) - top.length, width, now, t().bandOpen, parked, folded, notice).length
      return (
        <Box flexDirection="column" gap="xs">
          {top.map(l => row($, e, l, null, press))}
          {nativeBand($, e, plan, activity, { folded, parked, ...(notice === undefined ? {} : { notice }), budget, width, now, onPress: press })}
          {below}
        </Box>
      )
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
    const press = (id: string) => void pressDrawer($, id)

    // A surface with real boxes and its own type draws the drawer natively and scrolls it itself.
    if (e.surface !== 'terminal') {
      page = { top: 0, max: 0, pinned: false }
      return nativeDrawer($, e, plan, frame?.board.shelf ?? (await read($, shelfAtom)), drawer, activity, press, now, e.props.bodyColumns)
    }

    return <Box flexDirection="column">{shown.lines.map(l => row($, e, l, focus, press))}</Box>
  })

  // The band's title row, a Client on the desktop app, was pressed: fold or unfold the band.
  on('ui.message', { component: 'AbovePrompt' }, async ($, e, next) => {
    const d = e.data
    if (typeof d === 'object' && d !== null && 'press' in d && d.press === FOLD_BUTTON) {
      await update($, foldAtom, f => !f)
      return {}
    }
    return next(e)
  })

  // A row the desktop draws as a Client was pressed.
  on('ui.message', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const d = e.data
    if (typeof d === 'object' && d !== null && 'press' in d && typeof d.press === 'string') {
      await pressDrawer($, d.press)
      return {}
    }
    return next(e)
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
