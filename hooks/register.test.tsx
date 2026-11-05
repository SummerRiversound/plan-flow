import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { setLanguage } from './i18n'
import { NO_PLAN_NOTE } from './plan-tool'
import { LONG_STEP, REMINDER } from './gate'

// The expectations below are written in Korean.
setLanguage('ko')
const KO = { options: { language: 'ko' } }

const TOOL = 'mcp__plan-flow__plan'
const PLAN = {
  op: 'set',
  title: '로그인 기능 추가',
  nodes: [
    { title: '조사' },
    { title: '구현', children: [{ title: '로그인 화면' }, { title: '세션 저장' }] },
    { title: '배포', children: [{ title: '스테이징' }, { title: '운영' }] },
  ],
}
// /flow as the person types it.
const FLOW = { command: 'flow', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
const BAND = {
  plugin: 'plan-flow',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 60, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const
const PANE = {
  plugin: 'plan-flow',
  component: 'Pane',
  requestId: 'plan-flow',
  props: { title: '흐름도', isFocused: true, bodyColumns: 53, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Toasts the plugin raised, newest last.
const toasts: string[] = []

// The engine beneath the plugin: each hook answers what the session would.
const engine = (on: On) => {
  const clock = mock.clock(on, { now: 1_000 })
  mock.store(on)
  const open = new Set<string>()
  on('session.id', () => ({ value: 's1' }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__plan-flow__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => (open.add(e.id), { value: { isPlaced: true } }))
  on('ui.close', (_, e) => (open.delete(e.id), { value: undefined }))
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: true, isPlaced: true })) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: 'ran' }))
  on('ui.focus', () => ({}))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  return clock
}
// The ui.focus event as the engine raises it when the person's arrow moves the ring.
const personMoves = ($: Engine, element: string) =>
  $.ui.focus({ component: 'Pane', requestId: 'plan-flow', plugin: 'plan-flow', element, origin: { kind: 'person' } } as never)
const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

test('the plan tool sets the plan and answers with it', KO, async ($, on) => {
  engine(on)
  await start($)
  const out = await $.tool.call({ tool: TOOL, ...PLAN })
  expect(String(out.result)).toContain('Plan: 로그인 기능 추가 (0/5 done)')
  const next = await $.tool.call({ tool: TOOL, op: 'next' })
  expect(String(next.result)).toContain('1 조사 - in_progress')
})

test('a subagent cannot change the plan', KO, async ($, on) => {
  engine(on)
  await start($)
  const out = await $.tool.call({ tool: TOOL, ...PLAN, agentId: 'a1' })
  expect(out.deny).toContain('main conversation')
})

test('with enforce off, edits run without a plan', KO, async ($, on) => {
  engine(on)
  await start($)
  const out = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(out.deny).toBeUndefined()
  expect(out.result).toBe('ran')
  // The first such call with no plan carries one reminder for the model; later ones run bare.
  expect(out.context).toEqual([REMINDER])
  expect((await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })).context).toBeUndefined()
})

test('a running step that piles up changes gets one note to split it into checkpoints', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  const notes: string[] = []
  for (let i = 0; i < LONG_STEP + 3; i++) {
    const out = await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
    notes.push((out.context ?? []).join(' '))
  }
  expect(notes.filter(n => n.includes('op "add"'))).toHaveLength(1)
  expect(notes[LONG_STEP - 1]).toContain('조사')
})

test('a read-only call does not use up the reminder', KO, async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran', isReadOnly: true }))
  engine(on)
  await start($)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).context).toBeUndefined()
  expect((await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })).context).toEqual([REMINDER])
})

test('with enforce on, edits wait for a plan, three times at most per turn', { options: { enforce: true, language: 'ko' } }, async ($, on) => {
  engine(on)
  await start($)
  for (let i = 0; i < 3; i++) expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toContain('"op":"set"')
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
})

test('with enforce on, a plan lets edits through', { options: { enforce: true, language: 'ko' } }, async ($, on) => {
  engine(on)
  await start($)
  expect((await $.tool.call({ tool: 'Write', file_path: '/a', content: '' })).deny).toBeDefined()
  await $.tool.call({ tool: TOOL, ...PLAN })
  expect((await $.tool.call({ tool: 'Write', file_path: '/a', content: '' })).deny).toBeUndefined()
  // Reading is never held.
  expect((await $.tool.call({ tool: 'Read', file_path: '/a' })).deny).toBeUndefined()
})

