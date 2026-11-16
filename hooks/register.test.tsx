import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { setLanguage } from './i18n'
import { IDLE_WRITE_MS, WRITE_GAP_MS, writerIdle } from './register'

// The expectations below are written in Korean.
setLanguage('ko')
const KO = { options: { language: 'ko' } }

// /flow as the person types it.
const FLOW = { command: 'flow', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const BAND = {
  plugin: 'plan-flow',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 20, bodyColumns: 60, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const
const PANE = {
  plugin: 'plan-flow',
  component: 'Pane',
  requestId: 'plan-flow',
  props: { title: '세션 목차', isFocused: true, bodyColumns: 53, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// A system prompt render as the engine asks for one.
const COMPOSE = { model: 'opus', promptModel: 'opus', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const
// What the plugins registered as tools, and the context the last request reached the model with.
const registered: string[] = []
let handedContext: readonly string[] | undefined
const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
let theClock: ReturnType<typeof mock.clock> | undefined
const TURN = { answer: '했어요', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
// The writer's boards, one per write, the prompts it was handed, and the session it reads.
const writerReplies: unknown[] = []
const written: string[] = []
let messages: unknown[] = []
const WRITER_USAGE = { input_tokens: 40_000, output_tokens: 1_400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
// The mod's store, as the engine keeps it.
const stored = new Map<string, unknown>()
// Toasts the plugin raised, newest last.
const toasts: string[] = []
let stepAnswer: { answer: string; toolUses: unknown[] } = { answer: '', toolUses: [] }
// Native notifications the plugin raised, and the keys it took back.
type Notice = { text: string; title?: string; key?: string; delayMs?: number; untilBack?: boolean }
const notices: Notice[] = []
const cancelled: string[] = []

// The engine beneath the plugin: each hook answers what the session would.
const engine = (on: On) => {
  const clock = mock.clock(on, { now: 1_000 })
  theClock = clock
  registered.length = 0
  handedContext = undefined
  writerReplies.length = 0
  written.length = 0
  messages = []
  toasts.length = 0
  notices.length = 0
  cancelled.length = 0
  on('ui.notify', (_, e) => (notices.push(e), { value: { isSent: true, channel: 'client' } }) as never)
  on('ui.cancelNotify', (_, e) => (cancelled.push(e.key), { value: { isSent: true } }))
  on('session.messages', () => ({ value: messages }) as never)
  on('model.complete', (_, e) => {
    written.push(typeof e.prompt === 'string' ? e.prompt : '')
    const board = writerReplies.shift()
    return { value: board === undefined ? { isAnswered: false, reason: 'api-error', status: 500, error: 'api_error', usage: NO_USAGE } : { isAnswered: true, text: JSON.stringify(board), usage: WRITER_USAGE } } as never
  })
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, ...stepAnswer } as never
  })
  stored.clear()
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => (stored.set(e.key, JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  const open = new Set<string>()
  on('session.id', () => ({ value: 's1' }))
  on('tool.register', (_, e) => (registered.push(e.name), { value: { tool: `mcp__plan-flow__${e.name}` } }))
  on('prompt.submit', (_, e) => ((handedContext = e.context), { text: e.text, context: e.context }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => (open.add(e.id), { value: { isPlaced: true } }))
  on('ui.close', (_, e) => (open.delete(e.id), { value: undefined }))
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: true, isPlaced: true })) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: 'ran' }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return clock
}
const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const ask = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const flow = async ($: Engine, args: string) => (await $.command.run({ ...FLOW, args })).text
// One model request of the main turn that calls a tool.
const step = async ($: Engine) => {
  stepAnswer = { answer: '', toolUses: [{ id: 'u1', name: 'Bash', input: {} }] }
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 2 })) void _
}
const settle = async () => {
  await theClock?.advance(WRITE_GAP_MS)
  await writerIdle()
}
// The person sends a request, Claude works and answers, and the writer writes `board`.
const worked = async ($: Engine, request: string, board: unknown) => {
  messages = SESSION
  writerReplies.push(board)
  await ask($, request)
  await step($)
  await $.turn.complete(TURN as never)
  await settle()
}
const texts = async (ui: { findAll: (q: { type: string }) => Promise<Array<{ text?: string }>> }) => (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '').join('\n')

