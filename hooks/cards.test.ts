import { expect, test } from 'claude-code/testing'
import type { DrawerState } from '../types'
import type { CardItem, CardStep } from './cards'
import { cardsOf } from './cards'
import { ASK, CONFIRM } from './drawer'
import type { Plan, PlanInput, PlanResult } from './plan'
import { emptyPlan, nextStep, setPlan, updateNodes } from './plan'
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
    detail: '아이디와 비밀번호로 로그인되게 하는 단계',
    children: [
      { title: '로그인 화면' },
      {
        title: 'API와 디자인',
        parallel: true,
        children: [
          { title: 'API', children: [{ title: '주소 만들기' }, { title: '비밀번호 확인' }] },
          { title: '디자인 다듬기', children: [{ title: '색 맞추기' }] },
        ],
      },
    ],
  },
  { title: '검증', parallel: true, children: [{ title: '테스트' }, { title: '문서' }] },
  { title: '배포' },
]

// 조사 done; 로그인 화면 done; 주소 만들기 running.
const sample = (): Plan => {
  let p = ok(setPlan(emptyPlan(), '로그인 기능 추가', STEPS, 0))
  p = ok(nextStep(p, undefined, 1))
  p = ok(nextStep(p, undefined, 2))
  return ok(nextStep(p, undefined, 3))
}
const closed: DrawerState = { open: {}, focus: null }
const steps = (items: readonly CardItem[]): CardStep[] => items.flatMap(i => (i.kind === 'step' ? [i.step, ...steps(i.step.children)] : steps(i.items)))

test('the stages stand on one axis, a parallel stage splits into cards side by side, and the plan ends where its last stage does', () => {
  const axis = cardsOf(sample(), closed)
  expect(axis.map(a => (a.kind === 'stage' ? a.stage.title : a.kind === 'split' ? a.stages.map(s => s.title).join('|') : a.kind))).toEqual(['조사', '구현', '테스트|문서', '배포'])
})

test('the stage Claude is in opens with its tasks, tasks that run together are grouped, and finished stages stay folded', () => {
  const [first, second] = cardsOf(sample(), closed)
  if (first?.kind !== 'stage' || second?.kind !== 'stage') throw new Error('stages expected')
  expect(first.stage).toMatchObject({ title: '조사', status: 'completed', open: false, children: [] })
  expect(second.stage).toMatchObject({ title: '구현', open: true, running: true, detail: '아이디와 비밀번호로 로그인되게 하는 단계' })
  expect(second.stage.right?.text).toBe('1/3 ▾')
  const together = second.stage.children[1]
  expect(together?.kind).toBe('together')
  expect(steps(second.stage.children).map(s => s.title)).toEqual(['로그인 화면', 'API', '주소 만들기', '비밀번호 확인', '디자인 다듬기'])
  const run = steps(second.stage.children).find(s => s.title === '주소 만들기')
  expect(run).toMatchObject({ running: true, parent: false })
  expect(run?.right?.text).toBe('진행 중')
})

test('folding and unfolding a stage follows the drawer state the person set', () => {
  const axis = cardsOf(sample(), { open: { '1': true, '2': false }, focus: null })
  expect(axis[0]?.kind === 'stage' && axis[0].stage.open).toBe(false)
  expect(axis[1]?.kind === 'stage' && axis[1].stage.children).toEqual([])
  expect(axis[1]?.kind === 'stage' && axis[1].stage.right?.text).toBe('1/3 ▸')
})

test('a picked step carries its whole detail, its note and its buttons; 확인 완료 only while it waits for a check', () => {
  let p = sample()
  p = ok(updateNodes(p, [{ id: '2.1', status: 'needs_check', note: '폰에서 눌러 보기', detail: '로그인 화면이 폰에서도 보이는지' }], 4))
  const picked = steps((cardsOf(p, { ...closed, pick: '2.1' })[1] as { stage: CardStep }).stage.children).find(s => s.id === '2.1')
  expect(picked).toMatchObject({ detail: '로그인 화면이 폰에서도 보이는지', note: '폰에서 눌러 보기', actions: [[CONFIRM, '확인 완료'], [ASK, '논의']] })
  const other = steps((cardsOf(p, { ...closed, pick: '2.2.1.1' })[1] as { stage: CardStep }).stage.children).find(s => s.id === '2.2.1.1')
  expect(other?.actions).toEqual([[ASK, '논의']])
  const unpicked = steps((cardsOf(p, closed)[1] as { stage: CardStep }).stage.children).find(s => s.id === '2.1')
  expect(unpicked?.actions).toEqual([])
  expect(unpicked?.detail).toBeUndefined()
})

test('a finished plan with a summary ends in the closing note', () => {
  let p = sample()
  for (let i = 0; i < 12; i++) {
    const r = nextStep(p, undefined, 10 + i)
    if ('error' in r) break
    p = r.plan
  }
  p = { ...p, summary: { goal: '로그인되게 한다', result: '화면과 API를 만들고 확인했다' } }
  const last = cardsOf(p, closed).at(-1)
  expect(last).toMatchObject({ kind: 'summary', goal: '로그인되게 한다', result: '화면과 API를 만들고 확인했다' })
})
