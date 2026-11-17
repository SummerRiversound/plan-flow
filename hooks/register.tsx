// Wiring only: hook events in, the pure modules beside this file decide, state out.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, RenderChildren, Timer } from 'claude-code'
import type { ActivityEvent } from './activity'
import { idleActivity, step } from './activity'
import type { DemoAt } from './scenarios'
import { DEMO_NEXT, DEMO_PREV, DEMO_STOP, scenarios, demoFind, demoFrame, demoList, demoStep } from './scenarios'
import { spinSvg, sweepSvg } from './gui'
import type { StepRowProps } from './step-row'
import type { Line, Row, Seg, Shown } from './view'
import { BOXED, FOLD_BUTTON, FRAME_MS, OPEN_BUTTON, PRIMARY, REFRESH, badgeOf, bandStack, drawerRows, fitLine, mineOf, titleOf } from './view'
import { cells } from './width'
import type { Activity } from '../types'
import type { Lines } from './sessions'
import { othersOf, sessionRows, stateOf } from './sessions'
import { pickLanguage, setLanguage, t } from './i18n'
import type { Heard, Kept } from './chapters'
import { backgroundDone, emptyKept, hear, isBackground, receiptOf, rewritten, shown as shownOf } from './chapters'
import { MAX_STORY, WRITER_SYSTEM, parseBoard, storyOf, writerPrompt } from './writer'
import { PERSON } from './lines'
import { STATUS_PROMPT, parseStatus } from './status'
import type { Newer, ReleaseCheck } from './version'
import { manifestUrl, newerVersion, runningVersion, staleRelease } from './version'

const PANE = 'plan-flow'
// Boards and switches are small and a person may keep twenty sessions open for days, so many are
// kept; call logs are large (the store holds 4 MiB in all), so only the most recent sessions keep one.
export const KEPT_BOARDS = 100
const KEPT_CALL_LOGS = 20
// One line per session for the drawer's list of every session; the person keeps about twenty open.
const KEPT_LINES = 20
// How long a desktop client holds a notification before raising it; it drops it if the person
// comes back to the session first.
export const NOTIFY_AFTER_MS = 60_000
// While the drawer is open it is drawn again this often, for the other sessions' lines.
const OTHERS_REDRAW_MS = 30_000

const activityAtom = atom({ plugin: 'plan-flow', key: 'activity' } as const, idleActivity())
const askedAtom = atom({ plugin: 'plan-flow', key: 'asked' } as const, false)
const demoAtom = atom({ plugin: 'plan-flow', key: 'demo' } as const, null as DemoAt | null)
const paneAtom = atom({ plugin: 'plan-flow', key: 'pane' } as const, false)
const foldAtom = atom({ plugin: 'plan-flow', key: 'fold' } as const, false)
const awayAtom = atom({ plugin: 'plan-flow', key: 'away' } as const, false)
const newerAtom = atom({ plugin: 'plan-flow', key: 'newer' } as const, null as Newer | null)
const keptAtom = atom({ plugin: 'plan-flow', key: 'chapters' } as const, emptyKept())

type $ = EngineInterface
type Ev = Parameters<$['ui']['resolve']>[0]

// A neutral grey at low opacity for the desktop app and the editor: one value reads on the light
// and the dark theme, where no theme key gives a faint edge or a pointer highlight.
const HOVER = '#8080801a'
const EDGE = '#80808033'
// The timeline's line and the your-turn bar beside their rows.
// shortcut: one unit of the app's box width, not seen on the desktop app yet; make it thinner if it reads heavy there.
const LINE_WIDTH = 1
// One call the mod made to a model for the board, kept so a board that stopped changing can be explained.
type Used = { input: number; cacheRead: number; cacheWrite: number; output: number }
type Call = { at: number; call: 'write'; ms: number; result: 'answered' | 'failed' | 'timed out'; reason?: string; usage?: Used; text?: string }
// The start of a model's answer kept with its call, enough to read back what it wrote.
const KEPT_TEXT = 600
type Calls = Record<string, { calls: Call[]; savedAt: number }>
const KEPT_CALLS = 50

