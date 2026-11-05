import { expect, test } from 'claude-code/testing'
import type { GateAsk } from './gate'
import { decide, denyReason, MAX_DENIES, onPlanWritten, onTurnStart, REMINDER } from './gate'
import { emptyPlan, setPlan } from './plan'
import { LONG_STEP, idleWatch, longStepNote, onStepPlanWritten, watchStep } from './gate'

const ask: GateAsk = { tool: 'Edit', enforce: true, toolOffered: true, gate: { planned: false, denies: 0 } }

test('with enforcement off nothing is ever refused', () => {
  for (const tool of ['Edit', 'Write', 'Bash', 'Agent']) expect(decide({ ...ask, tool, enforce: false }).verdict).not.toBe('deny')
})

test('with enforcement off, the first state-changing tool in a turn with no plan carries one reminder, and nothing else does', () => {
  const off = { ...ask, enforce: false }
  const first = decide(off)
  expect(first.verdict).toBe('remind')
  expect(decide({ ...off, gate: first.gate }).verdict).toBe('allow')
  expect(decide({ ...off, tool: 'Read' }).verdict).toBe('allow')
  expect(decide({ ...off, gate: { planned: true, denies: 0 } }).verdict).toBe('allow')
  expect(decide({ ...off, agentId: 'sub-1' }).verdict).toBe('allow')
  expect(decide({ ...off, toolOffered: false }).verdict).toBe('allow')
  expect(REMINDER).toContain('op "set"')
  // A finished plan is not running either, so the reminder must not claim the board is empty.
  expect(REMINDER).not.toMatch(/has no plan/)
  expect(REMINDER).toContain("is finished")
})

test('with enforcement on, a state-changing tool waits for a plan', () => {
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Bash', 'Agent']) expect(decide({ ...ask, tool }).verdict).toBe('deny')
  expect(decide({ ...ask, gate: { planned: true, denies: 0 } }).verdict).toBe('allow')
})

test('reading tools, subagents and a tool the model was never offered are let through', () => {
  for (const tool of ['Read', 'Grep', 'Glob', 'WebFetch', 'mcp__other__thing']) expect(decide({ ...ask, tool }).verdict).toBe('allow')
  expect(decide({ ...ask, agentId: 'sub-1' }).verdict).toBe('allow')
  expect(decide({ ...ask, toolOffered: false }).verdict).toBe('allow')
})

test('after three refusals in a turn the gate steps aside once with a notice', () => {
  let gate = ask.gate
  const verdicts: string[] = []
  for (let i = 0; i < 5; i++) {
    const d = decide({ ...ask, gate })
    verdicts.push(d.verdict)
    gate = d.gate
  }
  expect(MAX_DENIES).toBe(3)
  expect(verdicts).toEqual(['deny', 'deny', 'deny', 'pause', 'allow'])
})

test('a new turn starts the count again and remembers an unfinished plan', () => {
  expect(onTurnStart(emptyPlan())).toEqual({ planned: false, denies: 0, reminded: false })
  const r = setPlan(emptyPlan(), 'T', [{ title: 'a' }], 0)
  if ('error' in r) throw new Error(r.error)
  expect(onTurnStart(r.plan)).toEqual({ planned: true, denies: 0, reminded: false })
  expect(onPlanWritten({ planned: false, denies: 2 })).toEqual({ planned: true, denies: 2 })
})

test('the refusal tells the model how to make a plan', () => {
  const text = denyReason('mcp__plan-flow__plan')
  expect(text).toContain('mcp__plan-flow__plan')
  expect(text).toContain('"op":"set"')
})

test('a step that runs through many changes with the plan unchanged gets one note to split it, and the next step counts afresh', () => {
  let w = idleWatch()
  const nudged: number[] = []
  for (let i = 1; i <= LONG_STEP * 2; i++) {
    const r = watchStep(w, '2.1')
    w = r.watch
    if (r.nudge) nudged.push(i)
  }
  expect(nudged).toEqual([LONG_STEP])
  expect(watchStep(w, '2.2').watch).toEqual({ id: '2.2', changes: 1, nudged: false })
  expect(watchStep(idleWatch(), null).nudge).toBe(false)
})

test('writing the plan starts the count again but never notes the same step twice', () => {
  let w = idleWatch()
  for (let i = 0; i < LONG_STEP - 1; i++) w = watchStep(w, '1').watch
  w = onStepPlanWritten(w)
  expect(watchStep(w, '1').nudge).toBe(false)
  for (let i = 0; i < LONG_STEP; i++) w = watchStep(w, '1').watch
  expect(w.nudged).toBe(true)
  w = onStepPlanWritten(w)
  let again = false
  for (let i = 0; i < LONG_STEP * 2; i++) {
    const r = watchStep(w, '1')
    w = r.watch
    again ||= r.nudge
  }
  expect(again).toBe(false)
  expect(longStepNote('1', '조사')).toContain('op "add" (parent "1")')
})