const PR = 'https://github.com/o/r/pull/142'
const BOARD = {
  title: '결제 웹훅 재시도',
  goal: '결제 실패 알림이 한 번만 가게',
  chapters: [
    { request: '알림이 두 번 간대', title: '중복 알림 원인 찾기', result: '재시도가 두 번 등록됨', links: [], done: true, left: [] },
    { request: '재시도 정리해줘', title: '재시도 큐 교체', result: '큐를 바꿨다', links: [PR], done: false, left: [{ text: '스테이징 확인', kind: 'mine' }] },
  ],
}
const SESSION = [
  { role: 'user', text: '재시도 정리해줘', toolUses: [] },
  { role: 'assistant', text: '큐부터 볼게요.', toolUses: [{ tool_use_id: 'b1', tool: 'Bash', input: { command: 'rg retry', description: '재시도 코드 찾기' } }] },
  { role: 'assistant', text: '큐를 바꿨어요. 스테이징에서 확인해 주세요.', toolUses: [] },
]
type KeptLike = { base: { title: string; chapters: Array<{ title: string; receipts: unknown[] }> }; since: Array<{ heard: { kind: string } }>; asked: Array<{ question: string }>; running: string[] }
const keptOf = (): KeptLike | undefined => (stored.get('chapters') as Record<string, { kept: KeptLike }> | undefined)?.s1?.kept

test('nothing of plan-flow reaches what Claude reads: no tool, no system prompt section, no note on a request, nothing on a tool result', KO, async ($, on) => {
  engine(on)
  await start($)
  expect(registered).toEqual([])
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections ?? []).toEqual([])
  await ask($, '로그인 만들어줘')
  expect(handedContext ?? []).toEqual([])
  for (let i = 0; i < 12; i++) {
    const out = await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
    expect(out.context).toBeUndefined()
    expect(out.deny).toBeUndefined()
  }
})

test('the band shows the written board: subject, goal, the chapters with what came of them, links and your turn', KO, async ($, on) => {
  engine(on)
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /결제 웹훅 재시도/ })).toBeUndefined()
  await worked($, '재시도 정리해줘', BOARD)
  await band.redraw()
  const all = await texts(band)
  for (const want of ['결제 웹훅 재시도', '결제 실패 알림이 한 번만 가게', '중복 알림 원인 찾기', '→ 재시도가 두 번 등록됨', '재시도 큐 교체', '↗ PR #142', '내 차례', '스테이징 확인']) expect(all).toContain(want)
  expect((await band.findAll({ type: 'Link' })).map(l => l.props.href)).toContain(PR)
  // A survey holds the band: it steps aside.
  await band.redraw({ ...BAND.props, hasSurvey: true })
  expect(await band.find({ type: 'Text', text: /결제 웹훅 재시도/ })).toBeUndefined()
  await band.unmount()
})

test('a request shows as a new chapter at once, before the writer reads the session again', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ask($, '스테이징 확인 끝났어, 머지해줘')
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /3 / })).toBeDefined()
  expect(await texts(band)).toContain('스테이징 확인 끝났어, 머지해줘')
  await band.unmount()
})

test('a dialog question Claude asks is your turn on the band until it is answered', KO, async ($, on) => {
  // What the band shows while the dialog is open, read from beneath the call.
  let look = async (): Promise<string> => ''
  let during = ''
  on('tool.call', { tool: 'AskUserQuestion' }, async () => {
    during = await look()
    return { result: '3번' } as never
  })
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  look = async () => {
    await band.redraw()
    return texts(band)
  }
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: '재시도는 몇 번으로 할까요?' }] } as never)
  expect(during).toContain('재시도는 몇 번으로 할까요?')
  expect(during).toContain('답변 기다리는 중')
  await band.redraw()
  expect(await texts(band)).not.toContain('재시도는 몇 번으로 할까요?')
  await band.unmount()
})

