// Board states for trying the views by eye (`/flow demo`) and for snapshots. Each is
// built with the real operations, so a scenario cannot show a state the tool never makes.
import type { Activity } from '../types'
import type { Board, BoardResult } from './board'
import { emptyBoard, setBoard, settle } from './board'
import type { Plan, PlanInput, PlanResult } from './plan'
import { addNodes, nextStep, updateNodes } from './plan'
import type { Language } from './i18n'
import { language, t } from './i18n'
import { EN } from './scenarios.en'

// A demo's words in the session's language: Korean as written here, else from the English table.
const tr = (ko: string): string => (language() === 'ko' ? ko : (EN[ko] ?? ko))

// `folded` draws the band folded to its title and progress lines.
export type Frame = { label: string; board: Board; activity: Activity; now: number; folded?: boolean }
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

const LOGIN = (): PlanInput[] => [
  { title: tr('조사'), detail: tr('지금 회원 정보가 어디에 어떻게 저장되는지 읽어 보기'), links: ['https://claude.ai/code/artifact/5f0c1d2e-login-notes'] },
  {
    title: tr('구현'),
    detail: tr('아이디와 비밀번호로 실제 로그인이 되게 만드는 단계'),
    children: [
      { title: tr('로그인 화면'), detail: tr('아이디·비밀번호 입력칸과 로그인 버튼을 그리기'), links: ['https://github.com/acme/shop/pull/42', '/home/me/shop/src/LoginPage.tsx'] },
      {
        title: tr('API와 디자인'),
        parallel: true,
        children: [
          {
            title: 'API',
            detail: tr('화면이 보낸 아이디·비밀번호를 받아 로그인 여부를 돌려주는 서버 쪽'),
            children: [
              { title: tr('주소 만들기'), detail: tr('POST /login 주소를 열어 요청을 받기'), links: ['https://github.com/acme/shop/commit/3f9a2c1d8e'] },
              { title: tr('비밀번호 확인'), detail: tr('입력한 비밀번호를 저장된 해시와 비교해 맞으면 세션을 만들기') },
              { title: tr('에러 처리'), detail: tr('틀렸을 때 보여줄 문구와 5번 실패 시 잠금') },
            ],
          },
          {
            title: tr('디자인 다듬기'),
            detail: tr('로그인 화면을 앱의 다른 화면과 같은 모양으로 맞추기'),
            children: [{ title: tr('색 맞추기'), detail: tr('버튼과 입력칸 색을 디자인 토큰 값으로 바꾸기') }, { title: tr('간격 정리') }],
          },
        ],
      },
      { title: tr('세션 저장') },
    ],
  },
  { title: tr('검증'), parallel: true, children: [{ title: tr('테스트'), children: [{ title: tr('단위 테스트') }, { title: tr('화면 테스트') }] }, { title: tr('문서') }] },
  { title: tr('배포'), children: [{ title: tr('스테이징') }, { title: tr('운영'), detail: tr('운영 배포 버튼은 사용자가 직접 눌러요') }] },
]

// 조사 and 로그인 화면 done, the API and design branches running.
const login = (): Board => steps(ok(setBoard(emptyBoard(), tr('로그인 기능 추가'), LOGIN(), undefined, 0)), 4, 1_000)

const long = (): Board => {
  const ko = language() === 'ko'
  const many = Array.from({ length: 14 }, (_, i) => ({
    title: ko ? `${i + 1}단계 작업` : `Step ${i + 1}`,
    detail: ko ? `${i + 1}번째 파일을 새 형식으로 옮기고 테스트를 돌리기` : `Move file ${i + 1} to the new format and run the tests`,
  }))

  return steps(ok(setBoard(emptyBoard(), tr('긴 계획'), many, undefined, 0)), 8, 1_000)
}

const detour = (): Frame[] => {
  const a = login()
  const b = ok(setBoard(a, tr('버그 수정'), [{ title: tr('재현') }, { title: tr('고치기') }], 'park', 300_000))
  const c = steps(b, 1, 310_000)
  const d = steps(c, 2, 400_000)

  return [
    { label: tr('로그인 기능을 하던 중'), board: a, activity: working, now: 250_000 },
    { label: tr('버그 수정으로 보관: 입력창 위에 "보관 1", 서랍 아래에 보관한 계획'), board: c, activity: working, now: 330_000 },
    { label: tr('버그 수정이 끝나 로그인 기능으로 돌아옴'), board: d, activity: working, now: 500_000 },
  ]
}

const restart = (): Frame[] => {
  const a = login()
  const b = steps(ok(setBoard(a, tr('로그인 다시 설계'), [{ title: tr('요구사항 정리') }, { title: tr('화면 흐름') }, { title: tr('구현') }], 'cancel', 300_000)), 1, 301_000)

  return [
    { label: tr('로그인 기능을 하던 중'), board: a, activity: working, now: 250_000 },
    { label: tr('취소하고 처음부터: 새 계획만 보이고 취소된 계획은 보관 목록에 없음'), board: b, activity: working, now: 330_000 },
  ]
}

