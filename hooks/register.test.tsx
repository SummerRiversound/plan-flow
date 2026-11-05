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

test('on the desktop app the band is set in the app type: the title folds it, progress is a picture, steps step in by level, and the flowchart button is primary', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  await $.tool.call({ tool: TOOL, op: 'next' })
  await $.tool.call({ tool: TOOL, op: 'next' })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.findAll({ type: 'Text' })).some(x => x.props.mono === true)).toBe(false)
  expect((await band.findAll({ type: 'Text' })).some(x => /[├└│]/.test(String(x.props.children)))).toBe(false)
  expect((await band.findAll({ type: 'Svg' })).some(x => /진행/.test(String(x.props.alt)))).toBe(true)
  expect((await band.find({ type: 'Button', key: 'open-flow' }))?.props.variant).toBe('primary')
  expect(await band.find({ type: 'Text', text: /로그인 화면/ })).toBeDefined()
  // A step one level down sits further in than its stage.
  expect((await band.findAll({ type: 'Box' })).some(b => typeof b.props.paddingLeft === 'number' && b.props.paddingLeft > 0)).toBe(true)
  // The whole title row folds the band.
  await band.pointer({ type: 'up', x: 40, y: 0, button: 'left', in: 'band-title' })
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /로그인 화면/ })).toBeUndefined()
  expect(JSON.stringify(await band.drawn({ in: 'band-title' }))).toContain('로그인 기능 추가')
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
  const cards = async () => (await pane.findAll({ type: 'Box' })).filter(b => typeof b.key === 'string' && b.key.startsWith('card-'))
  // 조사 is running: its card's edge is stronger than the others'.
  const edges = (await cards()).map(c => String(c.props.borderColor))
  expect(edges).toHaveLength(3)
  expect(edges[1]).toBe(edges[2])
  expect(edges[0]).not.toBe(edges[1])
  expect((await pane.findAll({ type: 'Svg' })).length).toBeGreaterThanOrEqual(2)
  const rows = async () => (await pane.findAll({ type: 'Client' })).map(c => c.key)
  expect(await rows()).not.toContain('step-2.1')
  // A click anywhere on a stage's row unfolds it.
  await pane.pointer({ type: 'up', x: 30, y: 0, button: 'left', in: 'step-2' })
  await pane.redraw()
  expect(await rows()).toContain('step-2.1')
  // An open card's rows are split by hairlines.
  expect((await pane.findAll({ type: 'Svg' })).some(x => x.props.alt === '구분선' && x.props.height === 1)).toBe(true)
  expect((await pane.findAll({ type: 'Box' })).some(b => b.key === 'row-2.1')).toBe(true)
  // Enter on a step's row picks it.
  await pane.key({ key: 'return', in: 'step-2.1' })
  await pane.redraw()
  // The step's buttons are the ones to press: primary, at the right, apart from the text.
  expect((await pane.find({ type: 'Button', key: 'ask' }))?.props.variant).toBe('primary')
  expect((await pane.findAll({ type: 'Box' })).some(b => b.props.justifyContent === 'flex-end' && b.props.marginTop !== undefined)).toBe(true)
  await pane.press({ key: 'view' })
  await pane.redraw()
  // The list keeps the character tree under the app-type head, and the switch back.
  expect(await cards()).toHaveLength(0)
  expect(await pane.find({ type: 'Text', text: /├─/ })).toBeDefined()
  expect((await pane.find({ type: 'Text', text: /^로그인 기능 추가$/ }))?.props.size).toBe('heading')
  expect(await pane.find({ type: 'Button', key: 'view' })).toBeDefined()
  await pane.unmount()
})

test('in the editor the drawer head is set in the app type: a heading title, a progress bar picture and counts that hold their width', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  await $.tool.call({ tool: TOOL, op: 'next' })
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const texts = await pane.findAll({ type: 'Text' })
  expect(texts.some(x => x.props.mono === true)).toBe(false)
  expect((await pane.find({ type: 'Text', text: /^로그인 기능 추가$/ }))?.props.size).toBe('heading')
  expect((await pane.findAll({ type: 'Svg' })).some(x => /진행/.test(String(x.props.alt)))).toBe(true)
  expect((await pane.find({ type: 'Text', text: /^\d+\/\d+ · \d+%$/ }))?.props.tabular).toBe(true)
  // The running stage's title weighs more; one still to come reads plain. Counts are smaller.
  expect((await pane.find({ type: 'Text', text: /조사$/ }))?.props.weight).toBe('semibold')
  expect((await pane.find({ type: 'Text', text: /구현$/ }))?.props.weight).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: /^0\/2 ▸$/ }))?.props.size).toBe('footnote')
  await pane.unmount()
})

