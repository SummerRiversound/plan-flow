import { expect, mock, test } from 'claude-code/testing'
import { joinSvg, splitSvg } from './gui'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { setLanguage } from './i18n'
import { plannerIdle } from './register'

// The expectations below are written in Korean.
setLanguage('ko')
const KO = { options: { language: 'ko' } }

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

// The side planner's answers, one list of ops per look, and the prompts it was handed.
const replies: unknown[][] = []
const asked: string[] = []
// What the plugins registered as tools, and the context the last request reached the model with.
const registered: string[] = []
let handedContext: readonly string[] | undefined
const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
let theClock: ReturnType<typeof mock.clock> | undefined
const TURN = { answer: '했어요', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
// A turn ends and the planner answers with `ops`: the board as the person would then see it.
const plan = async ($: Engine, ...ops: object[]) => {
  replies.push(ops)
  await $.turn.complete(TURN as never)
  await theClock?.advance(1)
  await plannerIdle()
}
// The board as the planner is handed it on its next look.
const shown = async ($: Engine) => {
  await plan($)
  return asked[asked.length - 1] ?? ''
}

// The fork's answers, one list of ops per fork, and the prompts it was handed.
const forkReplies: unknown[][] = []
const forked: string[] = []
// One model request of the main turn ends with `answer` and, unless it is the last, a tool call to run.
const step = async ($: Engine, answer: string, isLast = false) => {
  stepAnswer = { answer, toolUses: isLast ? [] : [{ id: 'u1', name: 'Bash', input: {} }] }
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'opus', messageCount: 2 })) void _
  await theClock?.advance(1)
  await plannerIdle()
}
// Claude works on with no answer: `requests` model requests of the main turn.
const work = async ($: Engine, requests = 20) => {
  for (let i = 0; i < requests; i++) await step($, '')
}
let stepAnswer: { answer: string; toolUses: unknown[] } = { answer: '', toolUses: [] }
// How long the fork takes to answer, on the test's clock, and what it reports having used.
let forkWait = 0
let forkUsage = NO_USAGE
// The mod's store, as the engine keeps it.
const stored = new Map<string, unknown>()

// Toasts the plugin raised, newest last.
const toasts: string[] = []

// The engine beneath the plugin: each hook answers what the session would.
const engine = (on: On) => {
  const clock = mock.clock(on, { now: 1_000 })
  theClock = clock
  registered.length = 0
  handedContext = undefined
  replies.length = 0
  asked.length = 0
  on('model.complete', (_, e) => {
    asked.push(e.prompt)
    const next = replies.shift()
    return { value: next === undefined ? { isAnswered: false, reason: 'api-error', status: 500, error: 'api_error', usage: NO_USAGE } : { isAnswered: true, text: JSON.stringify(next), usage: NO_USAGE } } as never
  })
  forkReplies.length = 0
  forked.length = 0
  forkWait = 0
  on('model.fork', async (_, e) => {
    forked.push(e.prompt)
    const next = forkReplies.shift()
    if (forkWait > 0) await clock.sleep(forkWait)
    return { value: next === undefined ? { isAnswered: false, reason: 'nothing-to-fork' } : { isAnswered: true, text: JSON.stringify(next), usage: forkUsage } } as never
  })
  forkUsage = NO_USAGE
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

test('nothing of plan-flow reaches what Claude reads: no tool, no system prompt section, no note on a request, nothing on a tool result', KO, async ($, on) => {
  engine(on)
  await start($)
  expect(registered).toEqual([])
  const composed = await $.prompt.compose({ traits: [], tools: [], sections: [] } as never)
  expect(composed.sections ?? []).toEqual([])
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  expect(handedContext ?? []).toEqual([])
  await plan($, PLAN)
  await $.prompt.submit({ text: '계속', wait: false, origin: { kind: 'composer' } })
  expect(handedContext ?? []).toEqual([])
  for (let i = 0; i < 12; i++) {
    const out = await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
    expect(out.context).toBeUndefined()
    expect(out.deny).toBeUndefined()
  }
})

test('after a turn the side planner sets the board from the request, the calls and the answer', KO, async ($, on) => {
  engine(on)
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: '테스트 돌리기' })
  await plan($, PLAN)
  const handed = asked[asked.length - 1] ?? ''
  expect(handed).toContain('The person asked: 로그인 만들어줘')
  expect(handed).toContain('Claude ran: 테스트 돌리기')
  expect(handed).toContain('Claude answered: 했어요')
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeDefined()
  // The next look carries only what is new, with the request it serves.
  await $.tool.call({ tool: 'Edit', file_path: '/repo/login.ts', old_string: 'a', new_string: 'b' })
  await plan($, { op: 'next' })
  const again = asked[asked.length - 1] ?? ''
  expect(again).toContain('The person asked: 로그인 만들어줘')
  expect(again).toContain('Claude ran: Edit login.ts')
  expect(again).not.toContain('테스트 돌리기')
  expect(again).toContain('Plan: 로그인 기능 추가')
  await band.unmount()
})