test('the tree shows above the prompt once a plan exists', KO, async ($, on) => {
  engine(on)
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeUndefined()
  await $.tool.call({ tool: TOOL, ...PLAN })
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: / 조사/ })).toBeDefined()
  // A survey holds the band: the tree steps aside.
  await band.redraw({ ...BAND.props, hasSurvey: true })
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeUndefined()
  await band.unmount()
})

test('pressing the band title folds it and pressing again unfolds it, and the flowchart button is the main one', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const buttons = await band.findAll({ type: 'Button' })
  expect(buttons.find(b => b.key === 'open-flow')?.props.variant).toBe('primary')
  expect(buttons.find(b => b.key === 'fold-band')?.props.variant).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /접기|펼치기/ })).toBeUndefined()
  await band.press({ key: 'fold-band' })
  await band.redraw()
  expect(await band.find({ type: 'Text', text: / 조사/ })).toBeUndefined()
  await band.press({ key: 'fold-band' })
  await band.redraw()
  expect(await band.find({ type: 'Text', text: / 조사/ })).toBeDefined()
  await band.unmount()
})

test('with autoShow off, nothing shows above the prompt until /flow', { options: { autoShow: false, language: 'ko' } }, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeUndefined()
  await $.command.run(FLOW)
  await band.redraw()
  // The drawer is on screen: the band steps aside until it closes.
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeUndefined()
  await $.command.run(FLOW)
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeDefined()
  await band.unmount()
})

test('on the desktop app the drawer draws each stage as a rounded card joined by lines, and presses still fold, pick and switch to the list', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  await $.tool.call({ tool: TOOL, op: 'next' })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const cards = async () => (await pane.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'round')
  // 조사 is running: its card is drawn in text colour, the others muted.
  expect((await cards()).map(c => c.props.borderColor)).toEqual(['text', 'inactive', 'inactive'])
  expect((await pane.findAll({ type: 'Svg' })).length).toBeGreaterThanOrEqual(2)
  expect(await pane.find({ type: 'Text', text: /로그인 화면/ })).toBeUndefined()
  await pane.press({ key: '2' })
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /로그인 화면/ })).toBeDefined()
  await pane.press({ key: '2.1' })
  await pane.redraw()
  expect(await pane.find({ type: 'Button', key: 'ask' })).toBeDefined()
  await pane.press({ key: 'view' })
  await pane.redraw()
  expect(await cards()).toHaveLength(0)
  expect(await pane.find({ type: 'Text', text: /├─/ })).toBeDefined()
  await pane.unmount()
})

test('the terminal drawer keeps the character flowchart', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'round')).toHaveLength(0)
  expect(await pane.find({ type: 'Text', text: /╭─/ })).toBeDefined()
  await pane.unmount()
})

test('/flow opens the drawer and closes it again', KO, async ($, on) => {
  engine(on)
  await start($)
  expect((await $.command.run(FLOW)).text).toBe('흐름도를 열었어요')
  expect((await $.command.run(FLOW)).text).toBe('흐름도를 닫았어요')
})

test('the tree hides five seconds after everything is done', KO, async ($, on) => {
  const clock = engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, op: 'set', title: '짧은 일', nodes: [{ title: '하나' }] })
  await $.tool.call({ tool: TOOL, op: 'next' })
  await $.tool.call({ tool: TOOL, op: 'next' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /짧은 일/ })).toBeDefined()
  await clock.advance(6_000)
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /짧은 일/ })).toBeUndefined()
  await band.unmount()
})