const build = (): Scenario[] => [
  { id: 'basic', title: tr('기본 진행'), frames: [{ label: tr('동시에 진행되는 두 갈래'), board: login(), activity: working, now: 250_000 }] },
  { id: 'long', title: tr('긴 계획'), frames: [{ label: tr('입력창 위는 10줄까지, 나머지는 흐름도에서'), board: long(), activity: working, now: 400_000 }] },
  {
    id: 'added',
    title: tr('추가 작업'),
    frames: [(() => {
      const b = login()
      return { label: tr('"소셜 로그인"이 새로 붙음'), board: { ...b, plan: plan(addNodes(b.plan, '2', [{ title: tr('소셜 로그인') }], 260_000)) }, activity: working, now: 260_000 }
    })()],
  },
  {
    id: 'split',
    title: tr('단계 쪼개기'),
    frames: [(() => {
      const b = steps(ok(setBoard(emptyBoard(), tr('문서 정리'), [{ title: tr('목차') }, { title: tr('본문 쓰기') }, { title: tr('검토') }], undefined, 0)), 2, 1_000)
      return { label: tr('진행 중이던 "본문 쓰기"가 세부 단계로 늘어나고 첫 단계부터 이어서 진행'), board: { ...b, plan: plan(addNodes(b.plan, '2', [{ title: tr('설치') }, { title: tr('사용법') }, { title: tr('문제 해결') }], 90_000)) }, activity: working, now: 90_000 }
    })()],
  },
  {
    id: 'redo',
    title: tr('되돌리기'),
    frames: [(() => {
      const b = login()
      return { label: tr('끝난 "로그인 화면"을 다시 열고 ↺ 표시'), board: { ...b, plan: plan(updateNodes(b.plan, [{ id: '2.1', status: 'pending', note: tr('응답 형식 변경') }], 260_000)) }, activity: working, now: 260_000 }
    })()],
  },
  { id: 'detour', title: tr('보관 후 복귀'), frames: detour() },
  { id: 'restart', title: tr('취소 후 다시'), frames: restart() },
  {
    id: 'blocked',
    title: tr('막힘·건너뜀·확인 대기'),
    frames: [(() => {
      const b = login()
      const p = plan(updateNodes(b.plan, [{ id: '4.2', status: 'skipped', note: tr('이번엔 안 함') }, { id: '2.3', status: 'blocked', note: tr('로그인 필요') }, { id: '2.1', status: 'needs_check', note: tr('폰에서 눌러 보기') }], 260_000))
      return { label: tr('사용자 차례인 단계, 건너뛴 단계, 확인 기다리는 단계'), board: { ...b, plan: p }, activity: { phase: 'permission', running: [] }, now: 260_000 }
    })()],
  },
  {
    id: 'done',
    title: tr('모두 완료'),
    frames: [(() => {
      const b = steps(ok(setBoard(emptyBoard(), tr('작은 수정'), [{ title: tr('고치기') }, { title: tr('확인') }], undefined, 0)), 3, 1_000)
      const summary = { goal: tr('로그인 버튼이 눌리지 않던 문제 고치기'), result: tr('버튼을 덮던 투명한 층을 걷어 내고, 폰에서 눌러 다음 화면으로 넘어가는 것까지 확인했어요') }
      return { label: tr('다 끝난 계획(입력창 위에서는 5초 뒤 사라짐)'), board: { ...b, plan: { ...b.plan, summary } }, activity: idle, now: 100_000 }
    })()],
  },
  { id: 'folded', title: tr('접은 모습'), frames: [{ label: tr('입력창 위를 제목과 진행 막대만 남기고 접음'), board: login(), activity: working, now: 250_000, folded: true }] },
]

// Built once per language, in the language the session speaks.
const built: Partial<Record<Language, Scenario[]>> = {}
export const scenarios = (): Scenario[] => (built[language()] ??= build())

// Where `/flow demo` stands: a scenario and one of its frames.
export type DemoAt = { scenario: number; frame: number }

export const DEMO_NEXT = 'demo-next'
export const DEMO_PREV = 'demo-prev'
export const DEMO_STOP = 'demo-stop'

export const demoFrame = (at: DemoAt): Frame | undefined => scenarios()[at.scenario]?.frames[at.frame]

// The next or previous frame, running on into the next scenario and round from the end.
export const demoStep = (at: DemoAt, dir: 1 | -1): DemoAt => {
  const flat = scenarios().flatMap((s, scenario) => s.frames.map((_, frame) => ({ scenario, frame })))
  const i = flat.findIndex(f => f.scenario === at.scenario && f.frame === at.frame)

  return flat[(i + dir + flat.length) % flat.length] ?? { scenario: 0, frame: 0 }
}

// A scenario by its id or its number from 1.
export const demoFind = (arg: string): number | undefined => {
  const all = scenarios()
  const n = Number(arg)
  const i = Number.isInteger(n) && n >= 1 && n <= all.length ? n - 1 : all.findIndex(s => s.id === arg)

  return i < 0 ? undefined : i
}

export const demoList = (): string =>
  scenarios()
    .map((s, i) => `${i + 1}. ${s.id} — ${s.title}${s.frames.length > 1 ? t().demo.scenes(s.frames.length) : ''}`)
    .join('\n')