test('a step is always running while work is open, even when the planner only marks steps done', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, PLAN)
  expect(await shown($)).toContain('1 조사 - in_progress')
  await plan($, { op: 'update', updates: [{ id: '1', status: 'completed' }] })
  expect(await shown($)).toContain('2.1 로그인 화면 - in_progress')
})

test('the planner looks again while Claude works, after six calls that change something', KO, async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran', isReadOnly: true }))
  engine(on)
  await start($)
  replies.push([PLAN])
  for (let i = 0; i < 5; i++) await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
  await theClock?.advance(1)
  await plannerIdle()
  expect(asked).toHaveLength(0)
  await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
  await theClock?.advance(1)
  await plannerIdle()
  expect(asked).toHaveLength(1)
  // A read-only call is not work.
  for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
  await theClock?.advance(1)
  await plannerIdle()
  expect(asked).toHaveLength(1)
})

test('a call that failed reaches the planner marked as failed', KO, async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: '1 failing', isError: true }) as never)
  engine(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: '테스트 돌리기' })
  await plan($, PLAN)
  expect(asked[asked.length - 1]).toContain('Claude ran: 테스트 돌리기 (failed)')
})

test('reading is heard too, and a minute of it makes the planner look again', KO, async ($, on) => {
  engine(on)
  await start($)
  replies.push([PLAN])
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/cart.js' } as never)
  await theClock?.advance(1)
  await plannerIdle()
  expect(asked).toHaveLength(0)
  await theClock?.advance(60_000)
  await $.tool.call({ tool: 'Grep', pattern: 'total' } as never)
  await theClock?.advance(1)
  await plannerIdle()
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('Claude ran: Read cart.js')
  expect(asked[0]).toContain('Claude ran: Grep total')
})

test("what Claude says between its calls reaches the planner and makes it look; the turn's last words come as the answer", KO, async ($, on) => {
  engine(on)
  await start($)
  replies.push([PLAN])
  await step($, '이제 리뷰 결과를 확인할게요')
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('Claude said: 이제 리뷰 결과를 확인할게요')
  await step($, '끝났어요', true)
  expect(asked).toHaveLength(1)
})

test('while Claude works the planner looks at most once every 20 seconds, and what came in meanwhile goes with the next look', KO, async ($, on) => {
  engine(on)
  await start($)
  replies.push([PLAN])
  await step($, '먼저 구조를 볼게요')
  expect(asked).toHaveLength(1)
  await step($, '이제 화면을 고칠게요')
  await step($, '테스트를 돌릴게요')
  expect(asked).toHaveLength(1)
  await theClock?.advance(20_000)
  await plannerIdle()
  expect(asked).toHaveLength(2)
  expect(asked[1]).toContain('Claude said: 이제 화면을 고칠게요')
  expect(asked[1]).toContain('Claude said: 테스트를 돌릴게요')
  // The answer is looked at at once.
  await plan($)
  expect(asked).toHaveLength(3)
})

test('Claude designs the plan in a fork of the main conversation only when the board was left off: at an answer after work that the planner changed nothing for', KO, async ($, on) => {
  engine(on)
  await start($)
  replies.push([PLAN])
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await theClock?.advance(1)
  await plannerIdle()
  // The planner moves the board at the answer: Claude is not asked, however long the work ran.
  await work($, 45)
  expect(forked).toHaveLength(0)
  await plan($, { op: 'next' })
  expect(forked).toHaveLength(0)
  // The planner leaves the board as it was after work: Claude says where the work stands.
  await $.prompt.submit({ text: '테스트도 더해줘', wait: false, origin: { kind: 'composer' } })
  await step($, '')
  forkReplies.push([{ op: 'update', goal: '아이디로 로그인할 수 있다' }, { op: 'add', nodes: [{ title: '리뷰 반영', detail: '받은 리뷰를 고친다.' }] }, { op: 'cancel' }])
  await plan($)
  expect(forked).toHaveLength(1)
  expect(forked[0]).toContain('Plan: 로그인 기능 추가')
  // It mends a board left off, so it is told what the board is read for.
  expect(forked[0]).toContain('all five hold')
  const board = await shown($)
  expect(board).toContain('Goal: 아이디로 로그인할 수 있다')
  expect(board).toContain('리뷰 반영')
  // The fork reshapes the plan; it does not end it.
  expect(board).toContain('Plan: 로그인 기능 추가')
  // An answer with no work behind it (a question explained) forks nothing, changed or not.
  await $.prompt.submit({ text: '이거 뭐야?', wait: false, origin: { kind: 'composer' } })
  await step($, '설명할게요', true)
  await plan($)
  expect(forked).toHaveLength(1)
})