// Typing reaches the mod as prompt.edit, which a test cannot raise; it folds the note the same way a request does.
test('three minutes after an answer with no input, a note for the person coming back shows above the band, and a request folds it', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.redraw()
  expect(await texts(band)).not.toContain('자리 비운 동안')
  await theClock?.advance(IDLE_WRITE_MS)
  await band.redraw()
  const note = await texts(band)
  expect(note).toContain('자리 비운 동안')
  expect(note.indexOf('자리 비운 동안')).toBeLessThan(note.indexOf('결제 웹훅 재시도'))
  await ask($, '고마워')
  await band.redraw()
  expect(await texts(band)).not.toContain('자리 비운 동안')
  await band.unmount()
})

test('pressing the band title folds it to its title and goal and pressing again unfolds it; the drawer button is the main one', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const buttons = await band.findAll({ type: 'Button' })
  expect(buttons.find(b => b.key === 'open-drawer')?.props.variant).toBe('primary')
  expect(buttons.find(b => b.key === 'fold-band')?.props.variant).toBeUndefined()
  await band.press({ key: 'fold-band' })
  await band.redraw()
  expect(await texts(band)).toContain('결제 실패 알림이 한 번만 가게')
  expect(await texts(band)).not.toContain('재시도 큐 교체')
  await band.press({ key: 'fold-band' })
  await band.redraw()
  expect(await texts(band)).toContain('재시도 큐 교체')
  await band.unmount()
})

test('on the desktop app the band is set in the app type: the title row folds it, the drawer button is primary, links are links', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const title = await band.find({ type: 'Client', key: 'band-title' })
  expect(JSON.stringify(await band.drawn({ in: 'band-title' }))).toContain('결제 웹훅 재시도')
  expect(title).toBeDefined()
  expect((await band.findAll({ type: 'Button' })).find(b => b.key === 'open-drawer')?.props.variant).toBe('primary')
  expect((await band.findAll({ type: 'Link' })).map(l => l.props.href)).toContain(PR)
  expect(await band.find({ type: 'Text', text: /스테이징 확인/ })).toBeDefined()
  // No monospaced character lines on this surface.
  expect((await band.findAll({ type: 'Text' })).some(x => x.props.mono === true)).toBe(false)
  await band.pointer({ type: 'up', x: 40, y: 0, button: 'left', in: 'band-title' })
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /재시도 큐 교체/ })).toBeUndefined()
  await band.unmount()
})

test('the drawer lists every chapter with its request, result and links, your turn at the top', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    const all = await texts(pane)
    for (const want of ['결제 웹훅 재시도', '중복 알림 원인 찾기', '알림이 두 번 간대', '재시도가 두 번 등록됨', '재시도 큐 교체', '재시도 정리해줘', '큐를 바꿨다', '스테이징 확인']) expect(all).toContain(want)
    expect(all.indexOf('스테이징 확인')).toBeLessThan(all.indexOf('중복 알림 원인 찾기'))
    const links = await pane.findAll({ type: 'Link' })
    expect(links.map(l => l.props.href)).toEqual([PR])
    expect(links[0]?.text).toContain('↗ PR #142')
    await pane.unmount()
  }
})

