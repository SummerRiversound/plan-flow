import assert from 'node:assert/strict'
import { test } from 'node:test'
import { asksDesign, isSamePlan, leftOff, planKey, startsNext } from '../shared/schedule'
import type { Plan, PlanNode, PlanStatus } from '../shared/types'

const node = (id: string, title: string, status: PlanStatus): PlanNode => ({ id, parentId: id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null, title, status })
const plan = (nodes: PlanNode[], over: Partial<Plan> = {}): Plan => ({ title: 'Login', nodes, lastChild: {}, startedAt: 10, ...over })

test('open work with no step running starts the next one; a running step or finished work does not', () => {
  assert.equal(startsNext(plan([node('1', 'Read', 'completed'), node('2', 'Build', 'pending')])), true)
  assert.equal(startsNext(plan([node('1', 'Read', 'in_progress'), node('2', 'Build', 'pending')])), false)
  assert.equal(startsNext(plan([node('1', 'Read', 'completed')])), false)
})

test('Claude is asked to design when the planner starts a plan or rewrites its goal, not for step updates', () => {
  assert.equal(asksDesign([{ op: 'set', title: 'Login', nodes: [] }]), true)
  assert.equal(asksDesign([{ op: 'update', updates: [], goal: 'Sign in' }]), true)
  assert.equal(asksDesign([{ op: 'update', updates: [{ id: '1', status: 'completed' }] }, { op: 'next' }]), false)
})

test('a design lands only on the plan it was asked about: same title and start, every step it saw still under its id', () => {
  const asked = plan([node('1', 'Read', 'completed'), node('2', 'Build', 'pending')])

  assert.equal(isSamePlan(asked, plan([...asked.nodes, node('3', 'Ship', 'pending')])), true)
  assert.equal(isSamePlan(asked, plan(asked.nodes, { title: 'Logout' })), false)
  assert.equal(isSamePlan(asked, plan(asked.nodes, { startedAt: 11 })), false)
  assert.equal(isSamePlan(asked, plan([node('1', 'Read', 'completed'), node('2', 'Test', 'pending')])), false)
})

test('an answer leaves the board off when an older plan came back from the shelf, the look changed nothing, or a design is owed', () => {
  const now = plan([node('1', 'Read', 'pending')])
  const hand = { key: planKey(now), startedAt: now.startedAt }

  assert.equal(leftOff(now, hand, false, false), false)
  assert.equal(leftOff(now, hand, true, false), true)
  assert.equal(leftOff(now, hand, false, true), true)
  assert.equal(leftOff(plan(now.nodes, { title: 'Older', startedAt: 5 }), hand, false, false), true)
  // A newer plan than the one in hand was just started, not brought back.
  assert.equal(leftOff(plan(now.nodes, { title: 'Newer', startedAt: 20 }), hand, false, false), false)
})
