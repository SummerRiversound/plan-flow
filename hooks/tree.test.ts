import { expect, test } from 'claude-code/testing'
import type { Activity } from '../types'
import { idleActivity } from './activity'
import type { Plan, PlanInput, PlanResult } from './plan'
import { emptyPlan, nextStep, setPlan, updateNodes } from './plan'
import { drawTree, duration, layoutTree, lineText, statusLine } from './tree'
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

test('rows carry glyph and title without ids, a parallel tag, counts on parents and a mark on the current leaf', () => {
  const lines = texts(sample(), idleActivity(), 40, 60)
  expect(lines).toContain('├─ ✓ 조사                                                1초')
  expect(lines.some(l => /\d+(\.\d+)* /.test(l.replace(/^[│├└─ ]+[✓●○■–] /, '')) && /─ [✓●○] \d/.test(l))).toBe(false)
  expect(lines.find(l => l.startsWith('├─ ● 구현'))?.endsWith('1/5')).toBe(true)
  expect(lines.find(l => l.includes('API와 디자인'))).toContain('∥ 동시에')
  expect(lines.find(l => l.includes('주소 만들기'))?.endsWith('◂')).toBe(true)
  expect(lines.find(l => l.includes('배포'))?.startsWith('└─ ○')).toBe(true)
  // Counts sit flush right.
  for (const l of lines.filter(l => /\d+\/\d+( ▸)?$/.test(l) && l.includes('─ '))) expect(cells(l)).toBe(60)
})

test('only the current path is unfolded; a folded parent says so', () => {
  const p = ok(setPlan(emptyPlan(), '계획', [{ title: '첫째', children: [{ title: '가' }] }, { title: '둘째', children: [{ title: '나' }, { title: '다' }] }], 0))
  const lines = texts(ok(nextStep(p, undefined, 1)), idleActivity(), 40, 40)
  expect(lines.some(l => l.includes('가 ◂'))).toBe(true)
  expect(lines.some(l => l.includes('나'))).toBe(false)
  expect(lines.find(l => l.includes('둘째'))?.endsWith('0/2 ▸')).toBe(true)
})

test('blocked and skipped leaves show why', () => {
  const p = ok(updateNodes(sample(), [{ id: '3', status: 'skipped', note: '다음 주에' }], 9))
  expect(texts(p, idleActivity(), 40, 60).find(l => l.includes('배포'))).toContain('(skipped: 다음 주에)')
})

test('a tree taller than its rows shows a window around the current step, and scrolls', () => {
  const stages = Array.from({ length: 12 }, (_, s) => ({ title: `단계 ${s + 1}` }))
  let p = ok(setPlan(emptyPlan(), '긴 계획', stages, 0))
  for (let t = 1; t <= 7; t++) p = ok(nextStep(p, undefined, t))
  const opts = { maxRows: 9, width: 40, accent: 'claude', now: 0 }
  const follow = layoutTree(p, idleActivity(), opts)
  expect(follow.lines).toHaveLength(9)
  expect(follow.lines.map(lineText).some(l => l.includes('단계 7 ◂'))).toBe(true)
  expect(follow.maxOffset).toBe(12 - 5)
  expect(lineText(follow.lines[8] ?? [])).toMatch(/^↑ \d+줄 · ↓ \d+줄 · 스크롤로 더 보기$/)
  const top = layoutTree(p, idleActivity(), { ...opts, scroll: 0 })
  expect(lineText(top.lines[3] ?? [])).toContain('단계 1')
  expect(lineText(top.lines[8] ?? [])).toMatch(/^↓ 7줄/)
  expect(layoutTree(p, idleActivity(), { ...opts, scroll: 99 }).offset).toBe(7)
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