test("the drawer's ↻ has the writer read the whole session again at once, not after the gap, and a toast says how it went", KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  writerReplies.push({ ...BOARD, title: '결제 웹훅 재시도 다시' })
  await pane.press({ key: 'refresh' })
  await theClock?.advance(1)
  await writerIdle()
  expect(written).toHaveLength(2)
  expect(keptOf()?.base.title).toBe('결제 웹훅 재시도 다시')
  expect(toasts.at(-1)).toBe('세션 전체를 다시 읽고 판을 새로 썼어요')
  // A write that fails says so and leaves the board.
  await pane.press({ key: 'refresh' })
  await theClock?.advance(1)
  await writerIdle()
  expect(toasts.at(-1)).toBe('판을 다시 쓰지 못했어요. 판은 그대로예요')
  expect(keptOf()?.base.title).toBe('결제 웹훅 재시도 다시')
  await pane.unmount()
})

test('with autoShow off, nothing shows above the prompt until /flow', { options: { autoShow: false, language: 'ko' } }, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /결제 웹훅 재시도/ })).toBeUndefined()
  await $.command.run(FLOW)
  await band.redraw()
  // The drawer is on screen: the band steps aside until it closes.
  expect(await band.find({ type: 'Text', text: /결제 웹훅 재시도/ })).toBeUndefined()
  await $.command.run(FLOW)
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /결제 웹훅 재시도/ })).toBeDefined()
  await band.unmount()
})

test('/flow off hides the board and calls no model in this session, a reload keeps it off, and /flow on catches up', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.command.run(FLOW)
  expect(await flow($, 'off')).toMatch(/껐어요/)
  // The drawer closes with it, and /flow says why it does not open.
  expect(await flow($, '')).toMatch(/\/flow on/)
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /결제 웹훅 재시도/ })).toBeUndefined()
  writerReplies.push(BOARD)
  await ask($, '세션 저장도')
  await step($)
  await $.turn.complete(TURN as never)
  await theClock?.advance(IDLE_WRITE_MS + WRITE_GAP_MS)
  await writerIdle()
  expect(written).toHaveLength(1)
  // A reload keeps the choice.
  await start($)
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /결제 웹훅 재시도/ })).toBeUndefined()
  expect(await flow($, 'on')).toMatch(/켰어요/)
  await settle()
  expect(written).toHaveLength(2)
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /결제 웹훅 재시도/ })).toBeDefined()
  await band.unmount()
  // The drawer /flow off closed opens again.
  expect(await flow($, '')).toBe('세션 목차를 열었어요')
})

test('with enabled off, a new session starts off until /flow on', { options: { enabled: false, language: 'ko' } }, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  expect(written).toHaveLength(0)
  await flow($, 'on')
  await settle()
  expect(written).toHaveLength(1)
})

test('/flow status tells whether plan-flow is on and what the recent board writes used', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  const status = await flow($, 'status')
  expect(status).toContain('이 세션에서 켜져 있어요')
  expect(status).toContain('Sonnet 판 쓰기 1번: 입력 40,000')
  expect(status).not.toContain('Haiku')
  await flow($, 'off')
  expect(await flow($, 'status')).toContain('이 세션에서 꺼져 있어요')
})

test('/flow opens the drawer and closes it again', KO, async ($, on) => {
  engine(on)
  await start($)
  expect((await $.command.run(FLOW)).text).toBe('세션 목차를 열었어요')
  expect((await $.command.run(FLOW)).text).toBe('세션 목차를 닫았어요')
})

test('a resumed session gets its board back, while thirty other sessions saved theirs after it; call logs stay with the most recent twenty', KO, async ($, on) => {
  engine(on)
  await start($)
  const later = Number.MAX_SAFE_INTEGER
  const others = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`other-${i}`, { kept: { base: { title: '', goal: '', chapters: [] }, cut: 0, seq: 0, since: [], asked: [], running: [] }, savedAt: later - i }]))
  stored.set('chapters', others)
  stored.set('calls', Object.fromEntries(Object.keys(others).map((sid, i) => [sid, { calls: [], savedAt: later - i }])))
  await worked($, '재시도 정리해줘', BOARD)
  expect(Object.keys(stored.get('chapters') as object)).toHaveLength(31)
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /결제 웹훅 재시도/ })).toBeDefined()
  expect(Object.keys(stored.get('calls') as object).length).toBeLessThanOrEqual(20)
  await band.unmount()
})

