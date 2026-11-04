import { expect, test } from 'claude-code/testing'
import { idleActivity } from './activity'
import type { Plan, PlanResult } from './plan'
import { emptyPlan, nextStep, setPlan } from './plan'
import { drawTree, lineText } from './tree'

const ok = (r: PlanResult): Plan => {
  if ('error' in r) throw new Error(r.error)

  return r.plan
}

// Six stages of four checkpoints; the first two finished, the third running.
const big = (): Plan => {
  const stages = Array.from({ length: 6 }, (_, s) => ({ title: `단계 ${s + 1}`, children: Array.from({ length: 4 }, (_, c) => ({ title: `확인 ${s + 1}-${c + 1}` })) }))
  let p = ok(setPlan(emptyPlan(), '큰 계획', stages, 0))
  for (let t = 1; t <= 11; t++) p = ok(nextStep(p, undefined, t))
  return p
}
const rows = (p: Plan, maxRows: number, width = 60): string[] => drawTree(p, idleActivity(), { maxRows, width, accent: 'claude', now: 0 }).map(lineText)

test('the view never takes more rows than it is given', () => {
  for (let maxRows = 0; maxRows <= 40; maxRows++) expect(rows(big(), maxRows).length).toBeLessThanOrEqual(maxRows)
})

test('everything shows when it fits', () => {
  // 3 head lines (title, progress, blank) + 30 nodes.
  expect(rows(big(), 33)).toHaveLength(33)
})

test('finished subtrees fold first, the running stage keeps its checkpoints', () => {
  const lines = rows(big(), 26)
  expect(lines.some(l => l.includes('1 단계 1'))).toBe(true)
  expect(lines.some(l => l.includes('1.1 확인 1-1'))).toBe(false)
  expect(lines.some(l => l.includes('3.3 확인 3-3'))).toBe(true)
  expect(lines.some(l => l.includes('6.4 확인 6-4'))).toBe(true)
})

test('then waiting subtrees fold, and the current step stays in view', () => {
  const lines = rows(big(), 14)
  expect(lines.some(l => l.includes('6 단계 6'))).toBe(true)
  expect(lines.some(l => l.includes('6.1 확인 6-1'))).toBe(false)
  expect(lines.find(l => l.includes('3.3 확인 3-3'))?.endsWith('◂')).toBe(true)
})

test('past that, rows give way to a count of what is hidden', () => {
  const lines = rows(big(), 7)
  expect(lines.some(l => l.includes('3.3 확인 3-3'))).toBe(true)
  expect(lines[lines.length - 1]).toMatch(/^\+\d+개 더/)
})