test('in the drawer, Enter on a folded box unfolds it and the focus is kept', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  await $.tool.call({ tool: TOOL, op: 'next' })
  await $.tool.call({ tool: TOOL, op: 'next' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    // The buttons that fold every box, then the rows in the order they are drawn; the running stage holds the ring.
    expect((await pane.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['expand-all', 'collapse-all', 'view', '1', '2', '2.1', '2.2', '3'])
    // The drawer's own buttons are drawn as buttons, with no hotkey; the boxes stay plain rows.
    const expand = (await pane.find({ type: 'Button', key: 'expand-all' }))?.props
    expect(expand?.label).toBe('모두 펼치기')
    expect(expand?.plain).toBeUndefined()
    expect(expand?.hotkey).toBeUndefined()
    expect((await pane.find({ type: 'Button', key: '2' }))?.props.plain).toBe(true)
    // The list button swaps the flowchart for the tree and back.
    await pane.press({ key: 'view' })
    expect((await pane.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['view', '1', '2.1', '2.2'])
    await pane.press({ key: 'view' })
    expect((await pane.find({ type: 'Button', key: '2' }))?.props.autoFocus).toBe(true)
    // ↓ moves the ring to the next box; a redraw keeps it there.
    await personMoves($, '3')
    await pane.redraw()
    expect((await pane.find({ type: 'Button', key: '3' }))?.props.autoFocus).toBe(true)
    expect((await pane.find({ type: 'Button', key: '2' }))?.props.autoFocus).toBeUndefined()
    // Enter on the folded box unfolds it; again folds it.
    expect(await pane.find({ type: 'Text', text: /스테이징/ })).toBeUndefined()
    await pane.press({ key: '3' })
    expect(await pane.find({ type: 'Text', text: /스테이징/ })).toBeDefined()
    await pane.press({ key: '3' })
    expect(await pane.find({ type: 'Text', text: /스테이징/ })).toBeUndefined()
    await personMoves($, '2')
    await pane.unmount()
  }
})

test('a resumed session gets its plan back', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  await start($)
  expect(String((await $.tool.call({ tool: TOOL, op: 'show' })).result)).toContain('Plan: 로그인 기능 추가')
})

test('in the drawer, 확인 완료 under a step waiting for a check finishes it and tells Claude; 논의 starts a draft', KO, async ($, on) => {
  engine(on)
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => ((context = e.context ?? []), { text: e.text, context }))
  let draft = ''
  on('prompt.fill', (_, e) => ((draft = e.text), { isFilled: true }))
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  await $.tool.call({ tool: TOOL, op: 'update', updates: [{ id: '1', status: 'needs_check', note: '화면 보기' }] })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: '1' })
  await pane.press({ key: 'ask' })
  expect(draft).toBe('[조사] ')
  await pane.press({ key: 'confirm' })
  const shown = String((await $.tool.call({ tool: TOOL, op: 'show' })).result)
  expect(shown).toContain('1 조사 - completed')
  // What to look at goes with the check.
  expect(shown).not.toContain('화면 보기')
  expect(await pane.find({ type: 'Button', key: 'confirm' })).toBeUndefined()
  await $.prompt.submit({ text: '계속', wait: false, origin: { kind: 'composer' } })
  expect(context[0]).toContain('"조사" (id 1) marked completed')
  // Told once: the request after that no longer carries it.
  await $.prompt.submit({ text: '다음', wait: false, origin: { kind: 'composer' } })
  expect(context[0]).not.toContain('marked completed')
})

test('each request carries the board to the model, and a detour parks the plan with a toast', KO, async ($, on) => {
  engine(on)
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => ((context = e.context ?? []), { text: e.text, context }))
  await start($)
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  expect(context).toEqual([NO_PLAN_NOTE])
  await $.tool.call({ tool: TOOL, ...PLAN })
  await $.prompt.submit({ text: '그 전에 버그 하나만', wait: false, origin: { kind: 'composer' } })
  expect(context[0]).toContain('In hand: "로그인 기능 추가"')
  const refused = await $.tool.call({ tool: TOOL, op: 'set', title: '버그', nodes: [{ title: '재현' }] })
  expect(String(refused.result)).toContain('previous "park"')
  await $.tool.call({ tool: TOOL, op: 'set', title: '버그', nodes: [{ title: '재현' }], previous: 'park' })
  expect(toasts).toContain('"로그인 기능 추가" 보관 · "버그" 시작')
  // A new session start (a reload) finds the shelf again.
  await start($)
  await $.prompt.submit({ text: '계속', wait: false, origin: { kind: 'composer' } })
  expect(context[0]).toContain('Parked: "로그인 기능 추가" (0/5)')
})

test('/flow demo shows canned boards above the prompt and leaves the real plan alone', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, op: 'set', title: '진짜 계획', nodes: [{ title: '첫 단계' }] })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const demo = (args: string) => $.command.run({ ...FLOW, args })
  expect((await demo('demo')).text).toContain('시연 1/10: 기본 진행')
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /시연 1\/10/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeDefined()
  expect((await demo('demo next')).text).toContain('시연 2/10: 긴 계획')
  expect((await demo('demo detour')).text).toContain('보관 후 복귀')
  expect((await demo('demo nope')).text).toContain('그런 시연이 없어요')
  await demo('demo stop')
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /시연/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /진짜 계획/ })).toBeDefined()
  expect(String((await $.tool.call({ tool: TOOL, op: 'show' })).result)).toContain('Plan: 진짜 계획')
  await band.unmount()
})

test('the band keeps what another plugin draws above the prompt, under the tree', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await band.unmount()
})