test('/flow demo shows canned boards above the prompt and leaves the real board alone', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', { ...BOARD, title: '진짜 판' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await flow($, 'demo')).toContain('시연 1/3: 일하는 세션')
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /시연 1\/3/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /결제 웹훅 재시도 정리/ })).toBeDefined()
  expect(await flow($, 'demo next')).toContain('시연 1/3: 일하는 세션')
  expect(await flow($, 'demo finished')).toContain('끝난 세션')
  expect(await flow($, 'demo nope')).toContain('그런 시연이 없어요')
  // ↻ in a demo leaves the board.
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'refresh' })
  expect(toasts.at(-1)).toBe('시연 화면이라 판은 그대로예요')
  await pane.unmount()
  await flow($, 'demo stop')
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /시연/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /진짜 판/ })).toBeDefined()
  await band.unmount()
})

test('the band keeps what another plugin draws above the prompt, under the board', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /결제 웹훅 재시도/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await band.unmount()
})

test('at an answer that followed work, Sonnet rereads the whole session and writes the board, and the call is kept with its tokens', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  expect(written.length).toBe(1)
  expect(written[0]).toContain('- The person asked: 재시도 정리해줘')
  expect(written[0]).toContain('- Claude ran: 재시도 코드 찾기')
  expect(keptOf()?.base.title).toBe('결제 웹훅 재시도')
  const calls = (stored.get('calls') as Record<string, { calls: Array<{ call: string; result: string; usage?: { input: number; output: number } }> }>).s1?.calls ?? []
  expect(calls.filter(c => c.call === 'write').map(c => [c.result, c.usage?.input, c.usage?.output])).toEqual([['answered', 40_000, 1_400]])
})

test('an answer with no work behind it is written only after three minutes with nothing new; a request before then calls it off', KO, async ($, on) => {
  engine(on)
  await start($)
  messages = SESSION
  writerReplies.push(BOARD, BOARD)
  await ask($, '이거 무슨 뜻이야?')
  await $.turn.complete(TURN as never)
  await theClock?.advance(IDLE_WRITE_MS - 1_000)
  await ask($, '그럼 다른 건?')
  await theClock?.advance(IDLE_WRITE_MS)
  await writerIdle()
  expect(written.length).toBe(0)
  await $.turn.complete(TURN as never)
  await theClock?.advance(IDLE_WRITE_MS + WRITE_GAP_MS)
  await writerIdle()
  expect(written.length).toBe(1)
})

test('quick answers after work do not each pay for a write: writes start at least thirty seconds apart', KO, async ($, on) => {
  engine(on)
  await start($)
  messages = SESSION
  writerReplies.push(BOARD, BOARD, BOARD)
  for (let i = 0; i < 3; i++) {
    await ask($, `고쳐줘 ${i}`)
    await step($)
    await $.turn.complete(TURN as never)
    await theClock?.advance(1_000)
  }
  await writerIdle()
  expect(written.length).toBe(1)
  await settle()
  expect(written.length).toBe(2)
})

test('between writes the rules keep a chapter per request, a PR, an open question and background work', KO, async ($, on) => {
  on('tool.call', { tool: 'Bash' }, (_, e) => ({ result: { stdout: String((e as { command?: string }).command).startsWith('gh pr create') ? 'https://github.com/o/r/pull/142\n' : '' } }) as never)
  engine(on)
  await start($)
  await ask($, '재시도 큐 바꿔줘')
  await ask($, 'ㄱㄱ')
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title x' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true })
  const k = keptOf()
  expect(k?.since.map(s => s.heard.kind)).toEqual(['request', 'request', 'receipt', 'background'])
  expect(k?.running.length).toBe(1)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const all = await texts(band)
  expect(all).toContain('↗ PR #142 열림')
  expect(all).toContain('백그라운드 작업 1개 진행 중')
  await band.unmount()
  await $.prompt.submit({ text: `<task-notification><tool-use-id>${'x'}</tool-use-id></task-notification>`, wait: false, origin: { kind: 'task-notification' } } as never)
  expect(keptOf()?.since.at(-1)?.heard.kind).toBe('backgroundDone')
})