test('a design that gets no answer is owed: the next answer after work asks again, though the planner moved the board', KO, async ($, on) => {
  engine(on)
  await start($)
  replies.push([PLAN])
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await theClock?.advance(1)
  await plannerIdle()
  await step($, '')
  // The fork gives nothing back, as when the model is busy.
  forkWait = 200_000
  replies.push([])
  await $.turn.complete(TURN as never)
  await theClock?.advance(200_000)
  await plannerIdle()
  forkWait = 0
  expect(forked).toHaveLength(1)
  await $.prompt.submit({ text: '이어서 해줘', wait: false, origin: { kind: 'composer' } })
  await theClock?.advance(1)
  await plannerIdle()
  await step($, '')
  forkReplies.push([{ op: 'update', goal: '아이디로 로그인할 수 있다' }])
  await plan($, { op: 'next' })
  expect(forked).toHaveLength(2)
  expect(await shown($)).toContain('Goal: 아이디로 로그인할 수 있다')
})

test('a finished plan the planner left as it was is designed too, so what the answer left for later is drawn after it', KO, async ($, on) => {
  engine(on)
  await start($)
  replies.push([{ op: 'set', title: '오타 수정', nodes: [{ title: '안내 문구' }] }])
  await $.prompt.submit({ text: '오타 고쳐줘', wait: false, origin: { kind: 'composer' } })
  await theClock?.advance(1)
  await plannerIdle()
  await step($, '')
  await plan($, { op: 'next' })
  expect(forked).toHaveLength(0)
  await $.prompt.submit({ text: '배포는?', wait: false, origin: { kind: 'composer' } })
  await step($, '')
  forkReplies.push([{ op: 'update', updates: [], expected: ['배포 승인 뒤 운영 반영'] }])
  await plan($)
  expect(forked).toHaveLength(1)
  expect(forked[0]).toContain('1 안내 문구 - completed')
  expect(await shown($)).toContain('배포 승인 뒤 운영 반영')
})

test('a plan that comes back from the shelf is designed at the next answer, however little work that turn ran', KO, async ($, on) => {
  engine(on)
  await start($)
  replies.push([PLAN])
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await theClock?.advance(1)
  await plannerIdle()
  forkReplies.push([])
  await step($, '')
  await plan($)
  expect(forked).toHaveLength(1)
  // A small detour takes the board and ends, too little work for a design of its own: the login plan is
  // back as the planner left it, before the work done meanwhile.
  await $.prompt.submit({ text: '잠깐 오타부터', wait: false, origin: { kind: 'composer' } })
  await step($, '')
  await plan($, { op: 'set', title: '오타 수정', nodes: [{ title: '안내 문구' }], previous: 'park' })
  expect(forked).toHaveLength(1)
  await $.prompt.submit({ text: '고쳐', wait: false, origin: { kind: 'composer' } })
  await step($, '')
  forkReplies.push([{ op: 'update', updates: [{ id: '1', status: 'completed' }] }])
  await plan($, { op: 'next' })
  expect(forked).toHaveLength(2)
  expect(forked[1]).toContain('Plan: 로그인 기능 추가')
  expect(await shown($)).toContain('1 조사 - completed')
})

test("each design call's token use is kept, so a fork that missed the conversation's cache shows", KO, async ($, on) => {
  engine(on)
  await start($)
  replies.push([PLAN])
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await theClock?.advance(1)
  await plannerIdle()
  forkUsage = { input_tokens: 1_500, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 240_000 }
  forkReplies.push([{ op: 'update', goal: '아이디로 로그인할 수 있다' }])
  await step($, '')
  await plan($)
  expect(keptCalls().find(c => c.call === 'design')).toMatchObject({ result: 'answered', usage: { input: 1_500, cacheRead: 240_000, cacheWrite: 0, output: 400 } })
})

test("a subagent's calls reach the planner as the subagent's", KO, async ($, on) => {
  engine(on)
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/cart.js', old_string: 'a', new_string: 'b', agentId: 'a1' } as never)
  await plan($, PLAN)
  expect(asked[asked.length - 1]).toContain('A subagent ran: Edit cart.js')
})

test("a background task's notice is not the person's request", KO, async ($, on) => {
  engine(on)
  await start($)
  await $.prompt.submit({ text: '버그 고쳐줘', wait: false, origin: { kind: 'composer' } })
  await plan($, PLAN)
  const notice = '<task-notification>\n<status>completed</status>\n<summary>Agent "Explore cart" finished</summary>\n<result>long report</result>\n</task-notification>'
  await $.prompt.submit({ text: notice, wait: false, origin: { kind: 'task-notification' } } as never)
  await plan($, { op: 'next' })
  const handed = asked[asked.length - 1] ?? ''
  expect(handed).toContain('The person asked: 버그 고쳐줘')
  expect(handed).toContain('Claude was told: Agent "Explore cart" finished')
  expect(handed).not.toContain('long report')
})

