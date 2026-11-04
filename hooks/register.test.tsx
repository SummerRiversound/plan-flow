import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

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
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
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

test('the plan tool sets the plan and answers with it', async ($, on) => {
  engine(on)
  await start($)
  const out = await $.tool.call({ tool: TOOL, ...PLAN })
  expect(String(out.result)).toContain('Plan: 로그인 기능 추가 (0/5 done)')
  const next = await $.tool.call({ tool: TOOL, op: 'next' })
  expect(String(next.result)).toContain('1 조사 - in_progress')
})

test('a subagent cannot change the plan', async ($, on) => {
  engine(on)
  await start($)
  const out = await $.tool.call({ tool: TOOL, ...PLAN, agentId: 'a1' })
  expect(out.deny).toContain('main conversation')
})

test('with enforce off, edits run without a plan', async ($, on) => {
  engine(on)
  await start($)
  const out = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(out.deny).toBeUndefined()
})

test('with enforce on, edits wait for a plan, three times at most per turn', { options: { enforce: true } }, async ($, on) => {
  engine(on)
  await start($)
  for (let i = 0; i < 3; i++) expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toContain('"op":"set"')
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBeUndefined()
})

test('with enforce on, a plan lets edits through', { options: { enforce: true } }, async ($, on) => {
  engine(on)
  await start($)
  expect((await $.tool.call({ tool: 'Write', file_path: '/a', content: '' })).deny).toBeDefined()
  await $.tool.call({ tool: TOOL, ...PLAN })
  expect((await $.tool.call({ tool: 'Write', file_path: '/a', content: '' })).deny).toBeUndefined()
  // Reading is never held.
  expect((await $.tool.call({ tool: 'Read', file_path: '/a' })).deny).toBeUndefined()
})

test('the tree shows above the prompt once a plan exists', async ($, on) => {
  engine(on)
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeUndefined()
  await $.tool.call({ tool: TOOL, ...PLAN })
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /1 조사/ })).toBeDefined()
  // A survey holds the band: the tree steps aside.
  await band.redraw({ ...BAND.props, hasSurvey: true })
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeUndefined()
  await band.unmount()
})

test('with autoShow off, nothing shows above the prompt until /flow', { options: { autoShow: false } }, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeUndefined()
  await $.command.run(FLOW)
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeDefined()
  await band.unmount()
})

test('/flow opens the drawer and closes it again', async ($, on) => {
  engine(on)
  await start($)
  expect((await $.command.run(FLOW)).text).toBe('흐름도를 열었어요')
  expect((await $.command.run(FLOW)).text).toBe('흐름도를 닫았어요')
})

test('the tree hides five seconds after everything is done', async ($, on) => {
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

test('in the drawer, Enter on a folded box unfolds it and the focus is kept', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  await $.tool.call({ tool: TOOL, op: 'next' })
  await $.tool.call({ tool: TOOL, op: 'next' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    // Boxes that fold are buttons in the order they are drawn; the running stage holds the ring.
    expect((await pane.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['2', '3'])
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

test('a resumed session gets its plan back', async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: TOOL, ...PLAN })
  await start($)
  expect(String((await $.tool.call({ tool: TOOL, op: 'show' })).result)).toContain('Plan: 로그인 기능 추가')
})
