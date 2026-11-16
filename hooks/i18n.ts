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
  // What is left, by who moves next.
  left: { mine: 'Your turn', claude: 'Claude goes on with', others: 'Waiting on others', optional: 'Optional', unverified: 'Claude did not check' },
  mineLine: (n: number) => `◐ Your turn ${n}: `,
  label: { request: 'Asked', result: 'Result' },
  receipt: { opened: 'opened', ready: 'ready for review', merged: 'merged', release: (tag: string) => `release ${tag}` },
  away: { head: 'While you were away', foot: 'Type to go back to the board' },
  pane: 'Session chapters',
  command: 'Open or close the session chapters; on, off or status for this session',
  closed: 'Closed the session chapters',
  opened: 'Opened the session chapters',
  openedLater: 'Opened the session chapters; they show once the window is wide enough',
  turnedOn: 'Turned plan-flow on in this session',
  turnedOff: 'Turned plan-flow off in this session: no board and no model calls until /flow on',
  isOff: 'plan-flow is off in this session; /flow on turns it on',
  status: (on: boolean, startOn: boolean, kept: number, write: Usage) =>
    [
      `plan-flow is ${on ? 'on' : 'off'} in this session (new sessions start ${startOn ? 'on' : 'off'})`,
      `In the last ${kept} calls:`,
      `  Sonnet board ${write.count} ${write.count === 1 ? 'call' : 'calls'}: input ${n(write.input)} · cache read ${n(write.cacheRead)} · output ${n(write.output)} tokens`,
    ].join('\n'),
  bandOpen: 'Show all ▸',
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
  rewrote: (ok: boolean): string => (ok ? 'Wrote the board again from the whole session' : "Couldn't write the board again; it stays as it was"),
  running: 'running',
  link: {
    issue: (n: string) => `Issue #${n}`,
    commit: (sha: string) => `Commit ${sha}`,
    artifact: 'Artifact',
  },
  empty: 'No requests yet. Each request you send becomes a chapter here, with what came of it.',
  sessions: 'All sessions',
  ago: (ms: number) => (ms < 60_000 ? 'just now' : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m ago` : `${Math.floor(ms / 3_600_000)}h ago`),
}

export type Strings = typeof en

const ko: Strings = {
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
  left: { mine: '내 차례', claude: 'Claude가 이어서 할 일', others: '다른 사람을 기다림', optional: '선택 사항', unverified: 'Claude가 확인하지 못한 것' },
  mineLine: n => `◐ 내 차례 ${n}: `,
  label: { request: '요청', result: '결과' },
  receipt: { opened: '열림', ready: '리뷰 준비', merged: '머지됨', release: tag => `릴리스 ${tag}` },
  away: { head: '자리 비운 동안', foot: '입력하면 평소 판으로 돌아가요' },
  pane: '세션 목차',
  command: '세션 목차를 열거나 닫아요. on, off, status로 이 세션의 plan-flow를 켜고 끄고 살펴봐요',
  closed: '세션 목차를 닫았어요',
  opened: '세션 목차를 열었어요',
  openedLater: '세션 목차를 열었어요. 화면이 넓어지면 보여요',
  turnedOn: '이 세션에서 plan-flow를 켰어요',
  turnedOff: '이 세션에서 plan-flow를 껐어요. /flow on 전까지 판도 모델 호출도 없어요',
  isOff: '이 세션에서는 plan-flow가 꺼져 있어요. /flow on으로 켤 수 있어요',
  status: (on, startOn, kept, write) =>
    [
      `plan-flow가 이 세션에서 ${on ? '켜져' : '꺼져'} 있어요 (새 세션은 ${startOn ? '켜진' : '꺼진'} 채로 시작)`,
      `최근 호출 ${kept}번 안에서:`,
      `  Sonnet 판 쓰기 ${write.count}번: 입력 ${n(write.input)} · 캐시 읽기 ${n(write.cacheRead)} · 출력 ${n(write.output)} 토큰`,
    ].join('\n'),
  bandOpen: '전체 보기 ▸',
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
    untouched: '시연 화면이라 판은 그대로예요',
  },
  rewrote: ok => (ok ? '세션 전체를 다시 읽고 판을 새로 썼어요' : '판을 다시 쓰지 못했어요. 판은 그대로예요'),
  running: '진행 중',
  link: {
    issue: n => `이슈 #${n}`,
    commit: sha => `커밋 ${sha}`,
    artifact: '아티팩트',
  },
  empty: '아직 요청이 없어요. 요청을 보내면 그 요청과 결과가 여기에 한 장씩 쌓여요.',
  sessions: '모든 세션',
  ago: ms => (ms < 60_000 ? '방금' : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}분 전` : `${Math.floor(ms / 3_600_000)}시간 전`),
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
