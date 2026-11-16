// A developer's review of how the board served a real session: the board the person last saw, and
// Opus scoring it against the person's own bar and the decisions in .claude/CLAUDE.md, beside what
// the board's model calls cost. Writes .scratch/review/<session>.html and .json.
//   bun scripts/review.ts             list the sessions with a saved board
//   bun scripts/review.ts <session>   score that session's board
//   REVIEW_DIR moves where a review is written.
// Models are called through `claude -p` on the developer's own sign-in, with no settings, hooks,
// plugins or CLAUDE.md of theirs loaded.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Kept } from '../hooks/chapters'
import { shown } from '../hooks/chapters'
import { setLanguage } from '../hooks/i18n'
import type { Row, Shown } from '../hooks/view'
import { BAND_ROWS, bandRows, drawerRows, rowText } from '../hooks/view'
import type { Activity } from '../types'
import { esc, FONT_LINK, PAGE_STYLE, preBox } from './html'
import type { Heard } from './session'
import { costScore, costShare, heard, itemMean } from './session'

declare const process: { argv: string[]; cwd: () => string; env: Record<string, string | undefined>; exit: (code: number) => never; stderr: { write: (s: string) => void } }
declare const console: { log: (text: string) => void }

setLanguage('ko')
const HOME = homedir()
const STORE = join(HOME, '.claude/plugins/store')
const PROJECTS = join(HOME, '.claude/projects')
const idle: Activity = { phase: 'idle', running: [] }
const BAND_WIDTH = 80
const DRAWER_WIDTH = 90

type Saved = Record<string, { kept: Kept; savedAt: number }>
type Score = { name: string; score: number; why: string; fix: string }
type Verdict = { verdict: string; overall: number; scores: Score[]; breaks: Array<{ decision: string; where: string }> }

const say = (s: string): void => process.stderr.write(`${s}\n`)

// Every saved board across the installed copies of the mod, the newest kept per session.
const savedBoards = (): Saved => {
  const out: Saved = {}
  for (const f of readdirSync(STORE).filter(f => f.startsWith('plan-flow') && f.endsWith('.json'))) {
    const boards = (JSON.parse(readFileSync(join(STORE, f), 'utf8')) as { chapters?: Saved }).chapters ?? {}
    for (const [sid, v] of Object.entries(boards)) if ((out[sid]?.savedAt ?? -1) < v.savedAt) out[sid] = v
  }

  return out
}

type Call = { at: number; call: string; ms: number; result: string; reason?: string; usage?: { input: number; cacheRead: number; cacheWrite: number; output: number } }

// The session's recorded board writes across the installed copies, oldest first.
const savedCalls = (sid: string): Call[] =>
  readdirSync(STORE)
    .filter(f => f.startsWith('plan-flow') && f.endsWith('.json'))
    .flatMap(f => (JSON.parse(readFileSync(join(STORE, f), 'utf8')) as { calls?: Record<string, { calls: Call[] }> }).calls?.[sid]?.calls ?? [])
    .filter(c => c.call === 'write')
    .sort((a, b) => a.at - b.at)

const RESULT: Record<string, string> = { answered: '답함', failed: '실패', 'timed out': '시간 초과' }
const callsHtml = (calls: readonly Call[]): string =>
  `<h2>판 쓰기 호출 기록 · ${calls.length}건</h2><table><tr><th>시각</th><th>걸린 시간</th><th>결과</th><th>토큰 (새로 읽음 · 캐시에서 읽음 · 캐시에 씀 · 답)</th></tr>${calls
    .map(c => `<tr><td>${esc(new Date(c.at).toLocaleTimeString('ko-KR'))}</td><td class="n">${(c.ms / 1000).toFixed(1)}초</td><td>${esc(RESULT[c.result] ?? c.result)}${c.reason === undefined ? '' : ` · ${esc(c.reason)}`}</td><td class="n">${c.usage === undefined ? '' : [c.usage.input, c.usage.cacheRead, c.usage.cacheWrite, c.usage.output].map(n => n.toLocaleString('ko-KR')).join(' · ')}</td></tr>`)
    .join('')}</table>`

