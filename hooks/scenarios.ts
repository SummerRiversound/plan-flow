// Board states for trying the views by eye (`/flow demo`) and for snapshots. Each is
// built with the real operations, so a scenario cannot show a state the tool never makes.
import type { Activity } from '../types'
import type { Board, BoardResult } from './board'
import { emptyBoard, setBoard, settle } from './board'
import type { Plan, PlanInput, PlanResult } from './plan'
import { addNodes, nextStep, updateNodes } from './plan'

export type Frame = { label: string; board: Board; activity: Activity; now: number }
export type Scenario = { id: string; title: string; frames: Frame[] }

const ok = (r: BoardResult): Board => {
  if ('error' in r) throw new Error(r.error)

  return r.board
}
const plan = (r: PlanResult): Plan => {
  if ('error' in r) throw new Error(r.error)

  return r.plan
}
const on = (b: Board, r: PlanResult, now: number): Board => ok(settle(b, r, now))
const steps = (b: Board, n: number, from: number): Board => {
  let out = b
  for (let i = 0; i < n; i++) out = on(out, nextStep(out.plan, undefined, from + i * 40_000), from + i * 40_000)

  return out
}

const working: Activity = { phase: 'tool', tool: 'Edit', running: [] }
const idle: Activity = { phase: 'idle', running: [] }

const LOGIN: PlanInput[] = [
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
  { title: '검증', parallel: true, children: [{ title: '테스트', children: [{ title: '단위 테스트' }, { title: '화면 테스트' }] }, { title: '문서' }] },
  { title: '배포', children: [{ title: '스테이징' }, { title: '운영' }] },
]

// 조사 and 로그인 화면 done, the API and design branches running.
const login = (): Board => steps(ok(setBoard(emptyBoard(), '로그인 기능 추가', LOGIN, undefined, 0)), 4, 1_000)

const long = (): Board => {
  const many = Array.from({ length: 14 }, (_, i) => ({ title: `${i + 1}단계 작업` }))

  return steps(ok(setBoard(emptyBoard(), '긴 계획', many, undefined, 0)), 8, 1_000)
}

const detour = (): Frame[] => {
  const a = login()
  const b = ok(setBoard(a, '버그 수정', [{ title: '재현' }, { title: '고치기' }], 'park', 300_000))
  const c = steps(b, 1, 310_000)
  const d = steps(c, 2, 400_000)

  return [
    { label: '로그인 기능을 하던 중', board: a, activity: working, now: 250_000 },
    { label: '버그 수정으로 보관: 입력창 위에 "보관 1", 서랍 아래에 보관한 계획', board: c, activity: working, now: 330_000 },
    { label: '버그 수정이 끝나 로그인 기능으로 돌아옴', board: d, activity: working, now: 500_000 },
  ]
}

const restart = (): Frame[] => {
  const a = login()
  const b = steps(ok(setBoard(a, '로그인 다시 설계', [{ title: '요구사항 정리' }, { title: '화면 흐름' }, { title: '구현' }], 'cancel', 300_000)), 1, 301_000)

  return [
    { label: '로그인 기능을 하던 중', board: a, activity: working, now: 250_000 },
    { label: '취소하고 처음부터: 새 계획만 보이고 취소된 계획은 보관 목록에 없음', board: b, activity: working, now: 330_000 },
  ]
}

export const SCENARIOS: Scenario[] = [
  { id: 'basic', title: '기본 진행', frames: [{ label: '동시에 진행되는 두 갈래', board: login(), activity: working, now: 250_000 }] },
  { id: 'long', title: '긴 계획', frames: [{ label: '입력창 위는 12줄까지, 나머지는 스크롤', board: long(), activity: working, now: 400_000 }] },
  {
    id: 'added',
    title: '추가 작업',
    frames: [(() => {
      const b = login()
      return { label: '"소셜 로그인"이 새로 붙음', board: { ...b, plan: plan(addNodes(b.plan, '2', [{ title: '소셜 로그인' }], 260_000)) }, activity: working, now: 260_000 }
    })()],
  },
  {
    id: 'split',
    title: '단계 쪼개기',
    frames: [(() => {
      const b = steps(ok(setBoard(emptyBoard(), '문서 정리', [{ title: '목차' }, { title: '본문 쓰기' }, { title: '검토' }], undefined, 0)), 2, 1_000)
      return { label: '진행 중이던 "본문 쓰기"가 세부 단계로 늘어나고 첫 단계부터 이어서 진행', board: { ...b, plan: plan(addNodes(b.plan, '2', [{ title: '설치' }, { title: '사용법' }, { title: '문제 해결' }], 90_000)) }, activity: working, now: 90_000 }
    })()],
  },
  {
    id: 'redo',
    title: '되돌리기',
    frames: [(() => {
      const b = login()
      return { label: '끝난 "로그인 화면"을 다시 열고 ↺ 표시', board: { ...b, plan: plan(updateNodes(b.plan, [{ id: '2.1', status: 'pending', note: '응답 형식 변경' }], 260_000)) }, activity: working, now: 260_000 }
    })()],
  },
  { id: 'detour', title: '보관 후 복귀', frames: detour() },
  { id: 'restart', title: '취소 후 다시', frames: restart() },
  {
    id: 'blocked',
    title: '막힘과 건너뜀',
    frames: [(() => {
      const b = login()
      const p = plan(updateNodes(b.plan, [{ id: '4.2', status: 'skipped', note: '이번엔 안 함' }, { id: '2.3', status: 'blocked', note: '로그인 필요' }], 260_000))
      return { label: '하은 님 차례인 단계와 건너뛴 단계', board: { ...b, plan: p }, activity: { phase: 'permission', running: [] }, now: 260_000 }
    })()],
  },
  {
    id: 'done',
    title: '모두 완료',
    frames: [(() => {
      const b = steps(ok(setBoard(emptyBoard(), '작은 수정', [{ title: '고치기' }, { title: '확인' }], undefined, 0)), 3, 1_000)
      return { label: '다 끝난 계획(입력창 위에서는 5초 뒤 사라짐)', board: b, activity: idle, now: 100_000 }
    })()],
  },
]

// Where `/flow demo` stands: a scenario and one of its frames.
export type DemoAt = { scenario: number; frame: number }

export const DEMO_NEXT = 'demo-next'
export const DEMO_PREV = 'demo-prev'
export const DEMO_STOP = 'demo-stop'

export const demoFrame = (at: DemoAt): Frame | undefined => SCENARIOS[at.scenario]?.frames[at.frame]

// The next or previous frame, running on into the next scenario and round from the end.
export const demoStep = (at: DemoAt, dir: 1 | -1): DemoAt => {
  const flat = SCENARIOS.flatMap((s, scenario) => s.frames.map((_, frame) => ({ scenario, frame })))
  const i = flat.findIndex(f => f.scenario === at.scenario && f.frame === at.frame)

  return flat[(i + dir + flat.length) % flat.length] ?? { scenario: 0, frame: 0 }
}

// A scenario by its id or its number from 1.
export const demoFind = (arg: string): number | undefined => {
  const n = Number(arg)
  const i = Number.isInteger(n) && n >= 1 && n <= SCENARIOS.length ? n - 1 : SCENARIOS.findIndex(s => s.id === arg)

  return i < 0 ? undefined : i
}

export const demoList = (): string =>
  SCENARIOS.map((s, i) => `${i + 1}. ${s.id} — ${s.title}${s.frames.length > 1 ? ` (${s.frames.length}장면)` : ''}`).join('\n')