// Draws one line of pieces on the terminal; a piece with a `button` becomes that Button, framed
// where the button is one of BOXED, and a piece with an `href` a Link.
const row = ($: $, e: Ev, line: Line, onPress: (id: string) => void) => {
  const { Box, Text, Button, Link } = $.ui.resolve(e)
  const segs = (ss: Line) =>
    ss.map(s => (
      <Text mono color={s.color} backgroundColor={s.bg} bold={s.bold === true ? true : undefined} dimColor={s.dim === true ? true : undefined}>
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
          <Button key={p.id} plain={BOXED.has(p.id ?? '') ? undefined : true} variant={PRIMARY.has(p.id ?? '') ? 'primary' : undefined} onPress={() => onPress(p.id ?? '')}>
            {segs(p.segs)}
          </Button>
        ),
      )}
    </Box>
  )
}
const termRow = ($: $, e: Ev, r: Row, onPress: (id: string) => void) => row($, e, r.indent === 0 ? r.line : [{ text: ' '.repeat(r.indent) }, ...r.line], onPress)

// A small filled label in the app's type: a drawer tag, the band's badge.
const tagBox = ($: $, e: Ev, key: string, text: string, fill: string | undefined, color: string | undefined, before?: RenderChildren) => {
  const { Box, Text } = $.ui.resolve(e)
  // A fill, not a border: the app pads a bordered box itself, which would make the tag taller than the row.
  return (
    <Box key={key} flexDirection="row" alignItems="center" gap="xs" backgroundColor={fill ?? EDGE} paddingX="xs" flexShrink={0}>
      {before ?? null}
      <Text size="caption" weight={fill === undefined ? undefined : 'semibold'} color={color}>
        {text}
      </Text>
    </Box>
  )
}

// The same rows set in the app's own type (the desktop app, the editor): the goal and everything
// under a chapter in footnote size, links as small underlined names, tags as small filled labels,
// the turning mark and the swept title pictures that move by themselves; `oneGoalRow` cuts the goal
// to a row, as a folded band shows it. A title row is drawn by its view, the terminal's rule and
// blank rows become space between chapters, and the note's rows a framed box. Rows with an edge
// (the drawer's timeline, the band's your-turn bar) sit beside a line drawn as a thin filled box,
// one run of them with no space between, so the line runs on; the current chapter gets a faint fill.
const nativeRows = ($: $, e: Ev, rows: readonly Row[], now: number, oneGoalRow = false): RenderChildren[] => {
  const el = $.ui.resolve(e)
  const { Box, Text, Link } = el
  const Svg = 'Svg' in el ? el.Svg : null
  const piece = (s: Seg, i: number) => {
    const words = s.href === undefined ? s.text : <Link href={s.href}>{s.text}</Link>
    return (
      <Text key={String(i)} color={s.color} weight={s.bold === true ? 'semibold' : undefined} dimColor={s.dim === true ? true : undefined}>
        {words}
      </Text>
    )
  }
  const spin = (key: string) => (Svg === null ? null : <Svg key={key} source={spinSvg(now)} alt={t().running} width={14} height={14} />)
  // A row's pieces in order: plain ones run together in one Text, pictures and tags between them.
  const pieces = (r: Row, line: Line): RenderChildren[] => {
    const size = r.kind === 'chapter' || r.kind === 'rail' ? undefined : r.kind === 'links' ? 'caption' : 'footnote'
    const out: RenderChildren[] = []
    let run: Seg[] = []
    const flush = () => {
      if (run.length > 0)
        out.push(
          <Text key={`t${out.length}`} size={size} color={r.kind === 'goal' ? 'inactive' : undefined} wrap={r.kind === 'goal' && oneGoalRow ? 'truncate-end' : undefined}>
            {run.map(piece)}
          </Text>,
        )
      run = []
    }
    for (let i = 0; i < line.length; i++) {
      const s = line[i] as Seg
      if (s.live === 'mark' && Svg !== null) {
        flush()
        out.push(spin(`m${i}`))
      } else if (s.live === 'title' && Svg !== null) {
        let words = s.text
        while (line[i + 1]?.live === 'title') words += line[++i]?.text ?? ''
        flush()
        const pic = sweepSvg(words, cells(words), now)
        out.push(<Svg key={`s${i}`} source={pic.source} alt={words} width={pic.width} height={pic.height} />)
      } else if (s.tag === true) {
        flush()
        out.push(tagBox($, e, `g${i}`, s.text.trim(), s.bg, s.bg === undefined ? 'inactive' : s.color))
      } else run.push(s)
    }
    flush()
    return out
  }
  // The line beside a row with an edge: a chapter's mark at its dot, else a thin filled box down the row.
  const edgeOf = (s: Seg | undefined, key: string): RenderChildren => {
    const mark = s?.live === 'mark' || /^[●◐○]$/.test(s?.text ?? '')
    return (
      <Box key={key} width={2} flexShrink={0} flexDirection="column" alignItems="center">
        {mark ? (s?.live === 'mark' ? spin('spin') : <Text color={s?.color}>{s?.text}</Text>) : (s?.text.trim() ?? '') === '' ? null : <Box width={LINE_WIDTH} flexGrow={1} backgroundColor={s?.color === 'inactive' ? EDGE : s?.color} />}
      </Box>
    )
  }
  const one = (r: Row, i: number, gap: boolean): RenderChildren => {
    // Past the edge, the spaces that set the text off it on a terminal.
    const rest = r.edge === true ? r.line.slice(1) : r.line
    const start = r.edge === true ? rest.findIndex(s => s.text.trim() !== '' || s.tag === true) : 0
    const line = start < 0 ? [] : rest.slice(start)
    const body = (
      <Box key={`${r.kind}-${i}`} flexDirection="row" alignItems="center" gap="xs" flexGrow={1} paddingLeft={r.edge === true ? undefined : r.indent} paddingY={r.edge === true && line.length === 0 ? 'xs' : undefined} marginTop={gap ? 'sm' : undefined} backgroundColor={r.tint === true ? HOVER : undefined}>
        {pieces(r, line)}
      </Box>
    )
    if (r.edge !== true) return body
    return (
      <Box key={`edge-${i}`} flexDirection="row" gap="xs">
        {edgeOf(r.line[0], `e${i}`)}
        {body}
      </Box>
    )
  }
  const out: RenderChildren[] = []
  const note: Row[] = []
  let run: RenderChildren[] = []
  const endRun = () => {
    if (run.length > 0) out.push(<Box key={`run-${out.length}`} flexDirection="column">{run}</Box>)
    run = []
  }
  let gap = false
  rows.forEach((r, i) => {
    if (r.kind === 'note') return void note.push(r)
    if (r.kind === 'title') return
    if (r.edge === true) return void run.push(one(r, i, false))
    endRun()
    if (r.kind === 'rule' || r.kind === 'blank') return void (gap = true)
    out.push(one(r, i, gap && (r.kind === 'chapter' || r.kind === 'heading')))
    gap = false
  })
  endRun()
  if (note.length > 0)
    out.unshift(
      <Box key="note" flexDirection="column" borderStyle="round" borderColor={EDGE} paddingX="sm" paddingY="xs" gap="xs">
        {note.map((r, i) => one(r, i, false))}
      </Box>,
    )

  return out
}