test('a writer answer that is not a board leaves the board as it was and is kept as failed', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', 'sorry')
  expect(keptOf()?.base.title).toBe('')
  const calls = (stored.get('calls') as Record<string, { calls: Array<{ call: string; result: string; reason?: string }> }>).s1?.calls ?? []
  expect(calls.filter(c => c.call === 'write').map(c => [c.result, c.reason])).toEqual([['failed', 'not a board']])
})

test('the tab carries the session subject: the board title goes out as the session title when a request is sent or the session starts, and only when it changed', KO, async ($, on) => {
  engine(on)
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.SessionStart', () => ({}))
  await start($)
  expect((await $.classic.UserPromptSubmit({ prompt: '재시도 정리해줘' } as never)).sessionTitle).toBeUndefined()
  await worked($, '재시도 정리해줘', BOARD)
  expect((await $.classic.UserPromptSubmit({ prompt: '리뷰 반영해줘' } as never)).sessionTitle).toBe('결제 웹훅 재시도')
  expect((await $.classic.UserPromptSubmit({ prompt: 'ㄱㄱ' } as never)).sessionTitle).toBeUndefined()
  expect((await $.classic.SessionStart({ source: 'resume' } as never)).sessionTitle).toBe('결제 웹훅 재시도')
})

test('with plan-flow off in a session, the tab title is left alone', KO, async ($, on) => {
  engine(on)
  on('classic.UserPromptSubmit', () => ({}))
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  await $.command.run({ ...FLOW, args: 'off' })
  expect((await $.classic.UserPromptSubmit({ prompt: '리뷰 반영해줘' } as never)).sessionTitle).toBeUndefined()
})

type LineLike = { title: string; state: string; mine: number; savedAt: number }
const linesOf = (): Record<string, LineLike> => (stored.get('sessions') as Record<string, LineLike> | undefined) ?? {}

test('each session keeps one line about itself for the others: title, state and how many things wait on you; the newest twenty are kept, and /flow off takes it out', KO, async ($, on) => {
  engine(on)
  await start($)
  stored.set('sessions', Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`other-${i}`, { title: `세션 ${i}`, state: 'done', mine: 0, savedAt: 500 - i }])))
  await worked($, '재시도 정리해줘', BOARD)
  expect(linesOf().s1).toMatchObject({ title: '결제 웹훅 재시도', state: 'mine', mine: 1 })
  expect(Object.keys(linesOf())).toHaveLength(20)
  await ask($, '머지해줘')
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 142' })
  expect(linesOf().s1?.state).toBe('working')
  await flow($, 'off')
  expect(linesOf().s1).toBeUndefined()
  await $.turn.complete(TURN as never)
  expect(linesOf().s1).toBeUndefined()
})

test('the drawer lists every other session, your turn first, then working, then the rest, with how long ago each changed', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  const now = 1_000 + WRITE_GAP_MS
  stored.set('sessions', {
    ...linesOf(),
    a: { title: '끝난 배포', state: 'done', mine: 0, savedAt: now - 60_000 },
    b: { title: '도는 마이그레이션', state: 'working', mine: 0, savedAt: now },
    c: { title: '답을 기다리는 리뷰', state: 'mine', mine: 1, savedAt: now - 3 * 60_000 },
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    const all = await texts(pane)
    const order = ['모든 세션', '답을 기다리는 리뷰', '도는 마이그레이션', '끝난 배포'].map(x => all.indexOf(x))
    expect(order.every((x, i) => x > (order[i - 1] ?? all.indexOf('스테이징 확인')))).toBe(true)
    expect(all).toContain('3분 전')
    expect(all.split('결제 웹훅 재시도')).toHaveLength(2)
    await pane.unmount()
  }
})