test('in the editor each task that runs with its siblings carries a small 동시에 pill beside its title, at their level, and links sit at the end of the row', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, op: 'set', title: '갈래', nodes: [{ title: '묶음', children: [{ title: '먼저' }, { title: '혼자' }, { title: '같이', parallel: true, children: [{ title: '하나', links: ['https://github.com/o/r/pull/7'] }, { title: '둘' }] }] }] })
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  // One pill per task that runs together, none on a line of its own.
  const pills = await pane.findAll({ type: 'Text', text: /^동시에$/ })
  expect(pills).toHaveLength(2)
  expect(pills.every(p => p.props.size === 'caption')).toBe(true)
  expect(await pane.find({ type: 'Link' })).toBeDefined()
  // Counts keep their width, so they never break over lines.
  expect((await pane.findAll({ type: 'Box' })).filter(b => b.props.flexShrink === 0).length).toBeGreaterThanOrEqual(2)
  await pane.unmount()
})

test('on the desktop app each step row is one Client: the mark, the title, the pill and the count in one pressable row that lights under the pointer', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, op: 'set', title: '갈래', nodes: [{ title: '묶음', children: [{ title: '먼저' }, { title: '같이', parallel: true, children: [{ title: '하나' }, { title: '둘' }] }] }, { title: '끝', children: [{ title: '마무리' }] }] })
  await $.tool.call({ tool: TOOL, op: 'next' })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // No Button for a row: every row is a Client named after its step.
  expect((await pane.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['expand-all', 'collapse-all', 'view'])
  const clients = await pane.findAll({ type: 'Client' })
  expect(clients.map(c => c.key)).toEqual(['step-1', 'step-1.1', 'step-1.2.1', 'step-1.2.2', 'step-2'])
  const props = (key: string) => clients.find(c => c.key === key)?.props.props as { strong: boolean; pill: string | null; right: { text: string } | null }
  expect(props('step-1')).toMatchObject({ strong: true, right: { text: '0/3 ▾' } })
  expect(props('step-2')).toMatchObject({ strong: false, right: { text: '0/1 ▸' } })
  expect([props('step-1.2.1')?.pill, props('step-1.2.2')?.pill, props('step-1.1')?.pill]).toEqual(['동시에', '동시에', null])
  // The row draws its own title and count, and fills under the pointer.
  expect(JSON.stringify(await pane.drawn({ in: 'step-2' }))).toContain('0/1 ▸')
  expect(JSON.stringify(await pane.drawn({ in: 'step-2' }))).not.toContain('backgroundColor')
  await pane.pointer({ type: 'enter', x: 0, y: 0, in: 'step-2' })
  expect(JSON.stringify(await pane.drawn({ in: 'step-2' }))).toContain('backgroundColor')
  await pane.unmount()
})

test('on the desktop app every line between cards says what it is, and cards side by side each fill their half', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, op: 'set', title: '동시에', nodes: [{ title: '갈래', parallel: true, children: [{ title: '왼쪽' }, { title: '오른쪽' }] }, { title: '마무리' }] })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const lines = await pane.findAll({ type: 'Svg' })
  expect(lines.length).toBeGreaterThanOrEqual(2)
  // An Svg with no alt is dropped by the app.
  expect(lines.every(l => typeof l.props.alt === 'string' && l.props.alt !== '')).toBe(true)
  const halves = (await pane.findAll({ type: 'Box' })).filter(b => b.props.width === '50%')
  expect(halves).toHaveLength(2)
  // A column, so the card inside stretches across its half.
  expect(halves.every(b => b.props.flexDirection === 'column')).toBe(true)
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
  // The surfaces whose rows are Buttons; the desktop app's rows are Clients, tested on their own.
  for (const surface of ['terminal', 'vscode'] as const) {
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