const transcriptOf = (sid: string): string | undefined =>
  readdirSync(PROJECTS)
    .map(d => join(PROJECTS, d, `${sid}.jsonl`))
    .find(p => existsSync(p))

const ask = (model: string, system: string, prompt: string): string => {
  const out = execFileSync('claude', ['-p', '--model', model, '--setting-sources', '', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--system-prompt', system], {
    input: prompt,
    // A terminal that wraps claude reports each run's status into the pane it runs in; these runs are not the session there.
    env: { ...process.env, CMUX_CLAUDE_HOOKS_DISABLED: '1' },
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    stdio: ['pipe', 'pipe', 'ignore'],
  })

  return (JSON.parse(out) as { result?: string }).result ?? ''
}

const KIND = { request: '요청', notice: '알림', tool: '호출', subagent: '하위 호출', said: 'Claude(중간)', answer: 'Claude(답)' } as const
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// The session as a log, newest kept when it runs past `max` characters.
const story = (events: readonly Heard[], max = 60_000): string => {
  const rows = events.map(e => `- [${KIND[e.kind]}] ${cut(e.text.replace(/\s+/g, ' ').trim(), e.kind === 'request' ? 1500 : e.kind === 'tool' ? 160 : 600)}`)
  const out: string[] = []
  let size = 0
  for (let i = rows.length - 1; i >= 0 && size < max; i--) {
    out.unshift(rows[i] as string)
    size += (rows[i] as string).length
  }

  return out.join('\n')
}

const band = (s: Shown, at: number): Row[] => bandRows(s, idle, { width: BAND_WIDTH, maxRows: BAND_ROWS, folded: false, now: at })
const drawer = (s: Shown, at: number): Row[] => drawerRows(s, idle, { width: DRAWER_WIDTH, now: at })
const asText = (rows: readonly Row[]): string => rows.map(r => rowText(r).replace(/\s+$/, '')).join('\n')
const asLines = (rows: readonly Row[]) => rows.map(r => [{ text: ' '.repeat(r.indent) }, ...r.line])

