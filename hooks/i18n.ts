// What the mod says on screen, in English and Korean. English is the schema: the Korean
// table must hold the same keys, which the type checks. The language is set once per
// session (`setLanguage`); drawing reads it through `t()`.

import type { Newer } from './version'

export const LANGUAGES = ['en', 'ko'] as const
export type Language = (typeof LANGUAGES)[number]

// The tokens a kind of model call used, summed.
type Usage = { count: number; input: number; cacheRead: number; output: number }
const n = (x: number): string => x.toLocaleString('en-US')

const en = {
  parallel: 'parallel',
  waiting: 'Your turn',
  expected: 'expected',
  line: 'Line between steps',
  divider: 'Divider',
  progress: (done: number, total: number) => `Progress: ${done} of ${total} steps done`,
  checks: (n: number) => `◐ To check ${n}: `,
  parked: (n: number) => ` · parked ${n}`,
  more: (n: number, done: number, waiting: number) => `+${n} more · ${done} done · ${waiting} waiting`,
  activity: {
    working: 'Working',
    tool: (tool: string) => `Running ${tool}`,
    permission: (tool: string) => `Waiting for permission: ${tool}`,
    question: 'Waiting for your answer',
    background: (n: number) => `${n} background ${n === 1 ? 'task' : 'tasks'} running`,
    compacting: 'Compacting the conversation',
    interrupted: 'Interrupted',
    error: 'Error',
    errorWith: (detail: string) => `Error: ${detail}`,
  },
  pause: 'Blocked three times with no plan, so this turn goes on without one',
  board: {
    parked: 'parked',
    cancelled: 'cancelled',
    done: 'done',
    switched: (old: string, verb: string, title: string) => `"${old}" ${verb} · "${title}" started`,
    resumed: (title: string) => `"${title}" resumed`,
    cancelledOnly: (title: string) => `"${title}" cancelled`,
    back: (old: string, verb: string, title: string) => `"${old}" ${verb} · back to "${title}"`,
  },
  pane: 'Flowchart',
  command: 'Open or close the plan flowchart; on, off or status for this session',
  closed: 'Closed the flowchart',
  opened: 'Opened the flowchart',
  openedLater: 'Opened the flowchart; it shows once the window is wide enough',
  turnedOn: 'Turned plan-flow on in this session',
  turnedOff: 'Turned plan-flow off in this session: no board and no model calls until /flow on',
  isOff: 'plan-flow is off in this session; /flow on turns it on',
  status: (on: boolean, startOn: boolean, design: boolean, kept: number, look: Usage, fork: Usage) =>
    [
      `plan-flow is ${on ? 'on' : 'off'} in this session (new sessions start ${startOn ? 'on' : 'off'}) · Claude design: ${design ? 'on' : 'off'}`,
      `In the last ${kept} calls:`,
      `  Haiku ${look.count} ${look.count === 1 ? 'call' : 'calls'}: input ${n(look.input)} · cache read ${n(look.cacheRead)} · output ${n(look.output)} tokens`,
      `  Claude design ${fork.count} ${fork.count === 1 ? 'call' : 'calls'}: input ${n(fork.input)} · cache read ${n(fork.cacheRead)} · output ${n(fork.output)} tokens`,
    ].join('\n'),
  bandOpen: 'Flowchart ▸',
  newer: (n: Newer) => (n.kind === 'installed' ? `↑ ${n.version} installed · /reload-plugins` : `↑ ${n.version} is out · update in /plugin`),
  demo: {
    unknown: (list: string) => `No such demo. You can pick:\n${list}`,
    ended: 'Demo ended',
    at: (i: number, n: number, title: string, label: string, list: string) =>
      `Demo ${i}/${n}: ${title} — ${label}\n/flow demo next for the next one, /flow demo stop to end.\n${list}`,
    bar: (i: number, n: number, title: string) => `▶ Demo ${i}/${n} · ${title}  `,
    prev: '◂ Prev',
    next: 'Next ▸',
    stop: 'End ✕',
    scenes: (n: number) => ` (${n} scenes)`,
    untouched: 'This is a demo, so the board stays as it is',
  },
  filled: 'Put the step name in the prompt',
  notFilled: "Can't put it in the prompt right now",
  confirm: '[ Checked ]',
  discuss: '[ Discuss ]',
  running: 'running',
  link: {
    issue: (n: string) => `Issue #${n}`,
    commit: (sha: string) => `Commit ${sha}`,
    artifact: 'Artifact',
  },
  summary: { title: 'Wrap-up', goal: 'Goal', result: 'Result', links: 'Links' },
  shelf: ' Parked plans',
  finished: ' Finished in this session',
  finishedLine: 'Done before',
  empty: 'No plan yet. Send a request that takes several steps, and Claude draws its plan here.',
  narrow: ' Widen the window to see the flowchart',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  toList: 'List view',
  toFlow: 'Flowchart view',
  foot: {
    scroll: ' Scroll with the wheel',
    following: ' Following the running step · scroll to look around',
    stopped: ' Not following   ',
    follow: 'Back to current',
  },
}

export type Strings = typeof en

