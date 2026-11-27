import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Plan, PlanNode, PlanStatus } from '../shared/types'
import { type ViewAxis, type ViewItem, type ViewStep, axisOf, headOf, nowOf, summaryOf } from '../shared/view'

const node = (id: string, title: string, status: PlanStatus, more: Partial<PlanNode> = {}): PlanNode => ({
  id,
  parentId: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null,
  title,
  status,
  ...more,
})

// The plan the picked design draws: a stage done, one running with tasks that run together,
// two stages side by side, and a last stage.
const login = (over: Partial<Plan> = {}): Plan => ({
  title: 'Login',
  goal: 'Sign in and keep the session',
  lastChild: {},
  startedAt: 0,
  nodes: [
    node('1', 'Research', 'completed', { detail: 'What exists', links: ['https://example.com/notes'] }),
    node('1.1', 'Read the old flow', 'completed'),
    node('2', 'Build', 'in_progress', { detail: 'Make sign-in work' }),
    node('2.1', 'Screen', 'completed', { links: ['https://example.com/pr/42'] }),
    node('2.2', 'Together', 'in_progress', { parallel: true }),
    node('2.2.1', 'API', 'in_progress'),
    node('2.2.2', 'Polish', 'pending'),
    node('2.3', 'Save the session', 'pending'),
    node('3', 'Check', 'pending', { parallel: true }),
    node('3.1', 'Tests', 'pending'),
    node('3.2', 'Docs', 'pending'),
    node('4', 'Ship', 'pending'),
  ],
  ...over,
})

const steps = (items: readonly ViewItem[]): ViewStep[] => items.flatMap(i => (i.kind === 'step' ? [i.step] : steps(i.items)))
const stage = (axis: readonly ViewAxis[], id: string): ViewStep => {
  for (const a of axis) {
    if (a.kind === 'stage' && a.stage.id === id) return a.stage
    if (a.kind === 'split') for (const s of a.stages) if (s.id === id) return s
  }
  throw new Error(`no stage ${id}`)
}

test('stages sit on one axis and a parallel stage splits into stages side by side', () => {
  const axis = axisOf(login(), {})

  assert.deepEqual(axis.map(a => (a.kind === 'split' ? `split:${a.stages.map(s => s.id).join(',')}` : a.kind === 'stage' ? a.stage.id : a.kind)), ['1', '2', 'split:3.1,3.2', '4'])
})

test("the stage with Claude's step is open and a finished stage stays folded, until the person folds or opens one", () => {
  const plan = login()
  const shown = axisOf(plan, {})
  assert.equal(stage(shown, '2').open, true)
  assert.equal(stage(shown, '1').open, false)
  assert.deepEqual(stage(shown, '1').children, [])

  const flipped = axisOf(plan, { '1': true, '2': false })
  assert.equal(stage(flipped, '1').open, true)
  assert.equal(stage(flipped, '2').open, false)
  assert.deepEqual(stage(flipped, '2').children, [])
})

test('an open stage lists its tasks, with tasks that run together in one group', () => {
  const build = stage(axisOf(login(), {}), '2')

  assert.deepEqual(build.children.map(i => (i.kind === 'together' ? i.items.map(x => (x.kind === 'step' ? x.step.id : '?')) : i.step.id)), ['2.1', ['2.2.1', '2.2.2'], '2.3'])
})

test("a box counts its units, a group of tasks that run together counting as its tasks", () => {
  const axis = axisOf(login(), {})

  assert.equal(stage(axis, '2').count, '1/4')
  assert.equal(stage(axis, '1').count, '1/1')
  assert.equal(stage(axis, '4').count, null)
})

test('a step says what it does while it runs or is open, and a folded box keeps its links to itself', () => {
  const axis = axisOf(login(), {})
  assert.equal(stage(axis, '2').detail, 'Make sign-in work')
  assert.equal(stage(axis, '1').detail, undefined)
  assert.deepEqual(stage(axis, '1').links, [])
  assert.deepEqual(stage(axisOf(login(), { '1': true }), '1').links, ['https://example.com/notes'])
  assert.deepEqual(steps(stage(axis, '2').children).find(s => s.id === '2.1')?.links, ['https://example.com/pr/42'])
})

test("the plan's closing note follows the last stage only once nothing is open, and expected work comes after it", () => {
  const done = login({
    nodes: login().nodes.map(n => ({ ...n, status: 'completed' as const })),
    summary: { goal: 'Sign in', result: 'Signed in with a session' },
    expected: ['Rate limits'],
  })
  const tail = axisOf(done, {}).slice(-2)
  assert.deepEqual(tail.map(a => a.kind), ['summary', 'expected'])

  const open = axisOf(login({ summary: { goal: 'Sign in', result: 'stale' } }), {})
  assert.equal(open.some(a => a.kind === 'summary'), false)
})

test("the head counts finished steps over all steps and names Claude's step and the steps to check", () => {
  const plan = login()
  plan.nodes = plan.nodes.map(n => (n.id === '2.3' ? { ...n, status: 'needs_check' as const } : n))

  assert.deepEqual(headOf(plan), { title: 'Login', goal: 'Sign in and keep the session', done: 3, total: 8, pct: 38, current: 'API', checks: 1 })
})

test("what is happening now comes from the agent: at work, waiting on the person, asking for a permission, failed, or done", () => {
  const plan = login()

  assert.deepEqual(nowOf(plan, { status: 'running', attentionReason: null }), { kind: 'running', step: 'API' })
  assert.deepEqual(nowOf(plan, { status: 'idle', attentionReason: 'finished' }), { kind: 'turn', step: 'API' })
  assert.deepEqual(nowOf(plan, { status: 'running', attentionReason: 'permission' }), { kind: 'permission', step: 'API' })
  assert.deepEqual(nowOf(plan, { status: 'error', attentionReason: 'error' }), { kind: 'error', step: 'API' })

  const done = login({ nodes: login().nodes.map(n => ({ ...n, status: 'completed' as const })) })
  assert.deepEqual(nowOf(done, { status: 'idle', attentionReason: null }), { kind: 'done' })
})

test("a board's summary for the pill and the workspace badge: progress, Claude's step, and whether work is open", () => {
  assert.deepEqual(summaryOf(login()), { title: 'Login', done: 2, total: 8, current: 'API', open: true })
  assert.equal(summaryOf(login({ nodes: [] })), null)
})