test('a planner call that fails keeps what happened for the next look', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.prompt.submit({ text: '버그 고쳐줘', wait: false, origin: { kind: 'composer' } })
  // No reply queued: the call fails.
  await $.turn.complete(TURN as never)
  await theClock?.advance(1)
  await plannerIdle()
  await plan($, { op: 'set', title: '버그', nodes: [{ title: '재현' }] })
  expect(asked[asked.length - 1]).toContain('The person asked: 버그 고쳐줘')
  expect(await shown($)).toContain('Plan: 버그')
})

// The calls the mod kept for session s1, oldest first.
type Kept = { at: number; call: string; ms: number; result: string; ops?: number; reason?: string; usage?: Record<string, number> }
const NONE_USED = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
const keptCalls = (): Kept[] => (stored.get('calls') as Record<string, { calls: Kept[] }> | undefined)?.s1?.calls ?? []

test('a look that fails is tried once more a little later, and what it brings lands on the board', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  // No reply queued: the call fails.
  await theClock?.advance(1)
  await plannerIdle()
  expect(asked).toHaveLength(1)
  replies.push([PLAN])
  await theClock?.advance(15_000)
  await plannerIdle()
  expect(asked).toHaveLength(2)
  expect(asked[1]).toContain('The person asked: 로그인 만들어줘')
  expect(await shown($)).toContain('Plan: 로그인 기능 추가')
  // A retry that fails too waits for the next thing to happen: one retry per failure, no storm.
  const before = asked.length
  await $.turn.complete(TURN as never)
  await theClock?.advance(1)
  await plannerIdle()
  await theClock?.advance(15_000)
  await plannerIdle()
  await theClock?.advance(600_000)
  await plannerIdle()
  expect(asked).toHaveLength(before + 2)
})

test('a design call that hangs does not hold back the looks after it, and is given up after two minutes', KO, async ($, on) => {
  engine(on)
  forkWait = 600_000
  forkReplies.push([{ op: 'update', goal: '늦은 목표' }])
  await start($)
  replies.push([PLAN])
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await theClock?.advance(1)
  await plannerIdle()
  // The design is asked at an answer after work the planner changed nothing for.
  await step($, '')
  replies.push([])
  await $.turn.complete(TURN as never)
  await theClock?.advance(1)
  expect(forked).toHaveLength(1)
  // The fork is still out; the next answer's look lands all the same.
  replies.push([{ op: 'update', updates: [{ id: '1', status: 'completed' }] }])
  await $.turn.complete(TURN as never)
  await theClock?.advance(1)
  expect(asked).toHaveLength(3)
  await theClock?.advance(120_000)
  await plannerIdle()
  const board = await shown($)
  expect(board).toContain('1 조사 - completed')
  // Given up: its answer, when it comes, does not land.
  await theClock?.advance(600_000)
  await plannerIdle()
  expect(await shown($)).not.toContain('늦은 목표')
  expect(keptCalls().find(c => c.call === 'design')).toMatchObject({ result: 'timed out', ms: 120_000 })
})

test('a design that comes back after the planner replaced the plan is not applied to the new one', KO, async ($, on) => {
  engine(on)
  forkWait = 30_000
  forkReplies.push([{ op: 'update', goal: '로그인 목표' }])
  await start($)
  replies.push([PLAN])
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await theClock?.advance(1)
  await plannerIdle()
  await step($, '')
  replies.push([])
  await $.turn.complete(TURN as never)
  await theClock?.advance(1)
  expect(forked).toHaveLength(1)
  replies.push([{ op: 'set', title: '버그', nodes: [{ title: '재현' }], previous: 'cancel' }])
  await $.turn.complete(TURN as never)
  await theClock?.advance(30_000)
  await plannerIdle()
  const board = await shown($)
  expect(board).toContain('Plan: 버그')
  expect(board).not.toContain('로그인 목표')
  expect(keptCalls().find(c => c.call === 'design')).toMatchObject({ result: 'stale' })
})

test('each planner and design call is kept in the store with when, how long, how it ended and the start of what it answered, the most recent 50 per session', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await theClock?.advance(1)
  await plannerIdle()
  replies.push([PLAN])
  forkReplies.push([{ op: 'update', goal: '아이디로 로그인할 수 있다' }])
  await theClock?.advance(15_000)
  await plannerIdle()
  await step($, '')
  await plan($)
  const kept = keptCalls()
  expect(kept).toEqual([
    { at: 1_000, call: 'look', ms: 0, result: 'failed', reason: 'api-error 500 api_error', usage: NONE_USED },
    { at: 16_000, call: 'look', ms: 0, result: 'answered', ops: 1, usage: NONE_USED, text: JSON.stringify([PLAN]) },
    expect.objectContaining({ call: 'look', result: 'answered', ops: 0 }),
    expect.objectContaining({ call: 'design', result: 'answered', ops: 1, text: '[{"op":"update","goal":"아이디로 로그인할 수 있다"}]' }),
  ])
  for (let i = 0; i < 60; i++) await plan($)
  const later = keptCalls()
  expect(later).toHaveLength(50)
  expect(later.at(-1)).toMatchObject({ call: 'look', result: 'answered', ops: 0 })
})