// The rubric is the person's own bar, read from what they said about the board while using it.
const JUDGE = `당신은 plan-flow라는 Claude Code 플러그인의 개발자를 돕는 평가자입니다. plan-flow는 코딩 세션 옆에 현황판(입력창 위의 띠와 옆 서랍)을 그립니다. 판은 세션에서 보낸 요청마다 한 장씩, 그 요청으로 무엇이 됐는지와 남은 일을 보여 줍니다.
이 판을 쓰는 사람은 세션을 20개쯤 동시에 켜 두고 탭을 바꿔 가며 일합니다. 탭을 바꾼 순간 판을 몇 초 훑고 "이 세션은 무엇을 위해 무엇을 하고 있고, 지금 어디까지 왔고, 나를 기다리는 게 있는지, 다음은 뭔지"를 알아내는 게 판의 쓸모입니다. 판이 틀리면 그 사람은 판을 믿지 않게 되고, 그러면 판은 쓸모가 없습니다.
그 사람이 한 말:
- "탭전환하다가 이걸보면 그냥 '현재 PR' 혹은 번호로만 써있는걸 알아먹고 아 이세션은 무슨 작업을 하는 세션이구나 하고 알수있을것같냐?"
- "진행중인 체크포인트가 최신이 아닌것같은 현상"
- "각 항목이 너무 축약되어있어서 뭘하고있는지 이해가잘안되는데"
- 글을 읽을 때 막히는 곳은 어려운 개념이 아니라 처음 보는 이름·번호·약어입니다.

세션 기록과 그 세션의 판을 받아, 이 사람 입장에서 채점하세요. 각 점수의 뜻:
5 = 훑고 그대로 믿고 넘어간다. 4 = 바로 알아보고, 사소한 흠은 있어도 행동이 달라지지 않는다. 3 = 알아보긴 하지만 한두 군데는 세션 본문을 다시 확인해야 한다. 2 = 판만 보면 헷갈리거나 일부를 잘못 안다. 1 = 판이 사실과 달라 잘못 판단하게 만든다.

항목:
1. 세션 알아보기: 제목과 목표가 작업 주제로 이 세션을 알아보게 하고, 얻으려는 것을 말하는가
2. 믿을 수 있는 현재 위치: 끝난 일과 지금 일이 사실과 맞고, 세션 후반의 요청과 결과까지 반영됐는가. 판과 실제가 다르면 2점 이하
3. 남은 길: 다음에 할 일과 사람을 기다리는 일이 사실대로 보이는가
4. 이해되는 문장: 무엇을 왜 하는지 알 수 있게 쓰였고, 처음 보는 번호·약어에 기대지 않는가
overall: 이 판이 이 사람에게 얼마나 쓸모 있었는지 하나의 점수. 2번이 낮으면 overall도 그보다 높을 수 없습니다.

결정 목록은 참고 자료입니다. 이 사람이 실제로 불편해할 흠만 점수에 반영하고, 행동이 달라지지 않는 사소한 위반은 점수를 깎지 말고 breaks에만 적으세요.
각 항목의 이유와 고칠 점은 판의 실제 문구를 인용해 구체적으로 쓰세요. 고칠 점은 판을 쓰는 지시문을 어떻게 바꾸면 좋을지로 씁니다.
띠와 서랍의 활동 표시(작업 중, 답변 기다림 같은 말)는 저장된 판에 없는 정보라서 이 도구가 Claude가 쉬는 상태라고 가정하고 그린 것이에요. 평가에 넣지 마세요.
결정 목록과 어긋난 곳은 breaks에 결정 요약과 판의 위치로 적으세요.
모든 문장은 한국어 해요체로 씁니다.
JSON 하나로만 답하세요. 코드 펜스와 다른 글은 쓰지 않습니다:
{"verdict":"전체 판정 1~2문장","overall":3,"scores":[{"name":"세션 알아보기","score":4,"why":"…","fix":"…"}],"breaks":[{"decision":"…","where":"…"}]}`

const judge = (decisions: string, events: readonly Heard[], s: Shown, at: number): Verdict | undefined => {
  const prompt = [
    `# 개발자가 정한 결정 목록\n${decisions}`,
    `# 세션 기록 (오래된 것부터)\n${story(events)}`,
    `# 평가할 판\n## 입력창 위 띠 (${BAND_WIDTH}칸)\n${asText(band(s, at))}\n## 서랍 (${DRAWER_WIDTH}칸)\n${asText(drawer(s, at))}`,
  ].join('\n\n')
  const text = ask('opus', JUDGE, prompt)
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Verdict
  } catch {
    say(`judge answered something that is not JSON:\n${text}`)
    return undefined
  }
}

const verdictHtml = (title: string, v: Verdict | undefined): string =>
  v === undefined
    ? `<h2>${esc(title)}</h2><p>평가 결과를 읽지 못했어요.</p>`
    : `<h2>${esc(title)} · 종합 ${v.overall}/5 · 항목 평균 ${itemMean(v.scores)}</h2><p style="color:#e8e6e3">${esc(v.verdict)}</p>
<table><tr><th>항목</th><th>점수</th><th>이유</th><th>고칠 점</th></tr>${v.scores
        .map(s => `<tr><td>${esc(s.name)}</td><td class="n">${s.score === 0 ? '–' : s.score}</td><td>${esc(s.why)}</td><td>${esc(s.fix)}</td></tr>`)
        .join('')}</table>${
        v.breaks.length === 0 ? '' : `<h3>결정과 어긋난 곳</h3><ul>${v.breaks.map(x => `<li><b>${esc(x.decision)}</b> — ${esc(x.where)}</li>`).join('')}</ul>`
      }`

