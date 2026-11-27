import type { PluginTheme } from '@getpaseo/plugin'
import { type PluginAgentPanelProps, useAgent, useTabState, useTranslation } from '@getpaseo/plugin/client'
import { ExternalLink, Icon, Loading } from '@getpaseo/plugin/client/ui'
import { Fragment, useMemo } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { z } from 'zod'
import type { Plan } from '../shared/types'
import { type AgentState, type Folds, type Now, type ViewAxis, type ViewItem, type ViewStep, axisOf, headOf, nowOf } from '../shared/view'
import { useBoard } from './boards'
import { MARK_SIZE, StatusMark } from './mark'
import { messages } from './messages'

// The plan as a card flowchart, picked from three mockups on 2026-11-27: stages as cards on one
// axis, the stage Claude is on open with its tasks, stages that run together side by side.
// The rules (docs/design-reference/paseo/README.md) and tokens (paseo/DESIGN.md) are written down.

const foldsSchema = z.record(z.string(), z.boolean())
const useMessages = () => useTranslation(messages)
type T = ReturnType<typeof useMessages>['t']
// More stages side by side than this, or a narrow layout, stacks them.
const SIDE_BY_SIDE = 3
// Rows a finger presses reach 44 points with their slop.
const PRESS_SLOP = { top: 6, bottom: 6, left: 4, right: 4 }

type Styles = ReturnType<typeof stylesOf>
type Ctx = { theme: PluginTheme; s: Styles; t: T; live: boolean; compact: boolean; toggle: (id: string, open: boolean) => void }

const stylesOf = (theme: PluginTheme, compact: boolean) => {
  const c = theme.colors
  return {
    screen: { flex: 1, backgroundColor: c.surface0 },
    content: { padding: compact ? 12 : 16, gap: 0 },
    title: { color: c.foreground, fontSize: 15, fontWeight: '700' as const },
    goal: { color: c.foregroundMuted, fontSize: 13, marginTop: 2 },
    text: { color: c.foreground, fontSize: 13, lineHeight: 19 },
    strong: { color: c.foreground, fontSize: 13, lineHeight: 19, fontWeight: '600' as const },
    dim: { color: c.foregroundMuted, fontSize: 13, lineHeight: 19 },
    small: { color: c.foregroundMuted, fontSize: 12, lineHeight: 17 },
    link: { color: c.accent, fontSize: 12, lineHeight: 17 },
    head: { paddingBottom: 12, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: c.border },
    track: { flex: 1, height: 5, borderRadius: 3, backgroundColor: c.surface2, overflow: 'hidden' as const },
    fill: { height: 5, backgroundColor: c.statusSuccess },
    line: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 8 },
    card: { backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    runningCard: { borderColor: c.foregroundMuted },
    row: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, paddingVertical: 5 },
    inner: { borderTopWidth: 1, borderTopColor: c.border, marginTop: 4, paddingTop: 2 },
    indent: { paddingLeft: MARK_SIZE + 8 },
    together: { borderLeftWidth: 2, borderLeftColor: c.surface2, paddingLeft: 8, marginVertical: 2 },
    stem: { width: 1, height: 12, backgroundColor: c.border, alignSelf: 'center' as const },
    tag: { color: c.foregroundMuted, fontSize: 11, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 6, overflow: 'hidden' as const },
    expected: { borderWidth: 1, borderStyle: 'dashed' as const, borderColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  }
}

const isUrl = (link: string): boolean => /^https?:\/\//.test(link)
const linkLabel = (link: string): string => {
  const pr = /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/.exec(link)
  if (pr !== null) return `PR #${pr[1]}`
  return isUrl(link) ? link.replace(/^https?:\/\/(www\.)?/, '') : (link.split('/').pop() ?? link)
}

function Links({ links, ctx }: { links: readonly string[]; ctx: Ctx }) {
  if (links.length === 0) return null
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2, paddingBottom: 4, ...ctx.s.indent }}>
      {links.map(l =>
        isUrl(l) ? (
          <ExternalLink key={l} href={l}>
            <Text style={ctx.s.link} numberOfLines={1}>{linkLabel(l)}</Text>
          </ExternalLink>
        ) : (
          // shortcut: a file path shows its name only; open it in a file panel once the plugin needs to.
          <Text key={l} style={ctx.s.small} numberOfLines={1}>{linkLabel(l)}</Text>
        ),
      )}
    </View>
  )
}

