import { expect, test } from 'claude-code/testing'
import type { Activity } from '../types'
import { idleActivity } from './activity'
import type { Plan, PlanInput, PlanResult } from './plan'
import { addNodes, emptyPlan, nextStep, setPlan, updateNodes } from './plan'
import { FOLD_BUTTON, FRAME_MS, drawTree, lineText, statusLine } from './tree'
import { cells } from './width'
import { setLanguage } from './i18n'

// The expectations below are written in Korean.
setLanguage('ko')

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
const texts = (p: Plan, a: Activity, maxRows: number, width: number, folded?: boolean): string[] =>
  drawTree(p, a, { maxRows, width, now: 0, folded }).map(lineText)

test('the head is the title, then progress as done/total and percent', () => {
  const lines = texts(sample(), idleActivity(), 40, 60)
  expect(lines[0]).toBe('로그인 기능 추가')
  expect(lines[1]).toMatch(/^━+╸?━+  2\/7 · 29%/)
})

test('rows carry glyph and title without ids, a parallel tag, counts on parents, and no arrow on a running leaf', () => {
  const lines = texts(sample(), idleActivity(), 40, 60)
  // A finished step shows no time it took.
  expect(lines).toContain('├─ ✓ 조사')
  expect(lines.some(l => /\d+(\.\d+)* /.test(l.replace(/^[│├└─ ]+[✓●○■–] /, '')) && /─ [✓●○] \d/.test(l))).toBe(false)
  expect(lines.find(l => l.startsWith('├─ ● 구현'))?.endsWith('1/5')).toBe(true)
  expect(lines.find(l => l.includes('API와 디자인'))).toContain('∥ 동시에')
  expect(lines.find(l => l.includes('주소 만들기'))?.endsWith('● 주소 만들기')).toBe(true)
  expect(lines.find(l => l.includes('배포'))?.startsWith('└─ ○')).toBe(true)
  // Counts sit flush right.
  for (const l of lines.filter(l => /\d+\/\d+( ▸)?$/.test(l) && l.includes('─ '))) expect(cells(l)).toBe(60)
})

test('only the current path is unfolded; a folded parent says so', () => {
  const p = ok(setPlan(emptyPlan(), '계획', [{ title: '첫째', children: [{ title: '가' }] }, { title: '둘째', children: [{ title: '나' }, { title: '다' }] }], 0))
  const lines = texts(ok(nextStep(p, undefined, 1)), idleActivity(), 40, 40)
  expect(lines.some(l => l.endsWith('● 가'))).toBe(true)
  expect(lines.some(l => l.includes('나'))).toBe(false)
  expect(lines.find(l => l.includes('둘째'))?.endsWith('0/2 ▸')).toBe(true)
})

test('blocked and skipped leaves show why', () => {
  const p = ok(updateNodes(sample(), [{ id: '3', status: 'skipped', note: '다음 주에' }], 9))
  expect(texts(p, idleActivity(), 40, 60).find(l => l.includes('배포'))).toContain('(skipped: 다음 주에)')
})

test('a tree taller than its rows shows a window around the current step', () => {
  const stages = Array.from({ length: 12 }, (_, s) => ({ title: `단계 ${s + 1}` }))
  let p = ok(setPlan(emptyPlan(), '긴 계획', stages, 0))
  for (let t = 1; t <= 7; t++) p = ok(nextStep(p, undefined, t))
  const lines = drawTree(p, idleActivity(), { maxRows: 9, width: 40, now: 0 }).map(lineText)
  expect(lines).toHaveLength(9)
  expect(lines.some(l => l.endsWith('● 단계 7'))).toBe(true)
  expect(lines.some(l => l.includes('흐름도에서') || /\d+줄/.test(l))).toBe(false)
})

test('the activity line follows the progress line', () => {
  expect(texts(sample(), working, 40, 60)[2]).toBe('● 작업 중')
})