// The band above the prompt on a surface with its own type: the title the fold button (a Client
// on the desktop app, so the whole row counts), the drawer's primary button at the right, then the rows.
const nativeBand = ($: $, e: Ev, s: Shown, rows: readonly Row[], o: { activity: Activity; folded: boolean; notice?: string; now: number; onPress: (id: string) => void }) => {
  const el = $.ui.resolve(e)
  const { Box, Text, Button } = el
  const title = titleOf(s.board)
  const note = rows.filter(r => r.kind === 'note')
  // The badge as a small filled tag: the permission colour for your turn, green when done, faint with the turning circle while working.
  const b: Seg | undefined = badgeOf(s, o.activity, o.now)
  const Svg = 'Svg' in el ? el.Svg : null
  const badge =
    b === undefined
      ? null
      : b.live === 'mark'
        ? tagBox($, e, 'badge', t().badge.working, undefined, 'text', Svg === null ? undefined : <Svg source={spinSvg(o.now)} alt={t().running} width={12} height={12} />)
        : tagBox($, e, 'badge', b.text.trim(), b.bg ?? b.color, 'inverseText')

  return (
    <Box flexDirection="column" gap="xs" paddingX="xs">
      {nativeRows($, e, note, o.now)}
      <Box flexDirection="row" alignItems="center" gap="xs">
        {badge}
        {e.surface === 'desktop' && 'Client' in el ? (
          <el.Client key="band-title" module="./step-row.tsx" flexGrow={1} props={{ id: FOLD_BUTTON, title, after: o.folded ? '▾' : '▴', hover: HOVER } satisfies StepRowProps} />
        ) : (
          <Button key={FOLD_BUTTON} plain onPress={() => o.onPress(FOLD_BUTTON)}>
            <Text weight="semibold">
              {title}
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
      {nativeRows($, e, rows.filter(r => r.kind !== 'note'), o.now, o.folded)}
    </Box>
  )
}

// The drawer on a surface with its own type: a heading title with ↻ at its right, then the rows;
// the app scrolls it itself.
const nativeDrawer = ($: $, e: Ev, s: Shown, rows: readonly Row[], now: number, onPress: (id: string) => void) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  const empty = s.board.chapters.length === 0

  return (
    <Box flexDirection="column" gap="xs" paddingX="xs">
      {empty ? null : (
        <Box flexDirection="row" alignItems="center" gap="xs">
          <Text size="heading" weight="semibold">
            {titleOf(s.board)}
          </Text>
          <Box flexGrow={1} />
          <Button key={REFRESH} onPress={() => onPress(REFRESH)}>
            ↻
          </Button>
        </Box>
      )}
      {nativeRows($, e, rows, now)}
    </Box>
  )
}

async function visible($: $, autoShow: boolean): Promise<boolean> {
  return enabled && (autoShow || (await read($, askedAtom)))
}

async function act($: $, ev: ActivityEvent): Promise<void> {
  await update($, activityAtom, a => step(a, ev))
  await syncLine($)
}

// This session's line for the others, written only when its title, state or count changed.
let lastLine = ''
async function syncLine($: $): Promise<void> {
  if (!enabled) return
  const s = shownOf(await read($, keptAtom))
  const title = titleOf(s.board)
  if (title === '') return
  const line = { title, ...stateOf(s, await read($, activityAtom)) }
  const key = JSON.stringify(line)
  if (key === lastLine) return
  lastLine = key
  await editLines($, async (all, sid) => (all[sid] = { ...line, savedAt: await $.clock.now() }))
}
// shortcut: each session rewrites the shared map, so two writing at once can drop the other's change
// until it next changes; give each session its own key if that shows.
async function editLines($: $, edit: (all: Lines, sid: string) => Promise<unknown>): Promise<void> {
  await inTurn(async () => {
    const sid = await $.session.id()
    const all = ((await $.store.get('sessions')) ?? {}) as Lines
    await edit(all, sid)
    await $.store.set('sessions', newest(all, KEPT_LINES))
  }).catch(() => undefined)
}

// What waits on the person and was already told, so the same items never notify twice; the
// notification still out, taken back when the person sends a request here.
let told = new Set<string>()
let notice: Promise<unknown> | null = null
const noticeKey = async ($: $) => `mine-${await $.session.id()}`
async function notifyMine($: $): Promise<void> {
  if (!enabled) return
  const s = shownOf(await read($, keptAtom))
  const mine = mineOf(s)
  const fresh = mine.filter(m => !told.has(m))
  for (const m of mine) told.add(m)
  if (fresh[0] === undefined) return
  notice = $.ui.notify(fresh[0], { title: titleOf(s.board), key: await noticeKey($), delayMs: NOTIFY_AFTER_MS, untilBack: true }).catch(() => undefined)
}
async function takeBackNotice($: $): Promise<void> {
  const out = notice
  notice = null
  if (out === null) return
  await out
  await $.ui.cancelNotify(await noticeKey($)).catch(() => undefined)
}

let ticker: Timer | null = null
// The band or drawer was drawn on a terminal, where the running chapter's mark turns by redrawing.
// shortcut: one flag for the session, so a desktop viewer beside a terminal redraws as often; split per surface if that costs.
let onTerminal = false

// While a turn runs: each frame on a terminal, for the turning mark; the app turns its own picture.
function tick($: $, running: boolean): void {
  if (running && onTerminal && ticker === null) ticker = $.clock.every(FRAME_MS, () => $.ui.invalidate('ui.render'))
  if (!running && ticker !== null) {
    ticker.cancel()
    ticker = null
  }
}

const newest = <T extends { savedAt: number },>(all: Record<string, T>, kept = KEPT_BOARDS): Record<string, T> =>
  Object.fromEntries(
    Object.entries(all)
      .sort((a, b) => b[1].savedAt - a[1].savedAt)
      .slice(0, kept),
  )

// The session's recent model calls, beside its board; never shown to Claude.
async function record($: $, c: Call): Promise<void> {
  await inTurn(async () => {
    const sid = await $.session.id()
    const log = ((await $.store.get('calls')) ?? {}) as Calls
    log[sid] = { calls: [...(log[sid]?.calls ?? []), c].slice(-KEPT_CALLS), savedAt: c.at + c.ms }
    await $.store.set('calls', newest(log, KEPT_CALL_LOGS))
  }).catch(() => undefined)
}

// Writes to the store take turns, so one does not write over what another just wrote.
let turns: Promise<unknown> = Promise.resolve()
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = turns.then(fn)
  turns = run.catch(() => undefined)
  return run
}