test('the tree shows above the prompt once a plan exists', KO, async ($, on) => {
  engine(on)
  await start($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeUndefined()
  await plan($, PLAN)
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
  await plan($, PLAN)
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
  await plan($, PLAN)
  await plan($, { op: 'next' })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.findAll({ type: 'Text' })).some(x => x.props.mono === true)).toBe(false)
  expect((await band.findAll({ type: 'Text' })).some(x => /[├└│]/.test(String(x.props.children)))).toBe(false)
  expect((await band.findAll({ type: 'Svg' })).some(x => /진행/.test(String(x.props.alt)))).toBe(true)
  expect((await band.find({ type: 'Button', key: 'open-flow' }))?.props.variant).toBe('primary')
  expect(await band.find({ type: 'Text', text: /로그인 화면/ })).toBeDefined()
  // A step one level down sits further in than its stage.
  expect((await band.findAll({ type: 'Box' })).some(b => typeof b.props.paddingLeft === 'number' && b.props.paddingLeft > 0)).toBe(true)
  // The fold arrow sits right after the title, not at the far end of the row.
  const title = (await band.find({ type: 'Client', key: 'band-title' }))?.props.props as { after: string | null; right: unknown }
  expect(title).toMatchObject({ after: '▴', right: null })
  // The whole title row folds the band.
  await band.pointer({ type: 'up', x: 40, y: 0, button: 'left', in: 'band-title' })
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /로그인 화면/ })).toBeUndefined()
  expect(JSON.stringify(await band.drawn({ in: 'band-title' }))).toContain('로그인 기능 추가')
  await band.unmount()
})

test('on the desktop app the band marks steps that run together with a tint, not a bordered box', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, { op: 'set', title: '갈래', nodes: [{ title: '같이', parallel: true, children: [{ title: '하나' }, { title: '둘' }] }, { title: '끝' }] })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  // The app pads a bordered box itself, which made the tag taller than its row.
  expect(await band.find({ type: 'Text', text: /^동시에$/ })).toBeDefined()
  expect((await band.findAll({ type: 'Box' })).some(b => b.props.borderStyle !== undefined)).toBe(false)
  await band.unmount()
})

test('a parked plan opens in the drawer to show its steps, on the desktop app and in the terminal', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, PLAN)
  await plan($, { op: 'set', title: '버그', nodes: [{ title: '재현' }], previous: 'park' })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: /로그인 화면/ })).toBeUndefined()
  // The whole row opens it, like any other row.
  await pane.pointer({ type: 'up', x: 30, y: 0, button: 'left', in: 'shelf-0' })
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /로그인 화면/ })).toBeDefined()
  await pane.pointer({ type: 'up', x: 30, y: 0, button: 'left', in: 'shelf-0' })
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /로그인 화면/ })).toBeUndefined()
  await pane.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await term.press({ key: 'shelf-0' })
  await term.redraw()
  expect(await term.find({ type: 'Text', text: /로그인 화면/ })).toBeDefined()
  await term.unmount()
})

