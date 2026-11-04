import { expect, test } from 'claude-code/testing'
import type { Activity } from '../types'
import { idleActivity } from './activity'
import type { Plan, PlanInput, PlanResult } from './plan'
import { emptyPlan, nextStep, setPlan, updateNodes } from './plan'
import { drawTree, duration, lineText, statusLine } from './tree'
import { cells } from './width'

const ok = (r: PlanResult): Plan => {
  if ('error' in r) throw new Error(r.error)

  return r.plan
}

const STEPS: PlanInput[] = [
  { title: '조사' },
  {
    title: '구현',
    children: [
      { title: '로그인 화면' },
      { title: 'API와 디자인', parallel: true, children: [{ title: 'API', children: [{ title: '주소 만들기' }, { title: '비밀번호 확인' }] }, { title: '디자인 다듬기' }] },
      { title: '세션 저장' },
    ],
  },
  { title: '배포' },
]

// 조사 done, 로그인 화면 done, the group running.
const sample = (): Plan => {
  let p = ok(setPlan(emptyPlan(), '로그인 기능 추가', STEPS, 0))
  for (let t = 1; t <= 3; t++) p = ok(nextStep(p, undefined, t * 1000))
  return p
}
const working: Activity = { phase: 'working', running: [] }
const texts = (p: Plan, a: Activity, maxRows: number, width: number): string[] =>
  drawTree(p, a, { maxRows, width, accent: 'claude', now: 0 }).map(lineText)

test('the head is the title, then progress as done/total and percent', () => {
  const lines = texts(sample(), idleActivity(), 40, 60)
  expect(lines[0]).toBe('로그인 기능 추가')
  expect(lines[1]).toMatch(/^━+─+  2\/7 · 29%/)
})

test('rows carry glyph, id and title, a parallel tag, counts on parents and a mark on the current leaf', () => {
  const lines = texts(sample(), idleActivity(), 40, 60)
  expect(lines).toContain('├─ ✓ 1 조사')
  expect(lines.find(l => l.startsWith('├─ ● 2 구현'))?.endsWith('1/5')).toBe(true)
  expect(lines.find(l => l.includes('2.2 API와 디자인'))).toContain('∥ parallel')
  expect(lines.find(l => l.includes('2.2.1.1 주소 만들기'))?.endsWith('◂')).toBe(true)
  expect(lines.find(l => l.includes('3 배포'))?.startsWith('└─ ○')).toBe(true)
  // Counts sit flush right.
  for (const l of lines.filter(l => /\d+\/\d+$/.test(l) && l.includes('─ '))) expect(cells(l)).toBe(60)
})

test('blocked and skipped leaves show why', () => {
  const p = ok(updateNodes(sample(), [{ id: '3', status: 'skipped', note: '다음 주에' }], 9))
  expect(texts(p, idleActivity(), 40, 60).find(l => l.includes('3 배포'))).toContain('(skipped: 다음 주에)')
})

test('the activity line follows the progress line', () => {
  expect(texts(sample(), working, 40, 60)[2]).toBe('● 작업 중')
})

test('no row is wider than the band, Hangul counted as two cells', () => {
  const long = ok(setPlan(emptyPlan(), '아주 긴 한글 계획 제목이 여기에 있습니다', [{ title: '한글로 된 아주 긴 단계 이름입니다', children: [{ title: '체크포인트 이름도 꽤 깁니다' }] }], 0))
  const blocked = ok(updateNodes(long, [{ id: '1.1', status: 'blocked', note: '디자인 확정을 기다리는 중입니다' }], 1))
  for (const p of [sample(), blocked]) {
    for (let width = 12; width <= 80; width++) {
      for (const line of drawTree(p, working, { maxRows: 40, width, accent: 'claude', now: 0 })) {
        expect(cells(lineText(line))).toBeLessThanOrEqual(width)
      }
    }
  }
})

test('a short band gets a one-line head', () => {
  const lines = texts(sample(), working, 4, 60)
  expect(lines[0]).toMatch(/^로그인 기능 추가 +2\/7$/)
  expect(lines.length).toBeLessThanOrEqual(4)
})

test('durations read in Korean units', () => {
  expect(duration(48_000)).toBe('48초')
  expect(duration(123_000)).toBe('2분 03초')
  expect(duration(3_900_000)).toBe('1시간 05분')
  expect(duration(0)).toBe('0초')
})

test('the status line names progress and the step in hand', () => {
  expect(statusLine(emptyPlan(), idleActivity())).toBeUndefined()
  expect(statusLine(emptyPlan(), working)).toBe('작업 중')
  expect(statusLine(sample(), working)).toBe('계획 2/7 · 주소 만들기 외 1개 진행 중 · 작업 중')
})
