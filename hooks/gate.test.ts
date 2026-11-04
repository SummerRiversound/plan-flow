import { expect, test } from 'claude-code/testing'
import type { GateAsk } from './gate'
import { decide, denyReason, MAX_DENIES, onPlanWritten, onTurnStart } from './gate'
import { emptyPlan, setPlan } from './plan'

const ask: GateAsk = { tool: 'Edit', enforce: true, toolOffered: true, gate: { planned: false, denies: 0 } }

test('with enforcement off nothing is ever refused', () => {
  for (const tool of ['Edit', 'Write', 'Bash', 'Agent']) expect(decide({ ...ask, tool, enforce: false }).verdict).toBe('allow')
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
  expect(onTurnStart(emptyPlan())).toEqual({ planned: false, denies: 0 })
  const r = setPlan(emptyPlan(), 'T', [{ title: 'a' }], 0)
  if ('error' in r) throw new Error(r.error)
  expect(onTurnStart(r.plan)).toEqual({ planned: true, denies: 0 })
  expect(onPlanWritten({ planned: false, denies: 2 })).toEqual({ planned: true, denies: 2 })
})

test('the refusal tells the model how to make a plan', () => {
  const text = denyReason('mcp__plan-flow__plan')
  expect(text).toContain('mcp__plan-flow__plan')
  expect(text).toContain('"op":"set"')
})