test('with autoShow off, nothing shows above the prompt until /flow', { options: { autoShow: false, language: 'ko' } }, async ($, on) => {
  engine(on)
  await start($)
  await plan($, PLAN)
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

const flow = async ($: Engine, args: string) => (await $.command.run({ ...FLOW, args })).text

test('/flow off hides the board and calls no model in this session, a reload keeps it off, and /flow on looks at once', KO, async ($, on) => {
  engine(on)
  await start($)
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await plan($, PLAN)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeDefined()
  await $.command.run(FLOW)
  expect(await flow($, 'off')).toMatch(/껐어요/)
  // The drawer closes with it, and /flow says why it does not open.
  expect(await flow($, '')).toMatch(/\/flow on/)
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeUndefined()
  const looks = asked.length
  const forks = forked.length
  await $.prompt.submit({ text: '세션 저장도', wait: false, origin: { kind: 'composer' } })
  await step($, '저장을 붙여요')
  await plan($, { op: 'next' })
  await theClock?.advance(120_000)
  await plannerIdle()
  expect(asked.length).toBe(looks)
  expect(forked.length).toBe(forks)
  // A reload keeps the choice.
  await start($)
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeUndefined()
  expect(await flow($, 'on')).toMatch(/켰어요/)
  await theClock?.advance(1)
  await plannerIdle()
  // What happened while it was off is heard at once.
  expect(asked.length).toBe(looks + 1)
  expect(asked[asked.length - 1]).toContain('세션 저장도')
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeDefined()
  await band.unmount()
  // The drawer /flow off closed opens again.
  expect(await flow($, '')).toBe('흐름도를 열었어요')
})

test('with enabled off, a new session starts off until /flow on', { options: { enabled: false, language: 'ko' } }, async ($, on) => {
  engine(on)
  await start($)
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await plan($, PLAN)
  expect(asked).toHaveLength(0)
  await flow($, 'on')
  await theClock?.advance(1)
  await plannerIdle()
  expect(asked).toHaveLength(1)
})

test('with design off, an answer after work forks nothing and the look keeps its gap', { options: { design: false, language: 'ko' } }, async ($, on) => {
  engine(on)
  await start($)
  replies.push([PLAN])
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await theClock?.advance(1)
  await plannerIdle()
  await step($, '조사할게요')
  await plan($, { op: 'next' })
  expect(forked).toHaveLength(0)
})

test('/flow status tells whether plan-flow and the design are on and what the recent calls used', KO, async ($, on) => {
  engine(on)
  await start($)
  replies.push([PLAN])
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await theClock?.advance(1)
  await plannerIdle()
  forkUsage = { input_tokens: 1_500, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 240_000 }
  forkReplies.push([{ op: 'update', goal: '아이디로 로그인할 수 있다' }])
  await step($, '')
  await plan($)
  const status = await flow($, 'status')
  expect(status).toContain('이 세션에서 켜져 있어요')
  expect(status).toContain('Claude 설계: 켜짐')
  expect(status).toContain('Haiku 2번')
  expect(status).toContain('Claude 설계 1번')
  expect(status).toContain('캐시 읽기 240,000')
  await flow($, 'off')
  expect(await flow($, 'status')).toContain('이 세션에서 꺼져 있어요')
})

test('on the desktop app the drawer draws each stage as a rounded card joined by lines, and presses still fold, pick and switch to the list', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, PLAN)
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
  // The list keeps the tree's guides at each row's start, monospaced, under the app-type head, and the switch back.
  expect(await cards()).toHaveLength(0)
  const guides = (await pane.findAll({ type: 'Client' })).map(c => (c.props.props as { guide: string | null }).guide)
  expect(guides).toHaveLength(3)
  expect(guides.some(g => g !== null && /[├└]─ $/.test(g))).toBe(true)
  // The picked step's buttons keep the guides beside them, so the tree's lines do not break there.
  await pane.pointer({ type: 'up', x: 30, y: 0, button: 'left', in: 'step-1' })
  await pane.redraw()
  expect(JSON.stringify((await pane.findAll({ type: 'Box' })).find(b => b.key === 'pact-1'))).toContain('"mono":true')
  expect(JSON.stringify(await pane.drawn({ in: 'step-2' }))).toContain('"mono":true')
  expect((await pane.find({ type: 'Text', text: /^로그인 기능 추가$/ }))?.props.size).toBe('heading')
  expect(await pane.find({ type: 'Button', key: 'view' })).toBeDefined()
  await pane.unmount()
})

test('in the editor the drawer head is set in the app type: a heading title, a progress bar picture and counts that hold their width', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, PLAN)
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
  await plan($, { op: 'set', title: '갈래', nodes: [{ title: '묶음', children: [{ title: '먼저' }, { title: '혼자' }, { title: '같이', parallel: true, children: [{ title: '하나', links: ['https://github.com/o/r/pull/7'] }, { title: '둘' }] }] }] })
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
  await plan($, { op: 'set', title: '갈래', nodes: [{ title: '묶음', children: [{ title: '먼저' }, { title: '같이', parallel: true, children: [{ title: '하나' }, { title: '둘' }] }] }, { title: '끝', children: [{ title: '마무리' }] }] })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // No Button for a row: every row is a Client named after its step.
  expect((await pane.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['expand-all', 'collapse-all', 'refresh', 'view'])
  const clients = await pane.findAll({ type: 'Client' })
  expect(clients.map(c => c.key)).toEqual(['step-1', 'step-1.1', 'step-1.2.1', 'step-1.2.2', 'step-2'])
  const props = (key: string) => clients.find(c => c.key === key)?.props.props as { strong: boolean; pill: string | null; right: { text: string } | null }
  expect(props('step-1')).toMatchObject({ strong: true, right: { text: '0/3 ▾' } })
  expect(props('step-2')).toMatchObject({ strong: false, right: { text: '0/1 ▸' } })
  expect([props('step-1.2.1')?.pill, props('step-1.2.2')?.pill, props('step-1.1')?.pill]).toEqual(['동시에', '동시에', null])
  // The pill is a tint, not a bordered box: the app pads a bordered box itself, which made it taller than the row.
  const pillRow = JSON.stringify(await pane.drawn({ in: 'step-1.2.1' }))
  expect(pillRow).toContain('동시에')
  expect(pillRow).not.toContain('borderStyle')
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
  await plan($, { op: 'set', title: '동시에', nodes: [{ title: '갈래', parallel: true, children: [{ title: '왼쪽' }, { title: '오른쪽' }] }, { title: '마무리' }] })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const lines = await pane.findAll({ type: 'Svg' })
  expect(lines.length).toBeGreaterThanOrEqual(2)
  // An Svg with no alt is dropped by the app.
  expect(lines.every(l => typeof l.props.alt === 'string' && l.props.alt !== '')).toBe(true)
  const halves = (await pane.findAll({ type: 'Box' })).filter(b => b.props.width === '50%')
  expect(halves).toHaveLength(2)
  // A column, so the card inside stretches across its half.
  expect(halves.every(b => b.props.flexDirection === 'column')).toBe(true)
  // Each half keeps its own height: a card opened beside a short one leaves no empty box next to it.
  const rows = (await pane.findAll({ type: 'Box' })).filter(b => b.props.flexDirection === 'row' && (b.children ?? []).some(c => typeof c === 'object' && c !== null && (c as { props?: { width?: unknown } }).props?.width === '50%'))
  expect(rows).toHaveLength(1)
  expect(rows[0]?.props.alignItems).toBe('flex-start')
  await pane.unmount()
})

