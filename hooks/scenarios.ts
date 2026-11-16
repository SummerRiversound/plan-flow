// Boards for trying the views by eye (`/flow demo`) and for snapshots: a session at work with
// something waiting on the person, the same session after an answer and when the person comes
// back, a finished session, and one waiting on background work.
import type { Activity } from '../types'
import type { Chapter } from './chapters'
import type { Language } from './i18n'
import { language, t } from './i18n'
import { EN } from './scenarios.en'
import type { Shown } from './view'

// A demo's words in the session's language: Korean as written here, else from the English table.
const tr = (ko: string): string => (language() === 'ko' ? ko : (EN[ko] ?? ko))

// `folded` draws the band folded to its title; `away` adds the note for a person coming back.
export type Frame = { label: string; shown: Shown; activity: Activity; now: number; folded?: boolean; away?: boolean }
export type Scenario = { id: string; title: string; frames: Frame[] }

const working: Activity = { phase: 'tool', tool: 'Bash', running: [{ id: 't1', tool: 'Bash' }] }
const idle: Activity = { phase: 'idle', running: [] }

const PR = 'https://github.com/example/payments/pull/142'
const chapter = (c: Partial<Chapter> & { title: string }): Chapter => ({ links: [], done: true, receipts: [], ...c, title: tr(c.title), request: tr(c.request ?? ''), result: tr(c.result ?? ''), left: (c.left ?? []).map(l => ({ ...l, text: tr(l.text) })) })

const webhook = (latest: Partial<Chapter>, asked: readonly string[] = []): Shown => ({
  board: {
    title: tr('결제 웹훅 재시도 정리'),
    goal: tr('결제 실패 알림이 고객에게 한 번만 가게'),
    chapters: [
      chapter({ request: '결제 실패 알림이 두 번씩 간대', title: '중복 알림 원인 찾기', result: '재시도가 두 번 등록되고 있었음' }),
      chapter({ request: '큐를 바꿔서 고쳐줘', title: '재시도 큐 교체', result: '큐를 바꾸고 테스트 48개 통과', links: [PR, 'https://github.com/example/payments/issues/139'], receipts: [{ what: 'opened', ref: 'PR #142', url: PR }] }),
      chapter({ request: '리뷰 코멘트 반영해줘', title: '리뷰 코멘트 반영', done: false, ...latest }),
    ],
  },
  asked: asked.map(tr),
  running: 0,
})

const build = (): Scenario[] => [
  {
    id: 'session',
    title: tr('일하는 세션'),
    frames: [
      { label: tr('Claude가 일하는 중: 지금 장이 돌고, 하는 일이 한 줄로'), shown: webhook({}), activity: working, now: 40_000 },
      {
        label: tr('답이 끝남: 결과와 남은 일, 열린 질문은 내 차례로'),
        shown: webhook(
          {
            result: '코멘트 3개 반영, CI 통과',
            left: [
              { text: '스테이징에서 결제 한 건 확인', kind: 'mine' },
              { text: '확인되면 머지', kind: 'claude' },
              { text: '리뷰어의 재검토', kind: 'others' },
            ],
          },
          ['재시도 횟수를 3번으로 둘까요, 5번으로 둘까요?'],
        ),
        activity: idle,
        now: 90_000,
      },
      {
        label: tr('자리를 비웠다 돌아옴: 판 위에 그동안의 알림'),
        shown: webhook({ result: '코멘트 3개 반영, CI 통과', done: true, left: [{ text: '스테이징에서 결제 한 건 확인', kind: 'mine' }] }),
        activity: idle,
        now: 400_000,
        away: true,
      },
      { label: tr('입력창 위를 제목과 목표만 남기고 접음'), shown: webhook({}), activity: working, now: 40_000, folded: true },
    ],
  },
  {
    id: 'finished',
    title: tr('끝난 세션'),
    frames: [
      {
        label: tr('모든 장이 끝남: 머지와 릴리스, 선택 사항과 확인하지 못한 것'),
        shown: {
          board: {
            title: tr('로그인 버튼 고치기'),
            goal: tr('로그인 버튼이 다시 눌리게'),
            chapters: [
              chapter({ request: '로그인 버튼이 안 눌려', title: '버튼을 덮던 층 걷기', result: '투명한 층을 걷어 내고 폰에서 눌리는 것까지 확인', receipts: [{ what: 'opened', ref: 'PR #57', url: 'https://github.com/example/app/pull/57' }] }),
              chapter({
                request: '머지하고 배포까지 해줘',
                title: '머지와 배포',
                result: 'PR을 머지하고 1.4.2로 배포',
                links: ['https://github.com/example/app/pull/57'],
                receipts: [
                  { what: 'merged', ref: 'PR #57', url: 'https://github.com/example/app/pull/57' },
                  { what: 'release', ref: 'v1.4.2' },
                ],
                left: [
                  { text: '같은 층이 다른 화면에도 있는지 살펴보기', kind: 'optional' },
                  { text: '안드로이드 태블릿에서는 눌러 보지 못함', kind: 'unverified' },
                ],
              }),
            ],
          },
          asked: [],
          running: 0,
        },
        activity: idle,
        now: 100_000,
      },
    ],
  },
  {
    id: 'background',
    title: tr('백그라운드 작업'),
    frames: [
      {
        label: tr('턴은 끝났고 백그라운드 작업을 기다리는 중'),
        shown: {
          board: {
            title: tr('검색 인덱스 이전'),
            goal: tr('새 검색 서버로 옮겨도 결과가 그대로 나오게'),
            chapters: [chapter({ request: '인덱스 새 서버로 옮겨줘', title: '데이터 옮기기', result: '옮기는 작업 두 개를 띄움', done: false, left: [{ text: '옮긴 뒤 검색 결과 비교', kind: 'claude' }] })],
          },
          asked: [],
          running: 2,
        },
        activity: idle,
        now: 60_000,
      },
    ],
  },
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
