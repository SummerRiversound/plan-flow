import { expect, test } from 'claude-code/testing'
import type { DrawerState } from '../types'
import { drawFlow, isOpen, toggleFold } from './drawer'
import type { Plan, PlanInput, PlanResult } from './plan'
import { emptyPlan, nextStep, setPlan } from './plan'
import { lineText } from './tree'
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
      {
        title: 'API와 디자인',
        parallel: true,
        children: [
          { title: 'API', children: [{ title: '주소 만들기' }, { title: '비밀번호 확인' }, { title: '에러 처리' }] },
          { title: '디자인 다듬기', children: [{ title: '색 맞추기' }, { title: '간격 정리' }] },
        ],
      },
      { title: '세션 저장' },
    ],
  },
  { title: '검증', parallel: true, children: [{ title: '테스트', children: [{ title: '단위' }, { title: '통합' }, { title: '화면' }] }, { title: '문서', children: [{ title: 'README' }] }] },
  { title: '배포', children: [{ title: '스테이징' }, { title: '운영' }] },
]

// 조사 and 로그인 화면 done, 주소 만들기 done, 비밀번호 확인 and 색 맞추기 running.
const sample = (): Plan => {
  let p = ok(setPlan(emptyPlan(), '로그인 기능 추가', STEPS, 0))
  p = ok(nextStep(p, undefined, 1_000))
  p = ok(nextStep(p, undefined, 124_000))
  p = ok(nextStep(p, undefined, 172_000))
  return ok(nextStep(p, '2.2.1.1', 203_000))
}
const closed: DrawerState = { open: {}, focus: null }
const draw = (p: Plan, d: DrawerState = closed, width = 53) => drawFlow(p, d, { width, accent: 'claude', now: 252_000 })
const texts = (p: Plan, d: DrawerState = closed, width = 53): string[] => draw(p, d, width).lines.map(lineText)

test('the head names the plan, stages done and the time so far', () => {
  const head = texts(sample())[0] ?? ''
  expect(head.startsWith(' 로그인 기능 추가')).toBe(true)
  expect(head.endsWith('1/5 · 4분 12초')).toBe(true)
  expect(cells(head)).toBe(53)
})

test('the running stage is open with the running task, the rest is folded', () => {
  const lines = texts(sample())
  expect(lines.find(l => l.includes('● 구현'))).toMatch(/1\/4 ▾ │$/)
  expect(lines.some(l => l.includes('╭ 동시에'))).toBe(true)
  expect(lines.find(l => l.includes('● API'))).toContain('1/3 ▾')
  expect(lines.find(l => l.includes('✓ 주소 만들기'))).toContain('31초')
  expect(lines.find(l => l.includes('● 비밀번호 확인'))).toContain('진행 중')
  expect(lines.find(l => l.includes('디자인 다듬기'))).toContain('0/2 ▸')
  expect(lines.some(l => l.includes('색 맞추기'))).toBe(false)
  expect(lines.find(l => l.includes('✓ 조사'))).toContain('2분 03초')
  expect(lines.find(l => l.includes('○ 배포'))).toContain('0/2 ▸')
})

test('stages join with arrows, a parallel stage splits and joins', () => {
  const lines = texts(sample())
  expect(lines.filter(l => l.trim() === '▼').length).toBeGreaterThanOrEqual(2)
  expect(lines.some(l => /╭─+┴─+╮/.test(l))).toBe(true)
  expect(lines.some(l => /^ *▼ +▼ *$/.test(l))).toBe(true)
  expect(lines.some(l => /╰─+┬─+╯/.test(l))).toBe(true)
  // Side by side on one line.
  expect(lines.some(l => l.includes('테스트') && l.includes('문서'))).toBe(true)
})

test('a branch that does not fit beside the other goes to the next row', () => {
  const lines = texts(sample(), closed, 30)
  expect(lines.some(l => l.includes('테스트') && l.includes('문서'))).toBe(false)
  expect(lines.some(l => l.includes('테스트'))).toBe(true)
  expect(lines.some(l => l.includes('문서'))).toBe(true)
})

test('no line is wider than the drawer, Hangul counted as two cells', () => {
  const long = ok(setPlan(emptyPlan(), '아주 긴 한글 계획 제목이 여기에 있습니다', [{ title: '한글로 된 아주 긴 단계 이름입니다', children: [{ title: '체크포인트 이름도 꽤 깁니다' }] }], 0))
  const all: DrawerState = { open: { '2': true, '2.2.1': true, '2.2.2': true, '3.1': true, '3.2': true, '4': true, '1': true }, focus: null }
  for (const p of [sample(), ok(nextStep(long, undefined, 1))]) {
    for (const d of [closed, all]) {
      for (let width = 12; width <= 80; width++) {
        for (const line of draw(p, d, width).lines) expect(cells(lineText(line))).toBeLessThanOrEqual(width)
      }
    }
  }
})

test('every box that folds is a button, in the order the boxes are drawn', () => {
  expect(draw(sample()).buttons).toEqual(['2', '2.2.1', '2.2.2', '3.1', '3.2', '4'])
  const opened = toggleFold(sample(), closed, '2.2.2')
  expect(draw(sample(), opened).buttons).toEqual(['2', '2.2.1', '2.2.2', '3.1', '3.2', '4'])
})

test('pressing a folded box unfolds it, pressing again folds it', () => {
  const p = sample()
  expect(isOpen(p, closed, '4')).toBe(false)
  const opened = toggleFold(p, closed, '4')
  expect(isOpen(p, opened, '4')).toBe(true)
  expect(texts(p, opened).some(l => l.includes('○ 스테이징'))).toBe(true)
  expect(texts(p, opened).find(l => l.includes('○ 배포'))).toContain('0/2 ▾')
  // The running stage starts open; pressing it folds it.
  const folded = toggleFold(p, closed, '2')
  expect(isOpen(p, folded, '2')).toBe(false)
  expect(texts(p, folded).some(l => l.includes('로그인 화면'))).toBe(false)
})