test('on the desktop app no line hangs off the flowchart: no split above a first group, no join under a last one', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, { op: 'set', title: '동시에', nodes: [{ title: '갈래', parallel: true, children: [{ title: '왼쪽' }, { title: '오른쪽' }] }, { title: '가운데' }, { title: '끝', parallel: true, children: [{ title: 'ㄱ' }, { title: 'ㄴ' }] }] })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The lines between cards, top to bottom: the join under the first group, then the split above the last.
  const lines = (await pane.findAll({ type: 'Svg' })).filter(l => l.props.alt === '단계 사이 연결선').map(l => l.props.source)
  expect(lines).toEqual([joinSvg(2), splitSvg(2)])
  await pane.unmount()
})

test('the terminal drawer keeps the character flowchart', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, PLAN)
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

test('a finished plan stays above the prompt folded to its title and progress, and a press opens it', KO, async ($, on) => {
  const clock = engine(on)
  await start($)
  await plan($, { op: 'set', title: '짧은 일', nodes: [{ title: '하나' }, { title: '둘' }] })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // While it runs the band is open.
  expect(await band.find({ type: 'Text', text: /하나/ })).toBeDefined()
  await plan($, { op: 'next' })
  await plan($, { op: 'next' })
  await clock.advance(60_000)
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /짧은 일/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /100%/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /하나/ })).toBeUndefined()
  await band.press({ key: 'fold-band' })
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /하나/ })).toBeDefined()
  // The next plan starts open again.
  await plan($, { op: 'set', title: '다음 일', nodes: [{ title: '셋' }] })
  await band.redraw()
  expect(await band.find({ type: 'Text', text: /셋/ })).toBeDefined()
  await band.unmount()
})

test('in the drawer, Enter on a folded box unfolds it and the focus is kept', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, PLAN)
  await plan($, { op: 'next' })
  // The surfaces whose rows are Buttons; the desktop app's rows are Clients, tested on their own.
  for (const surface of ['terminal', 'vscode'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    // The buttons that fold every box, then the rows in the order they are drawn; the running stage holds the ring.
    expect((await pane.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['expand-all', 'collapse-all', 'refresh', 'view', '1', '2', '2.1', '2.2', '3'])
    // The drawer's own buttons are drawn as buttons, with no hotkey; the boxes stay plain rows.
    const expand = (await pane.find({ type: 'Button', key: 'expand-all' }))?.props
    expect(expand?.label).toBe('모두 펼치기')
    expect(expand?.plain).toBeUndefined()
    expect(expand?.hotkey).toBeUndefined()
    expect((await pane.find({ type: 'Button', key: '2' }))?.props.plain).toBe(true)
    // The list button swaps the flowchart for the tree and back.
    await pane.press({ key: 'view' })
    // The terminal's list presses steps; the editor's draws every row as a Button.
    expect((await pane.findAll({ type: 'Button' })).map(b => b.key)).toEqual(surface === 'terminal' ? ['refresh', 'view', '1', '2.1', '2.2'] : ['refresh', 'view', '1', '2', '2.1', '2.2', '3'])
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
  await plan($, PLAN)
  await start($)
  expect(await shown($)).toContain('Plan: 로그인 기능 추가')
})

test('in the drawer, 확인 완료 under a step waiting for a check finishes it on the board; 논의 starts a draft', KO, async ($, on) => {
  engine(on)
  let draft = ''
  on('prompt.fill', (_, e) => ((draft = e.text), { isFilled: true }))
  await start($)
  await plan($, PLAN)
  await plan($, { op: 'update', updates: [{ id: '1', status: 'needs_check', note: '화면 보기' }] })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: '1' })
  await pane.press({ key: 'ask' })
  expect(draft).toBe('[조사] ')
  await pane.press({ key: 'confirm' })
  const board = await shown($)
  expect(board).toContain('1 조사 - completed')
  // What to look at goes with the check.
  expect(board).not.toContain('화면 보기')
  expect(await pane.find({ type: 'Button', key: 'confirm' })).toBeUndefined()
})