// A step's row: its mark, its title with what it does and its note, and on the right its count or that it runs.
function StepRow({ step, ctx }: { step: ViewStep; ctx: Ctx }) {
  const { s, t, theme } = ctx
  const running = step.status === 'in_progress'
  const done = step.status === 'completed' || step.status === 'skipped'
  const right = step.count !== null ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Text style={s.small}>{step.count}</Text>
      <Icon name={step.open ? 'ChevronDown' : 'ChevronRight'} size={14} color={theme.colors.foregroundMuted} />
    </View>
  ) : running ? (
    <Text style={[s.small, { color: ctx.live ? theme.colors.foreground : theme.colors.statusWarning }]}>{ctx.live ? t('running') : t('waiting')}</Text>
  ) : null
  const body = (
    <View style={s.row}>
      <StatusMark status={step.status} live={ctx.live} theme={theme} />
      <View style={{ flex: 1 }}>
        <Text style={running ? s.strong : done ? s.dim : s.text}>{step.title}</Text>
        {step.detail !== undefined ? <Text style={s.small}>{step.detail}</Text> : null}
        {step.note !== undefined ? <Text style={[s.small, step.status === 'blocked' ? { color: theme.colors.statusDanger } : null]}>{step.note}</Text> : null}
      </View>
      {right}
    </View>
  )
  const label = `${step.title}, ${t(`status.${step.status}`)}`
  if (!step.parent) return <View accessible accessibilityLabel={label}>{body}</View>

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${t(step.open ? 'fold' : 'unfold', { title: step.title })}`}
      accessibilityState={{ expanded: step.open }}
      hitSlop={PRESS_SLOP}
      onPress={() => ctx.toggle(step.id, step.open)}
      style={({ pressed }) => ({ minHeight: 32, opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  )
}

function Items({ items, ctx }: { items: readonly ViewItem[]; ctx: Ctx }) {
  return (
    <>
      {items.map((i, k) =>
        i.kind === 'step' ? (
          <View key={i.step.id}>
            <StepRow step={i.step} ctx={ctx} />
            <Links links={i.step.links} ctx={ctx} />
            {i.step.children.length > 0 ? (
              <View style={ctx.s.indent}>
                <Items items={i.step.children} ctx={ctx} />
              </View>
            ) : null}
          </View>
        ) : (
          <View key={`together-${k}`} style={ctx.s.together}>
            <Text style={ctx.s.small}>{ctx.t('together')}</Text>
            <Items items={i.items} ctx={ctx} />
          </View>
        ),
      )}
    </>
  )
}

function StageCard({ stage, ctx }: { stage: ViewStep; ctx: Ctx }) {
  return (
    <View style={[ctx.s.card, stage.status === 'in_progress' ? ctx.s.runningCard : null]}>
      <StepRow step={stage} ctx={ctx} />
      <Links links={stage.links} ctx={ctx} />
      {stage.children.length > 0 ? (
        <View style={ctx.s.inner}>
          <Items items={stage.children} ctx={ctx} />
        </View>
      ) : null}
    </View>
  )
}

// Stages that run together: side by side under one bracket, or stacked with a label on a narrow screen.
function Split({ stages, ctx }: { stages: readonly ViewStep[]; ctx: Ctx }) {
  const c = ctx.theme.colors
  if (ctx.compact || stages.length > SIDE_BY_SIDE) {
    return (
      <View style={ctx.s.together}>
        <Text style={ctx.s.small}>{ctx.t('together')}</Text>
        <View style={{ gap: 8, marginTop: 4 }}>
          {stages.map(st => <StageCard key={st.id} stage={st} ctx={ctx} />)}
        </View>
      </View>
    )
  }
  const edge = `${50 / stages.length}%` as const
  const bracket = { height: 10, marginHorizontal: edge, borderColor: c.border, borderLeftWidth: 1, borderRightWidth: 1 }

  return (
    <View accessibilityLabel={ctx.t('together')}>
      <View style={[bracket, { borderTopWidth: 1, borderTopLeftRadius: 6, borderTopRightRadius: 6 }]} />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        {stages.map(st => (
          <View key={st.id} style={{ flex: 1 }}>
            <StageCard stage={st} ctx={ctx} />
          </View>
        ))}
      </View>
      <View style={[bracket, { borderBottomWidth: 1, borderBottomLeftRadius: 6, borderBottomRightRadius: 6 }]} />
    </View>
  )
}

function Axis({ axis, ctx }: { axis: readonly ViewAxis[]; ctx: Ctx }) {
  const { s, t, theme } = ctx
  return (
    <>
      {axis.map((a, k) => (
        <Fragment key={a.kind === 'stage' ? a.stage.id : a.kind === 'split' ? `split-${a.stages[0]?.id ?? k}` : `${a.kind}-${k}`}>
          {k > 0 ? <View style={s.stem} /> : null}
          {a.kind === 'stage' ? <StageCard stage={a.stage} ctx={ctx} /> : null}
          {a.kind === 'split' ? <Split stages={a.stages} ctx={ctx} /> : null}
          {a.kind === 'summary' ? (
            <View style={[s.card, { borderColor: theme.colors.statusSuccess }]}>
              <View style={s.row}>
                <StatusMark status="completed" live={false} theme={theme} />
                <View style={{ flex: 1 }}>
                  <Text style={s.strong}>{t('finished')}</Text>
                  <Text style={s.text}>{a.result}</Text>
                </View>
              </View>
              <Links links={a.links} ctx={ctx} />
            </View>
          ) : null}
          {a.kind === 'expected' ? (
            <View style={[s.expected, { flexDirection: 'row', gap: 8, alignItems: 'center' }]}>
              <Text style={[s.dim, { flex: 1 }]}>{a.title}</Text>
              <Text style={s.tag}>{t('expected')}</Text>
            </View>
          ) : null}
        </Fragment>
      ))}
    </>
  )
}

const nowText = (now: Now, t: T): string => {
  if (now.kind === 'done') return t('now.done')
  const step = now.step
  if (now.kind === 'running') return step === undefined ? t('now.working') : t('now.running', { step })
  if (now.kind === 'turn') return step === undefined ? t('now.turnPlain') : t('now.turn', { step })
  if (now.kind === 'permission') return step === undefined ? t('now.permissionPlain') : t('now.permission', { step })
  return step === undefined ? t('now.errorPlain') : t('now.error', { step })
}

function NowLine({ now, ctx }: { now: Now; ctx: Ctx }) {
  const c = ctx.theme.colors
  const mark =
    now.kind === 'running' ? <StatusMark status="in_progress" live theme={ctx.theme} />
    : now.kind === 'done' ? <StatusMark status="completed" live={false} theme={ctx.theme} />
    : now.kind === 'error' ? <StatusMark status="blocked" live={false} theme={ctx.theme} />
    : <Icon name={now.kind === 'permission' ? 'ShieldAlert' : 'CircleDot'} size={MARK_SIZE} color={c.statusWarning} />
  const color = now.kind === 'turn' || now.kind === 'permission' ? c.statusWarning : now.kind === 'error' ? c.statusDanger : c.foreground

  return (
    <View style={ctx.s.line} accessibilityLiveRegion="polite">
      {mark}
      <Text style={[ctx.s.small, { color, flex: 1 }]} numberOfLines={2}>{nowText(now, ctx.t)}</Text>
    </View>
  )
}

function Head({ plan, now, ctx }: { plan: Plan; now: Now; ctx: Ctx }) {
  const { s, t } = ctx
  const h = headOf(plan)
  return (
    <View style={s.head}>
      <Text style={s.title} accessibilityRole="header">{h.title}</Text>
      {h.goal !== undefined ? <Text style={s.goal}>{h.goal}</Text> : null}
      <View style={s.line} accessible accessibilityRole="progressbar" accessibilityLabel={t('progressLabel', { done: h.done, total: h.total })} accessibilityValue={{ min: 0, max: h.total, now: h.done }}>
        <View style={s.track}>
          <View style={[s.fill, { width: `${h.pct}%` }]} />
        </View>
        <Text style={s.small}>{t('progress', { done: h.done, total: h.total, pct: h.pct })}</Text>
      </View>
      <NowLine now={now} ctx={ctx} />
      {h.checks > 0 ? <Text style={[s.small, { color: ctx.theme.colors.statusWarning, marginTop: 4 }]}>{t('checks', { count: h.checks })}</Text> : null}
    </View>
  )
}

export function PlanPanel({ theme, layout, params, tab }: PluginAgentPanelProps) {
  const { t } = useMessages()
  const q = useBoard(params.agentId)
  const [folds, setFolds] = useTabState<Folds>(tab, foldsSchema, {})
  const status = useAgent(params.agentId, a => a.status) ?? 'idle'
  const attentionReason = useAgent(params.agentId, a => a.attentionReason) ?? null
  const agent: AgentState = { status, attentionReason }
  const s = useMemo(() => stylesOf(theme, layout.compact), [theme, layout.compact])
  const plan = q.data?.plan ?? null
  const now = plan === null ? null : nowOf(plan, agent)
  const ctx: Ctx = {
    theme,
    s,
    t,
    live: now?.kind === 'running',
    compact: layout.compact,
    toggle: (id, open) => setFolds({ ...folds, [id]: !open }),
  }

  if (q.isPending) return <Loading />

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {q.isError ? (
        <View style={{ gap: 8 }}>
          <Text style={s.text}>{t('failed')}</Text>
          <Pressable accessibilityRole="button" hitSlop={PRESS_SLOP} onPress={() => void q.refetch()}>
            <Text style={s.link}>{t('retry')}</Text>
          </Pressable>
        </View>
      ) : plan === null || now === null ? (
        <Text style={s.dim}>{t('empty')}</Text>
      ) : (
        <>
          <Head plan={plan} now={now} ctx={ctx} />
          <Axis axis={axisOf(plan, folds)} ctx={ctx} />
        </>
      )}
    </ScrollView>
  )
}