const boardHtml = (s: Shown, at: number): string =>
  `<div class="row">${preBox(`입력창 위 ${BAND_WIDTH}칸 · 활동 표시는 쉬는 상태로 가정`, asLines(band(s, at)), BAND_WIDTH, BAND_ROWS)}${preBox(`서랍 ${DRAWER_WIDTH}칸 · 활동 표시는 쉬는 상태로 가정`, asLines(drawer(s, at)), DRAWER_WIDTH)}</div>`

const eventsOf = (path: string): Heard[] => {
  const dir = path.replace(/\.jsonl$/, '/subagents')
  const subs = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => readFileSync(join(dir, f), 'utf8')) : []
  return heard(readFileSync(path, 'utf8'), subs)
}

const time = (ms: number): string => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const main = (): void => {
  const [sid] = process.argv.slice(2)
  const saved = savedBoards()
  if (sid === undefined) {
    for (const [id, v] of Object.entries(saved).sort((a, b) => b[1].savedAt - a[1].savedAt)) console.log(`${id}  ${time(v.savedAt)}  ${shown(v.kept).board.title}`)
    return
  }
  const last = saved[sid]
  const path = transcriptOf(sid)
  if (last === undefined || path === undefined) {
    say(last === undefined ? `session ${sid} has no saved board` : `no transcript for session ${sid} under ${PROJECTS}`)
    process.exit(1)
  }
  const events = eventsOf(path)
  const claudeMd = readFileSync(join(process.cwd(), '.claude/CLAUDE.md'), 'utf8')
  const decisions = claudeMd.slice(claudeMd.indexOf('## Decisions'))
  const end = events.at(-1)?.at ?? Date.now()
  const board = shown(last.kept)

  say('judging the board the person last saw…')
  const v = judge(decisions, events, board, last.savedAt)
  // The cost item is counted from the saved calls, not judged: what the board's writes cost beside the work.
  const calls = savedCalls(sid)
  const share = costShare(calls, readFileSync(path, 'utf8'))
  if (v !== undefined && share !== undefined) v.scores.push({ name: '비용', score: costScore(share), why: `판 쓰기 호출이 이 세션 본 작업 비용의 ${share.toFixed(1)}%를 썼어요.`, fix: '' })
  const report = { session: sid, transcript: path, events: events.length, saved: { savedAt: last.savedAt, verdict: v }, calls }
  const sections = [verdictHtml(`사람이 마지막으로 본 판 · ${time(last.savedAt)}`, v), boardHtml(board, last.savedAt), ...(calls.length === 0 ? [] : [callsHtml(calls)])]

  const dir = process.env.REVIEW_DIR ?? join(process.cwd(), '.scratch/review')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sid}.json`), JSON.stringify(report, null, 2))
  writeFileSync(
    join(dir, `${sid}.html`),
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>현황판 리뷰</title>${FONT_LINK}<style>
${PAGE_STYLE}
h3{font-size:14px;margin:16px 0 4px}table{border-collapse:collapse;margin:8px 0 16px;max-width:1200px}
th,td{border-top:1px solid #2c2926;padding:6px 10px;text-align:left;vertical-align:top}th{color:#9a968f;font-weight:400}td.n{text-align:center;font-weight:700}
th:nth-child(-n+2),td:nth-child(-n+2){white-space:nowrap}
</style></head><body><h1>${esc(board.board.title || sid)}</h1><p>세션 ${esc(sid)} · ${time(events[0]?.at ?? end)} ~ ${time(end)} · 기록 ${events.length}줄</p>
${sections.join('\n')}</body></html>`,
  )
  console.log(join(dir, `${sid}.html`))
}

main()