test('no row is wider than the band, Hangul counted as two cells', () => {
  const long = ok(setPlan(emptyPlan(), '아주 긴 한글 계획 제목이 여기에 있습니다', [{ title: '한글로 된 아주 긴 단계 이름입니다', children: [{ title: '체크포인트 이름도 꽤 깁니다' }] }], 0))
  const blocked = ok(updateNodes(long, [{ id: '1.1', status: 'blocked', note: '디자인 확정을 기다리는 중입니다' }], 1))
  for (const p of [sample(), blocked]) {
    for (let width = 12; width <= 80; width++) {
      for (const line of drawTree(p, working, { maxRows: 40, width, now: 0 })) {
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

test('the status line names progress and the step in hand', () => {
  expect(statusLine(emptyPlan(), idleActivity())).toBeUndefined()
  expect(statusLine(emptyPlan(), working)).toBe('작업 중')
  expect(statusLine(sample(), working)).toBe('계획 2/7 · 주소 만들기 외 1개 진행 중 · 작업 중')
})

test('a step the latest request reopened carries a mark, one it added does not, and the head counts parked plans', () => {
  let p = ok(addNodes(sample(), null, [{ title: '문서' }], 9))
  p = ok(updateNodes(p, [{ id: '1', status: 'pending', note: '다시 조사' }], 10))
  const lines = drawTree(p, idleActivity(), { maxRows: 40, width: 60, now: 0, parked: 2 }).map(lineText)
  // A step just added reads as a plain step, with no badge after its title.
  expect(lines.find(l => l.includes('문서'))).not.toContain('new')
  expect(lines.find(l => l.includes('조사'))).toContain('조사 ↺')
  expect(lines[1]).toContain('· 보관 2')
})

test('the running step shows its detail under it, wrapped to two rows; other steps keep theirs hidden', () => {
  const withDetail: PlanInput[] = [
    { title: '조사', detail: '이건 끝난 단계라 안 보여요' },
    { title: '구현', detail: '단계 묶음 설명도 안 보여요', children: [{ title: '로그인 화면', detail: '입력한 비밀번호를 저장된 해시와 비교해서 로그인을 통과시킬지 정하고 실패하면 횟수를 센다' }] },
  ]
  let p = ok(setPlan(emptyPlan(), 'T', withDetail, 0))
  p = ok(nextStep(ok(nextStep(p, undefined, 1)), undefined, 2))
  const lines = texts(p, idleActivity(), 20, 40)
  const at = lines.findIndex(l => l.includes('● 로그인 화면'))
  expect(lines[at + 1]).toMatch(/^ {8}입력한 비밀번호를/)
  expect(lines[at + 2]?.trim().length).toBeGreaterThan(0)
  expect(lines[at + 2]?.endsWith('…')).toBe(true)
  expect(lines.some(l => l.includes('끝난 단계'))).toBe(false)
  expect(lines.some(l => l.includes('묶음 설명'))).toBe(false)
  expect(lines.every(l => cells(l) <= 40)).toBe(true)
})

test('the band folds to its title and progress lines, and its button says which way it goes', () => {
  const open = texts(sample(), working, 12, 60, false)
  expect(open[0]).toMatch(/^로그인 기능 추가 +접기 ▴$/)
  const folded = drawTree(sample(), working, { maxRows: 12, width: 60, now: 0, folded: true })
  expect(folded.map(lineText)).toHaveLength(2)
  expect(lineText(folded[0] ?? [])).toMatch(/^로그인 기능 추가 +펼치기 ▾$/)
  expect(lineText(folded[1] ?? [])).toMatch(/\d+\/\d+ · \d+%/)
  expect(folded[0]?.find(s => s.text === '펼치기 ▾')?.button).toBe(FOLD_BUTTON)
})

test('steps waiting for the person to check are gathered on one line under the progress bar, and fold away with the band', () => {
  let p = ok(setPlan(emptyPlan(), '로그인', [{ title: '화면' }, { title: 'API' }, { title: '저장' }], 0))
  p = ok(updateNodes(p, [{ id: '1', status: 'needs_check', note: '폰에서 눌러 보기' }, { id: '2', status: 'needs_check' }], 1))
  const lines = drawTree(p, idleActivity(), { maxRows: 10, width: 60, now: 2 }).map(lineText)
  expect(lines[2]).toBe('◐ 확인할 것 2: 화면 (폰에서 눌러 보기) · API')
  expect(lines.some(l => l.includes('◐ 화면'))).toBe(true)
  expect(drawTree(p, idleActivity(), { maxRows: 10, width: 60, now: 2, folded: true }).map(lineText).some(l => l.includes('확인할 것'))).toBe(false)
})

test('while Claude works the running step turns and a bright band sweeps its title; between turns it stands still', () => {
  const row = (a: Activity, now: number) => drawTree(sample(), a, { maxRows: 40, width: 60, now }).find(l => lineText(l).includes('주소 만들기')) ?? []
  const lit = (now: number) => row(working, now).filter(s => s.live === 'title' && s.color === 'text').map(s => s.text).join('')
  expect(lineText(row(working, 0))).not.toBe(lineText(row(working, FRAME_MS)))
  expect(lineText(row(working, 0)).endsWith(' 주소 만들기')).toBe(true)
  expect(lineText(row(working, 0))).not.toContain('●')
  expect(lit(0)).not.toBe(lit(FRAME_MS * 3))
  expect(lineText(row(idleActivity(), 0)).endsWith('● 주소 만들기')).toBe(true)
  expect(lineText(row({ phase: 'permission', tool: 'Bash', running: [] }, 0)).endsWith('● 주소 만들기')).toBe(true)
})

test('the progress bar is one heavy line to half a cell, done in green over a dim track', () => {
  let p = ok(setPlan(emptyPlan(), '계획', Array.from({ length: 7 }, (_, i) => ({ title: `단계 ${i + 1}` })), 0))
  p = ok(nextStep(ok(nextStep(p, undefined, 1)), undefined, 2))
  const bar = (drawTree(p, idleActivity(), { maxRows: 10, width: 60, now: 3 })[1] ?? []).filter(s => /^[━╸╺]+$/.test(s.text))
  expect(lineText(bar)).toBe(`━━━╸${'━'.repeat(20)}`)
  expect(bar.slice(0, 2)).toEqual([{ text: '━━━', color: 'success' }, { text: '╸', color: 'success' }])
  expect(bar[2]).toMatchObject({ color: 'inactive', dim: true })
})