const ko: Strings = {
  parallel: '동시에',
  waiting: '답변 기다림',
  expected: '예상',
  line: '단계 사이 연결선',
  divider: '구분선',
  progress: (done, total) => `진행률: ${total}단계 중 ${done}단계 완료`,
  checks: n => `◐ 확인할 것 ${n}: `,
  parked: n => ` · 보관 ${n}`,
  more: (n, done, waiting) => `+${n}개 더 · 완료 ${done} · 대기 ${waiting}`,
  activity: {
    working: '작업 중',
    tool: tool => `${tool} 실행 중`,
    permission: tool => `권한 기다리는 중: ${tool}`,
    question: '답변 기다리는 중',
    background: n => `백그라운드 작업 ${n}개 진행 중`,
    compacting: '대화 압축 중',
    interrupted: '중단됨',
    error: '오류',
    errorWith: detail => `오류: ${detail}`,
  },
  pause: '세 번 막았지만 계획이 없어서, 이번 턴은 계획 없이 진행해요',
  board: {
    parked: '보관',
    cancelled: '취소',
    done: '완료',
    switched: (old, verb, title) => `"${old}" ${verb} · "${title}" 시작`,
    resumed: title => `"${title}" 다시 시작`,
    cancelledOnly: title => `"${title}" 취소`,
    back: (old, verb, title) => `"${old}" ${verb} · "${title}"(으)로 돌아왔어요`,
  },
  pane: '흐름도',
  command: '계획 흐름도를 열거나 닫아요. on, off, status로 이 세션의 plan-flow를 켜고 끄고 살펴봐요',
  closed: '흐름도를 닫았어요',
  opened: '흐름도를 열었어요',
  openedLater: '흐름도를 열었어요. 화면이 넓어지면 보여요',
  turnedOn: '이 세션에서 plan-flow를 켰어요',
  turnedOff: '이 세션에서 plan-flow를 껐어요. /flow on 전까지 계획판도 모델 호출도 없어요',
  isOff: '이 세션에서는 plan-flow가 꺼져 있어요. /flow on으로 켤 수 있어요',
  status: (on, startOn, design, kept, look, fork) =>
    [
      `plan-flow가 이 세션에서 ${on ? '켜져' : '꺼져'} 있어요 (새 세션은 ${startOn ? '켜진' : '꺼진'} 채로 시작) · Claude 설계: ${design ? '켜짐' : '꺼짐'}`,
      `최근 호출 ${kept}번 안에서:`,
      `  Haiku ${look.count}번: 입력 ${n(look.input)} · 캐시 읽기 ${n(look.cacheRead)} · 출력 ${n(look.output)} 토큰`,
      `  Claude 설계 ${fork.count}번: 입력 ${n(fork.input)} · 캐시 읽기 ${n(fork.cacheRead)} · 출력 ${n(fork.output)} 토큰`,
    ].join('\n'),
  bandOpen: '흐름도 보기 ▸',
  newer: n => (n.kind === 'installed' ? `↑ ${n.version} 설치됨 · /reload-plugins` : `↑ ${n.version} 나옴 · /plugin에서 업데이트`),
  demo: {
    unknown: list => `그런 시연이 없어요. 고를 수 있는 것:\n${list}`,
    ended: '시연을 끝냈어요',
    at: (i, n, title, label, list) => `시연 ${i}/${n}: ${title} — ${label}\n/flow demo next 로 다음, /flow demo stop 으로 끝내요.\n${list}`,
    bar: (i, n, title) => `▶ 시연 ${i}/${n} · ${title}  `,
    prev: '◂ 이전',
    next: '다음 ▸',
    stop: '끝 ✕',
    scenes: n => ` (${n}장면)`,
    untouched: '시연 화면이라 계획판은 그대로예요',
  },
  filled: '입력창에 단계 이름을 넣었어요',
  notFilled: '지금은 입력창에 넣을 수 없어요',
  confirm: '[ 확인 완료 ]',
  discuss: '[ 논의 ]',
  running: '진행 중',
  link: {
    issue: n => `이슈 #${n}`,
    commit: sha => `커밋 ${sha}`,
    artifact: '아티팩트',
  },
  summary: { title: '완료 정리', goal: '목적', result: '결과', links: '링크' },
  shelf: ' 보관한 계획',
  finished: ' 이 세션에서 끝낸 계획',
  finishedLine: '앞서 끝냄',
  empty: '아직 계획이 없어요. 여러 단계가 필요한 요청을 보내면 Claude가 계획을 세워 여기에 그려요.',
  narrow: ' 창을 넓히면 흐름도로 보여요',
  expandAll: '모두 펼치기',
  collapseAll: '모두 접기',
  toList: '목록 보기',
  toFlow: '흐름도 보기',
  foot: {
    scroll: ' 휠로 스크롤해요',
    following: ' 진행 중인 단계를 따라가는 중 · 휠로 둘러보면 멈춰요',
    stopped: ' 따라가기 멈춤   ',
    follow: '진행 중으로',
  },
}

const TABLES: Record<Language, Strings> = { en, ko }

let current: Language = 'en'

export const setLanguage = (language: Language): void => {
  current = language
}
export const language = (): Language => current
export const t = (): Strings => TABLES[current]

export const isLanguage = (v: unknown): v is Language => (LANGUAGES as readonly unknown[]).includes(v)

// Claude Code's `language` setting is free text ("Korean", "한국어", "ko"), and a locale reads
// "ko_KR.UTF-8". A code must end at a separator, so "kotlin" names no language.
const recognize = (v: unknown): Language | undefined => {
  if (typeof v !== 'string') return undefined
  const s = v.trim().toLowerCase()
  if (/^(kor?([-_.@]|$)|korean|한국|한글)/.test(s)) return 'ko'
  if (/^(eng?([-_.@]|$)|english|영어)/.test(s)) return 'en'

  return undefined
}

// The option when it names a language, else Claude Code's language setting, else the locale, else English.
export const pickLanguage = (option: unknown, setting: unknown, locale: unknown): Language =>
  isLanguage(option) ? option : (recognize(setting) ?? recognize(locale) ?? 'en')