// Opens the drawer; the band steps aside while it is on screen.
let othersTicker: Timer | null = null
async function openDrawer($: $): Promise<boolean> {
  await update($, askedAtom, () => true)
  const opened = await $.ui.open({ id: PANE, title: t().pane, focus: true, closeOnEscape: true })
  await update($, paneAtom, () => true)
  othersTicker ??= $.clock.every(OTHERS_REDRAW_MS, () => $.ui.invalidate('ui.render'))

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
  if (to === null) return t().demo.ended
  const s = scenarios()[to.scenario]

  return t().demo.at(to.scenario + 1, scenarios().length, s?.title ?? '', demoFrame(to)?.label ?? '', demoList())
}

// A press in the drawer: ↻ has the writer read the whole session again now, not after the gap.
async function pressDrawer($: $, id: string): Promise<void> {
  if (id !== REFRESH) return
  if ((await read($, demoAtom)) !== null) return $.ui.toast(t().demo.untouched)
  toastAfterWrite = true
  writeSoon($, true)
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

// The main turn ran a tool: its answer comes after work, so the board may have moved.
// shortcut: module variables, lost on a reload of the mod (the board itself is kept); move them to
// $.state if a reload mid-turn drops too much.
let worked = false
// Whether plan-flow runs in this session (`/flow on`, `/flow off`, kept per session).
let enabled = true
type Switches = Record<string, { on: boolean; savedAt: number }>

async function setEnabled($: $, on: boolean): Promise<void> {
  enabled = on
  const sid = await $.session.id()
  const all = ((await $.store.get('enabled')) ?? {}) as Switches
  all[sid] = { on, savedAt: await $.clock.now() }
  await $.store.set('enabled', newest(all))
  lastLine = ''
  if (on) await syncLine($)
  else await editLines($, async (lines, id) => delete lines[id])
}

// What `/flow status` says: on or off here, the default, and what the kept calls used.
async function status($: $, startOn: boolean, block: boolean): Promise<string> {
  const log = ((await $.store.get('calls')) ?? {}) as Calls
  const writes = (log[await $.session.id()]?.calls ?? []).filter(c => c.call === 'write')
  const u = (k: keyof Used) => writes.reduce((n, c) => n + (c.usage?.[k] ?? 0), 0)

  return t().status(enabled, startOn, block, KEPT_CALLS, { count: writes.length, input: u('input') + u('cacheWrite'), cacheRead: u('cacheRead'), output: u('output') })
}

const used = (u: ModelUsage | undefined): { usage?: Used } =>
  u === undefined ? {} : { usage: { input: u.input_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens } }

// Why a model call came back without an answer, as the call log keeps it.
const whyNot = (r: { reason: string; status?: number | null; error?: string }): string => [r.reason, r.status ?? undefined, r.error].filter(x => x !== undefined).join(' ')

// The board's writer. Sonnet rereads the whole session and writes the board again: at an answer that
// followed work, once three minutes pass with nothing new after an answer, and when the person presses
// ↻. Rules add what is certain in between (chapters.ts). One write at a time; a write wanted meanwhile follows it.
const WRITER_MODEL = 'sonnet'
const WRITE_TIMEOUT_MS = 120_000
export const IDLE_WRITE_MS = 3 * 60_000
// Quick back-and-forth answers do not each pay for a write: writes start at least this far apart.
export const WRITE_GAP_MS = 30_000
let writing: Promise<void> | null = null
let writeAgain = false
let held: Timer | null = null
let lastWrite = Number.NEGATIVE_INFINITY
// The title last sent to the tab.
let sentTitle = ''
let idleTimer: Timer | null = null
// Everything heard counts; a write after three idle minutes is skipped when nothing came since the last.
let heardCount = 0
let writtenCount = -1
// ↻ was pressed: the next write that ends says how it went.
let toastAfterWrite = false

type SavedKept = Record<string, { kept: Kept; savedAt: number }>
async function hearRule($: $, h: Heard): Promise<void> {
  await update($, keptAtom, k => hear(k, h))
  await saveKept($)
}
async function saveKept($: $): Promise<void> {
  const sid = await $.session.id()
  const all = ((await $.store.get('chapters')) ?? {}) as SavedKept
  all[sid] = { kept: await read($, keptAtom), savedAt: await $.clock.now() }
  await $.store.set('chapters', newest(all)).catch(() => undefined)
  await syncLine($)
}

// One write; whether the board was written.
async function writeOnce($: $): Promise<boolean> {
  const cut = (await read($, keptAtom)).seq
  const counted = heardCount
  const story = storyOf(await $.session.messages(), MAX_STORY)
  if (story === '') return false
  const at = await $.clock.now()
  lastWrite = at
  const r = await $.model
    .complete({ model: WRITER_MODEL, system: [{ text: WRITER_SYSTEM, cache: true }], prompt: writerPrompt(story), maxTokens: 8000, timeoutMs: WRITE_TIMEOUT_MS })
    .catch((err: unknown) => ({ isAnswered: false as const, reason: 'threw', error: String(err).slice(0, 200) }))
  const ms = (await $.clock.now()) - at
  if (!r.isAnswered) {
    await record($, { at, call: 'write', ms, result: r.reason === 'aborted' && ms >= WRITE_TIMEOUT_MS ? 'timed out' : 'failed', reason: whyNot(r), ...used('usage' in r ? r.usage : undefined) })
    return false
  }
  const board = parseBoard(r.text)
  if (board === undefined) {
    await record($, { at, call: 'write', ms, result: 'failed', reason: 'not a board', ...used(r.usage), text: r.text.slice(0, KEPT_TEXT) })
    return false
  }
  writtenCount = counted
  await update($, keptAtom, k => rewritten(k, board, cut))
  await saveKept($)
  await notifyMine($)
  await record($, { at, call: 'write', ms, result: 'answered', ...used(r.usage), text: r.text.slice(0, KEPT_TEXT) })
  return true
}

// Asks for a write once the gap since the last has passed, or `now`, at once.
function writeSoon($: $, now = false): void {
  if (!enabled) return
  if (writing !== null) {
    writeAgain = true
    return
  }
  if (held !== null && !now) return
  held?.cancel()
  held = null
  void $.clock.now().then(at => {
    if (writing !== null || (held !== null && !now)) return
    held?.cancel()
    held = $.clock.after(now ? 0 : Math.max(0, lastWrite + WRITE_GAP_MS - at), () => {
      held = null
      if (writing !== null) {
        writeAgain = true
        return
      }
      writing = (async () => {
        do {
          writeAgain = false
          const toast = toastAfterWrite
          toastAfterWrite = false
          const ok = await writeOnce($).catch(() => false)
          if (toast) $.ui.toast(t().rewrote(ok))
        } while (writeAgain)
      })().finally(() => {
        writing = null
      })
    })
  })
}

// Three minutes after an answer with nothing new from the person: the note for their coming back
// shows, and the board is written again if anything came since the last write. A request, a turn
// or typing in the prompt calls it off.
function idleWriteAfterAnswer($: $): void {
  idleTimer?.cancel()
  idleTimer = $.clock.after(IDLE_WRITE_MS, () => {
    idleTimer = null
    if (!enabled) return
    void update($, awayAtom, () => true)
    if (heardCount !== writtenCount) writeSoon($)
  })
}
function callOffIdleWrite(): void {
  idleTimer?.cancel()
  idleTimer = null
}

// The person is back: the note folds away.
async function back($: $): Promise<void> {
  callOffIdleWrite()
  if (await read($, awayAtom)) await update($, awayAtom, () => false)
}

// The board a view draws: a demo's while one runs, else the session's.
async function board($: $) {
  const at = await read($, demoAtom)
  const frame = at === null ? undefined : demoFrame(at)
  return {
    at,
    frame,
    shown: frame?.shown ?? shownOf(await read($, keptAtom)),
    activity: frame?.activity ?? (await read($, activityAtom)),
    now: frame?.now ?? (await $.clock.now()),
  }
}

// Settles once no board write is in flight.
export const writerIdle = async (): Promise<void> => {
  while (writing !== null) await writing
}

// The tab shows the session's subject. A title can only be set as a request goes out or the session
// starts, so it carries the board's title, never a status; it is sent only when it changed.
async function titled<R extends { sessionTitle?: string }>($: $, r: R): Promise<R> {
  const title = shownOf(await read($, keptAtom)).board.title
  if (!enabled || title === '' || title === sentTitle || r.sessionTitle !== undefined) return r
  sentTitle = title
  return { ...r, sessionTitle: title }
}

export const register: Register = (on, options) => {
  const autoShow = options.autoShow !== false
  const startOn = options.enabled !== false
  // An experiment, off unless the person turns it on: Claude ends answers after work with a status block.
  const statusBlock = options.statusBlock === true

  // Only with the experiment on, and plan-flow on in the session, does anything reach what Claude reads.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    if (!statusBlock || !enabled) return r
    return { sections: [...r.sections, { id: 'plan-flow:status', text: STATUS_PROMPT, scope: 'session' as const }] }
  })

  on('session.start', async ($, e, next) => {
    await resolveLanguage($, options.language)
    await $.command.register({ name: 'flow', description: t().command, immediate: true })
    enabled = (((await $.store.get('enabled')) ?? {}) as Switches)[await $.session.id()]?.on ?? startOn
    callOffIdleWrite()
    lastWrite = Number.NEGATIVE_INFINITY
    ;[heardCount, writtenCount] = [0, -1]
    const kept = (((await $.store.get('chapters')) ?? {}) as SavedKept)[await $.session.id()]?.kept ?? emptyKept()
    await update($, keptAtom, () => kept)
    await update($, awayAtom, () => false)
    // What already waited on the person before a reload was told then.
    told = new Set(mineOf(shownOf(kept)))
    notice = null
    lastLine = ''
    // A resumed session with no board yet has it written from what is already there.
    if (enabled && kept.seq === 0 && (await $.session.messages().catch(() => [])).length > 0) writeSoon($)
    await update($, activityAtom, () => idleActivity())
    await syncLine($)
    // A reload runs this again: forget what the older copy saw, then look afresh without holding the start.
    await update($, newerAtom, () => null)
    void checkVersion($).catch(() => undefined)

    return next(e)
  })

  // Each request the person sends starts a chapter (a bare go-ahead continues the one before);
  // a notice (a task finishing) is news, not a request. Nothing is added to the request.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true) return next(e)
    heardCount++
    if (!PERSON.has(e.origin.kind)) {
      const ended = backgroundDone(e.text)
      if (ended !== undefined) await hearRule($, { kind: 'backgroundDone', id: ended })
      return next(e)
    }
    worked = false
    await back($)
    await takeBackNotice($)
    await hearRule($, { kind: 'request', text: e.text })

    return next(e)
  })

  // The person typing, or a recalled entry put in the box: they are back.
  on('prompt.edit', async ($, e, next) => (await back($), next(e)))
  on('prompt.change', async ($, e, next) => (await back($), next(e)))

  // Every tool call, a subagent's too: an open question, background work and what a command
  // produced for the rules, and for the main loop the activity line; what Claude gets back is untouched.
  on('tool.call', async ($, e, next) => {
    const sub = e.agentId !== undefined
    const question = e.tool === 'AskUserQuestion'
    if (!sub) await act($, question ? { type: 'questionOpen' } : { type: 'toolStart', id: e.tool_use_id, tool: e.tool })
    // The call's input fields come on the event itself.
    const input = e as unknown as Record<string, unknown>
    heardCount++
    if (question && !sub) {
      await hearRule($, { kind: 'asked', id: e.tool_use_id, question: ((input.questions as Array<{ question?: string }> | undefined) ?? []).map(q => q.question ?? '').join(' / ') })
      await notifyMine($)
    }
    if (isBackground(e.tool, input)) await hearRule($, { kind: 'background', id: e.tool_use_id })
    try {
      const out = await next(e)
      if (question && !sub) await hearRule($, { kind: 'answered', id: e.tool_use_id })
      const receipt = e.tool === 'Bash' && out.deny === undefined && out.isError !== true ? receiptOf(String(input.command ?? ''), `${out.text ?? ''}\n${typeof out.result === 'string' ? out.result : JSON.stringify(out.result ?? '')}`) : undefined
      if (receipt !== undefined) await hearRule($, { kind: 'receipt', receipt })

      return out
    } finally {
      if (!sub) {
        await act($, question ? { type: 'questionClose' } : { type: 'toolEnd', id: e.tool_use_id })
        await act($, { type: 'permissionEnd' })
      }
    }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => titled($, await next(e)))
  on('classic.SessionStart', async ($, e, next) => {
    sentTitle = ''
    return titled($, await next(e))
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    if (e.agent_id === undefined) await act($, { type: 'permissionAsk', tool: e.tool_name })

    return next(e)
  })
  // Background work still in flight when the main turn stops: the session waits on it, not on the person.
  on('classic.Stop', async ($, e, next) => (await act($, { type: 'background', count: e.background_tasks?.length ?? 0 }), next(e)))
  on('classic.PreCompact', async ($, e, next) => (await act($, { type: 'compactStart' }), next(e)))
  on('classic.PostCompact', async ($, e, next) => (await act($, { type: 'compactEnd' }), next(e)))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      callOffIdleWrite()
      await act($, { type: 'turnStart' })
      tick($, true)
    }

    return next(e)
  })

  // Each model request of the main turn, passed on untouched: one that called a tool means the
  // answer comes after work.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId === undefined && r.toolUses.length > 0) worked = true

    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await act($, { type: 'turnEnd', reason: e.reason })
      tick($, false)
      heardCount++
      const block = statusBlock && enabled ? parseStatus(e.answer) : undefined
      if (block !== undefined) {
        await hearRule($, { kind: 'status', ...block })
        await notifyMine($)
      }
      if (worked) writeSoon($)
      worked = false
      idleWriteAfterAnswer($)
      void checkVersion($).catch(() => undefined)
    }

    return next(e)
  })

  on('command.run', { command: 'flow' }, async ($, e) => {
    const [word, arg] = e.args.trim().split(/\s+/)
    if (word === 'demo') return { text: await demo($, arg) }
    if (word === 'status') return { text: await status($, startOn, statusBlock) }
    if (word === 'on' || word === 'off') {
      await setEnabled($, word === 'on')
      // Back on, the board catches up on what happened while it was off.
      if (word === 'on') writeSoon($)
      else if ((await $.ui.panes()).some(p => p.id === PANE)) await $.ui.close({ id: PANE })
      $.ui.invalidate('ui.render')
      return { text: word === 'on' ? t().turnedOn : t().turnedOff }
    }
    if (!enabled) return { text: t().isOff }
    if ((await $.ui.panes()).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })

      return { text: t().closed }
    }
    const placed = await openDrawer($)

    return { text: placed ? t().opened : t().openedLater }
  })

  // The band above the prompt. It is one slot: what the plugins beneath draw stays, under the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.surface === 'terminal') onTerminal = true
    if (e.props.hasSurvey) return below
    const { at, frame, shown, activity, now } = await board($)
    if (frame === undefined && (shown.board.chapters.length === 0 || !(await visible($, autoShow)))) return below
    if ((await read($, paneAtom)) && (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced && p.isShown)) return below
    const { Box } = $.ui.resolve(e)
    const width = e.props.bodyColumns
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
    const notice = frame === undefined ? await read($, newerAtom).then(n => (n === null ? undefined : t().newer(n))) : undefined
    const folded = frame?.folded ?? (await read($, foldAtom))
    const away = frame?.away ?? (await read($, awayAtom))
    const rows = bandStack(shown, activity, { ...(e.surface === 'terminal' ? { width } : {}), maxRows: e.props.maxRows - top.length, folded, now, away, ...(notice === undefined ? {} : { notice }) })
    const press = (id: string) => {
      if (id === OPEN_BUTTON) void openDrawer($)
      if (id === FOLD_BUTTON) void update($, foldAtom, f => !f)
      if (id === DEMO_NEXT) void demo($, 'next')
      if (id === DEMO_PREV) void demo($, 'prev')
      if (id === DEMO_STOP) void demo($, 'stop')
    }

    // A surface with its own type draws the band natively; a demo's bar stays as lines over it.
    if (e.surface !== 'terminal')
      return (
        <Box flexDirection="column" gap="xs">
          {top.map(l => row($, e, l, press))}
          {nativeBand($, e, shown, rows, { activity, folded, now, onPress: press, ...(notice === undefined ? {} : { notice }) })}
          {below}
        </Box>
      )

    return (
      <Box flexDirection="column">
        {top.map(l => row($, e, l, press))}
        {rows.map(r => termRow($, e, r, press))}
        {below}
      </Box>
    )
  })

  // The drawer: every chapter of the session; the engine scrolls it.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box } = $.ui.resolve(e)
    if (e.surface === 'terminal') onTerminal = true
    const { shown, activity, now } = await board($)
    const press = (id: string) => void pressDrawer($, id)
    const at = await $.clock.now()
    const others = othersOf(((await $.store.get('sessions').catch(() => undefined)) ?? {}) as Lines, await $.session.id(), at)
    const rows = (width?: number) => [...drawerRows(shown, activity, { ...(width === undefined ? {} : { width }), now }), ...sessionRows(others, at, width)]
    if (e.surface !== 'terminal') return nativeDrawer($, e, shown, rows(), now, press)

    return <Box flexDirection="column">{rows(e.props.bodyColumns).map(r => termRow($, e, r, press))}</Box>
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

  // The drawer closed (Esc, /flow, the person): the band comes back.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await update($, paneAtom, () => false)
    othersTicker?.cancel()
    othersTicker = null

    return closed
  })
}