test('something newly waiting on you after a write raises one notification with the session title, held until you are away, and the same items never again', KO, async ($, on) => {
  engine(on)
  await start($)
  await worked($, '재시도 정리해줘', BOARD)
  expect(notices).toHaveLength(1)
  expect(notices[0]).toMatchObject({ title: '결제 웹훅 재시도', text: '스테이징 확인', untilBack: true })
  expect(notices[0]?.key).toContain('s1')
  expect(notices[0]?.delayMs ?? 0).toBeGreaterThan(0)
  await worked($, '정리 더 해줘', BOARD)
  expect(notices).toHaveLength(1)
  const more = { ...BOARD, chapters: [...BOARD.chapters, { request: '배포해줘', title: '배포', result: '', links: [], done: false, left: [{ text: '배포 승인', kind: 'mine' }] }] }
  await worked($, '배포해줘', more)
  expect(notices.map(n => n.text)).toEqual(['스테이징 확인', '배포 승인'])
  expect(notices[1]?.key).toBe(notices[0]?.key)
})

test('a dialog question Claude opens notifies, and a request you send takes the notification back', KO, async ($, on) => {
  engine(on)
  await start($)
  await ask($, '재시도 정리해줘')
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: '재시도는 몇 번으로 할까요?' }] } as never)
  expect(notices.map(n => n.text)).toEqual(['재시도는 몇 번으로 할까요?'])
  expect(cancelled).toEqual([])
  await ask($, '3번으로 해')
  expect(cancelled).toEqual([notices[0]?.key])
})

test('with plan-flow off in a session, no notification and no line for the others', KO, async ($, on) => {
  engine(on)
  await start($)
  await flow($, 'off')
  await ask($, '재시도 정리해줘')
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: '재시도는 몇 번으로 할까요?' }] } as never)
  expect(notices).toEqual([])
  expect(linesOf().s1).toBeUndefined()
})

const STATUS_ON = { options: { language: 'ko', statusBlock: true } }
const BLOCK = '큐를 바꿨어요.\n<status>\ndone: 재시도 큐를 교체했다\nmine: 스테이징에서 결제 한 건 확인\n</status>'

test('with statusBlock on, one section of the system prompt asks Claude for the status block, and nothing else reaches it', STATUS_ON, async ($, on) => {
  engine(on)
  await start($)
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.map(x => [x.id, x.scope])).toEqual([['plan-flow:status', 'session']])
  expect(composed.sections[0]?.text).toContain('<status>')
  expect(registered).toEqual([])
  await ask($, '로그인 만들어줘')
  expect(handedContext ?? []).toEqual([])
  // Off in the session, the section goes too.
  await flow($, 'off')
  expect((await $.prompt.compose(COMPOSE)).sections).toEqual([])
})

test("with statusBlock on, the block Claude's answer ends with sets the latest chapter's result and what waits on you, and notifies", STATUS_ON, async ($, on) => {
  engine(on)
  await start($)
  await ask($, '재시도 정리해줘')
  await $.turn.complete({ ...TURN, answer: BLOCK } as never)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const all = await texts(band)
  expect(all).toContain('→ 재시도 큐를 교체했다')
  expect(all).toContain('스테이징에서 결제 한 건 확인')
  expect(notices.map(n => n.text)).toEqual(['스테이징에서 결제 한 건 확인'])
  await band.unmount()
  expect(await flow($, 'status')).toContain('상태 블록: 켜짐')
})

test('with statusBlock off, a block in the answer is not read', KO, async ($, on) => {
  engine(on)
  await start($)
  await ask($, '재시도 정리해줘')
  await $.turn.complete({ ...TURN, answer: BLOCK } as never)
  expect(keptOf()?.since.map(s => s.heard.kind)).toEqual(['request'])
  expect(await flow($, 'status')).toContain('상태 블록: 꺼짐')
})
