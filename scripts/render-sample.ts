// Prints the drawer and the tree above the prompt for a sample plan, as plain text.
// Run: bun scripts/render-sample.ts
// The mod's type-check has no Node or DOM types; this script only needs console.log.
declare const console: { log: (text: string) => void }
import { drawFlow } from '../hooks/drawer'
import type { Plan, PlanInput, PlanResult } from '../hooks/plan'
import { emptyPlan, nextStep, setPlan } from '../hooks/plan'
import { drawTree, lineText } from '../hooks/tree'

const ok = (r: PlanResult): Plan => {
  if ('error' in r) throw new Error(r.error)

  return r.plan
}

const steps: PlanInput[] = [
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
  {
    title: '검증',
    parallel: true,
    children: [
      { title: '테스트', children: [{ title: '단위 테스트' }, { title: '통합 테스트' }, { title: '화면 테스트' }] },
      { title: '문서', children: [{ title: 'README 고치기' }] },
    ],
  },
  { title: '배포', children: [{ title: '스테이징' }, { title: '운영' }] },
]

let plan = ok(setPlan(emptyPlan(), '로그인 기능 추가', steps, 0))
plan = ok(nextStep(plan, undefined, 1_000))
plan = ok(nextStep(plan, undefined, 124_000))
plan = ok(nextStep(plan, undefined, 172_000))
plan = ok(nextStep(plan, '2.2.1.1', 203_000))
const now = 252_000

console.log('--- drawer (53 columns) ---')
for (const line of drawFlow(plan, { open: {}, focus: null }, { width: 53, now }).lines) console.log(lineText(line))
console.log('--- above the prompt (60 columns, 24 rows) ---')
for (const line of drawTree(plan, { phase: 'tool', tool: 'Edit', running: [] }, { maxRows: 24, width: 60, now })) console.log(lineText(line))
