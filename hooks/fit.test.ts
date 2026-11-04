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
const rows = (p: Plan, maxRows: number, width = 60): string[] => drawTree(p, idleActivity(), { maxRows, width, now: 0 }).map(lineText)

test('the view never takes more rows than it is given', () => {
  for (let maxRows = 0; maxRows <= 40; maxRows++) expect(rows(big(), maxRows).length).toBeLessThanOrEqual(maxRows)
})

test('only the running stage keeps its checkpoints', () => {
  // 3 head lines (title, progress, blank) + 6 stages + 4 checkpoints of the running one.
  const lines = rows(big(), 33)
  expect(lines).toHaveLength(13)
  expect(lines.find(l => l.includes('단계 1'))?.endsWith('4/4 ▸')).toBe(true)
  expect(lines.some(l => l.includes('확인 1-1'))).toBe(false)
  expect(lines.find(l => l.includes('확인 3-3'))?.endsWith('◂')).toBe(true)
  expect(lines.some(l => l.includes('확인 6-4'))).toBe(false)
})

test('with too few rows to scroll in, rows give way to a count of what is hidden', () => {
  const lines = rows(big(), 3)
  expect(lines).toHaveLength(3)
  expect(lines.some(l => l.includes('단계 3'))).toBe(true)
  expect(lines[lines.length - 1]).toMatch(/^\+\d+개 더/)
})