test("the drawer's ↻ has the planner look again at once over what happened lately, though nothing is new, and a toast says what changed", KO, async ($, on) => {
  engine(on)
  await start($)
  await $.prompt.submit({ text: '로그인 만들어줘', wait: false, origin: { kind: 'composer' } })
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: '테스트 돌리기' })
  await plan($, PLAN)
  const looks = asked.length
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Button', key: 'refresh' })).toBeDefined()
    await pane.unmount()
  }
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  replies.push([{ op: 'next' }])
  toasts.length = 0
  await pane.press({ key: 'refresh' })
  await theClock?.advance(1)
  await plannerIdle()
  expect(asked).toHaveLength(looks + 1)
  const again = asked[asked.length - 1] ?? ''
  expect(again).toContain('given again')
  expect(again).toContain('The person asked: 로그인 만들어줘')
  expect(again).toContain('Claude ran: 테스트 돌리기')
  expect(again).toContain('Claude answered: 했어요')
  expect(toasts).toEqual(['다시 확인해서 1곳을 고쳤어요'])
  // Nothing to change: said so.
  replies.push([])
  await pane.press({ key: 'refresh' })
  await theClock?.advance(1)
  await plannerIdle()
  expect(toasts[toasts.length - 1]).toBe('다시 확인했어요. 고칠 곳이 없어요')
  // A look again that fails says so, and the retry looks again too.
  await pane.press({ key: 'refresh' })
  await theClock?.advance(1)
  await plannerIdle()
  expect(toasts[toasts.length - 1]).toBe('다시 확인하지 못했어요. 잠시 뒤 한 번 더 해 볼게요')
  const before = asked.length
  replies.push([])
  await theClock?.advance(15_000)
  await plannerIdle()
  expect(asked).toHaveLength(before + 1)
  expect(asked[asked.length - 1]).toContain('given again')
  expect(toasts[toasts.length - 1]).toBe('다시 확인했어요. 고칠 곳이 없어요')
})

test('a detour the planner parks shows a toast, and a reload finds the shelf again', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, PLAN)
  // An op the board refuses is left out; the board is unchanged.
  await plan($, { op: 'set', title: '버그', nodes: [{ title: '재현' }] })
  expect(await shown($)).toContain('Plan: 로그인 기능 추가')
  await plan($, { op: 'set', title: '버그', nodes: [{ title: '재현' }], previous: 'park' })
  expect(toasts).toContain('"로그인 기능 추가" 보관 · "버그" 시작')
  await start($)
  expect(await shown($)).toContain('Parked: "로그인 기능 추가" (0/5 done)')
})

test('a session keeps its board through a reload while thirty other sessions saved theirs after it; call logs stay with the most recent twenty', KO, async ($, on) => {
  engine(on)
  await start($)
  const later = Number.MAX_SAFE_INTEGER
  const others = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`other-${i}`, { plan: { title: '', nodes: [], lastChild: {}, startedAt: 0 }, shelf: [], savedAt: later - i }]))
  stored.set('plans', others)
  stored.set('calls', Object.fromEntries(Object.keys(others).map((sid, i) => [sid, { calls: [], savedAt: later - i }])))
  await plan($, PLAN)
  expect(Object.keys(stored.get('plans') as object)).toHaveLength(31)
  await start($)
  expect(await shown($)).toContain('Plan: 로그인 기능 추가')
  expect(Object.keys(stored.get('calls') as object).length).toBeLessThanOrEqual(20)
})

test('/flow demo shows canned boards above the prompt and leaves the real plan alone', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, { op: 'set', title: '진짜 계획', nodes: [{ title: '첫 단계' }] })
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
  expect(await shown($)).toContain('Plan: 진짜 계획')
  await band.unmount()
})

test('the band keeps what another plugin draws above the prompt, under the tree', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, PLAN)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /로그인 기능 추가/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await band.unmount()
})

test('on the desktop app expected work follows the last card on a dotted line, faint and tagged, and the band lists it dim', KO, async ($, on) => {
  engine(on)
  await start($)
  await plan($, { ...PLAN, expected: ['리뷰 반영'] })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('리뷰 반영')
  expect(drawn).toContain('예상')
  expect((await pane.findAll({ type: 'Svg' })).some(s => String(s.props.source).includes('stroke-dasharray'))).toBe(true)
  // Not a step: no row to press.
  expect((await pane.findAll({ type: 'Client' })).map(c => c.key)).not.toContain('step-리뷰 반영')
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /◌ 리뷰 반영/ })).toBeDefined()
  await band.unmount()
})
