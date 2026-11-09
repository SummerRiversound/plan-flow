// A developer's review of how the board served a real session: the board the person last saw,
// optionally the side planner run again over the session's transcript, and Opus scoring both
// against the decisions in .claude/CLAUDE.md. Writes .scratch/review/<session>.html and .json.
//   bun scripts/review.ts                 list the sessions with a saved board
//   bun scripts/review.ts <session> [--replay]
// Models are called through `claude -p` on the developer's own sign-in, with no settings, hooks,
// plugins or CLAUDE.md of theirs loaded.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Board } from '../hooks/board'
import { emptyBoard } from '../hooks/board'
import { drawerView } from '../hooks/drawer'
import { setLanguage, t } from '../hooks/i18n'
import { currentLeaf, hasOpenWork } from '../hooks/plan'
import { describeBoard, runOp } from '../hooks/plan-tool'
import type { Happened } from '../hooks/planner'
import { LOOK_EVERY_MS, LOOK_GAP_MS, PLAN_EVERY, PLANNER_SYSTEM, parseOps, plannerPrompt, remember } from '../hooks/planner'
import { BAND_ROWS, drawTree, lineText } from '../hooks/tree'
import type { Activity } from '../types'
import { esc, FONT_LINK, PAGE_STYLE, preBox } from './html'
import type { Heard } from './session'
import { heard } from './session'

declare const process: { argv: string[]; cwd: () => string; exit: (code: number) => never; stderr: { write: (s: string) => void } }
declare const console: { log: (text: string) => void }

setLanguage('ko')
const HOME = homedir()
const STORE = join(HOME, '.claude/plugins/store')
const PROJECTS = join(HOME, '.claude/projects')
const idle: Activity = { phase: 'idle', running: [] }
const BAND_WIDTH = 80
const DRAWER_WIDTH = 90

type Saved = Record<string, { plan: Board['plan']; shelf: Board['shelf']; savedAt: number }>
type Frame = { at: number; why: string; board: Board; ops?: string }
type Score = { name: string; score: number; why: string; fix: string }
type Verdict = { verdict: string; scores: Score[]; breaks: Array<{ decision: string; where: string }> }

const say = (s: string): void => process.stderr.write(`${s}\n`)

// Every saved board across the installed copies of the mod, the newest kept per session.
const savedBoards = (): Saved => {
  const out: Saved = {}
  for (const f of readdirSync(STORE).filter(f => f.startsWith('plan-flow') && f.endsWith('.json'))) {
    const plans = (JSON.parse(readFileSync(join(STORE, f), 'utf8')) as { plans?: Saved }).plans ?? {}
    for (const [sid, v] of Object.entries(plans)) if ((out[sid]?.savedAt ?? -1) < v.savedAt) out[sid] = v
  }

  return out
}

const transcriptOf = (sid: string): string | undefined =>
  readdirSync(PROJECTS)
    .map(d => join(PROJECTS, d, `${sid}.jsonl`))
    .find(p => existsSync(p))

const ask = (model: string, system: string, prompt: string): string =>
  execFileSync('claude', ['-p', '--model', model, '--setting-sources', '', '--tools', '', '--no-session-persistence', '--system-prompt', system], {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    stdio: ['pipe', 'pipe', 'ignore'],
  })

// The side planner's looks, as the mod times them: on each request and answer, and while Claude
// works once enough state-changing calls or time have passed, never closer than the gap.
// shortcut: no fork reshapes the plan after its first look (the mod's design step needs the live
// conversation), and every Bash call counts as state-changing; add both if replays drift from real boards.
const replay = (events: readonly Heard[]): Frame[] => {
  let board = emptyBoard()
  let fresh: Happened[] = []
  let request = ''
  let calls = 0
  let last = 0
  const frames: Frame[] = []
  const run = (op: Parameters<typeof runOp>[1], at: number): void => {
    const r = runOp(board, op, at)
    if (!('error' in r)) board = r.board
  }
  const look = (at: number, why: string): void => {
    if (fresh.length === 0) return
    const take = fresh
    fresh = []
    calls = 0
    last = at
    const head: Happened[] = request === '' || take.some(h => h.kind === 'request') ? [] : [{ kind: 'request', text: request }]
    say(`  look ${frames.length + 1} (${why})`)
    const text = ask('haiku', PLANNER_SYSTEM, plannerPrompt(board, [...head, ...take]))
    for (const op of parseOps(text)) run(op, at)
    if (hasOpenWork(board.plan) && currentLeaf(board.plan)?.status === 'pending') run({ op: 'next' }, at)
    frames.push({ at, why, board, ops: text.trim() })
  }
  for (const e of events) {
    fresh = remember(fresh, { kind: e.kind, text: e.text })
    const gap = e.at - last >= LOOK_GAP_MS
    if (e.kind === 'request') {
      request = e.text
      look(e.at, '요청')
    } else if (e.kind === 'answer') look(e.at, '답')
    else if (e.kind === 'tool') {
      if (e.guarded === true) calls++
      if (gap && (calls >= PLAN_EVERY || e.at - last >= LOOK_EVERY_MS)) look(e.at, '작업 중')
    } else if (e.kind === 'said' && gap) look(e.at, 'Claude가 진행 상황을 말함')
  }

  return frames
}

const KIND = { request: '요청', notice: '알림', tool: '호출', subagent: '하위 호출', said: 'Claude(중간)', answer: 'Claude(답)' } as const
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// The session as the judge reads it: newest kept when it runs long.
const story = (events: readonly Heard[]): string => {
  const rows = events.map(e => `- [${KIND[e.kind]}] ${cut(e.text.replace(/\s+/g, ' ').trim(), e.kind === 'request' ? 1500 : e.kind === 'tool' ? 160 : 600)}`)
  const out: string[] = []
  let size = 0
  for (let i = rows.length - 1; i >= 0 && size < 60_000; i--) {
    out.unshift(rows[i] as string)
    size += (rows[i] as string).length
  }

  return out.join('\n')
}

const band = (b: Board, at: number) =>
  drawTree(b.plan, idle, { maxRows: BAND_ROWS, width: BAND_WIDTH, now: at, open: t().bandOpen, parked: b.shelf.filter(s => s.state === 'parked').length, folded: false })
const drawer = (b: Board, at: number) => {
  const v = drawerView(b.plan, b.shelf, { open: {}, focus: null }, idle, { width: DRAWER_WIDTH, now: at })
  return [...v.head, ...v.body]
}
const asText = (lines: ReturnType<typeof band>): string => lines.map(l => lineText(l).replace(/\s+$/, '')).join('\n')

const JUDGE = `당신은 plan-flow라는 Claude Code 플러그인의 개발자를 돕는 평가자입니다. plan-flow는 코딩 세션 옆에 계획판(입력창 위의 띠와 옆 서랍)을 그려서, 사람이 그 세션이 무엇을 하고 어디까지 왔는지 한눈에 파악하게 합니다.
세션 기록과 그 세션의 계획판을 받아, 그 세션의 사람 입장에서 계획판이 쓸모 있었는지 평가하세요. 개발자가 정한 결정 목록이 기준입니다.

항목(1~5점, 5가 가장 좋음):
1. 한눈에 파악: 제목과 목표 한 줄만 봐도 이 세션이 무엇을 하는지 알 수 있는가
2. 현재 위치: 어디까지 끝났고 지금 무엇을 하며 다음이 무엇인지 바로 보이는가
3. 구조: 단계가 2~5개이고 각 단계 아래 체크포인트가 있는가, 단계 이름이 레포의 루틴(구현, PR)이 아니라 결과물 기준인가, 사람이 따로 확인할 것은 한 건씩 나뉘었는가
4. 내용의 쓸모: 제목과 설명이 무엇을 왜 하는지 알려 주는가, 파일명·코드·명령 같은 코드 단위 내용이 없는가, 군더더기 없이 필요한 만큼인가
5. 작업과 일치: 실제로 한 일이 빠지지 않았는가, 아무도 요청하지 않은 단계가 없는가, 완료·진행·확인 대기 표시가 실제 상태와 맞는가
6. 흐름 관리: 이어지는 일은 그 일이 속한 단계 밑에 붙었는가, 곁가지는 보류됐다가 돌아왔는가, 새 일은 새 계획이 되었는가
7. 완료 정리: 계획이 끝났다면 목적과 결과 정리가 쓸모 있는가 (끝나지 않았으면 점수 0, 이유에 "해당 없음")

각 항목의 이유와 고칠 점은 계획판의 실제 문구를 인용해 구체적으로 쓰세요. 고칠 점은 계획판을 만드는 지시문을 어떻게 바꾸면 좋을지로 씁니다.
결정 목록과 어긋난 곳은 breaks에 결정 요약과 계획판의 위치로 적으세요.
모든 문장은 한국어 해요체로 씁니다.
JSON 하나로만 답하세요. 코드 펜스와 다른 글은 쓰지 않습니다:
{"verdict":"전체 판정 1~2문장","scores":[{"name":"한눈에 파악","score":4,"why":"…","fix":"…"}],"breaks":[{"decision":"…","where":"…"}]}`

const judge = (decisions: string, events: readonly Heard[], b: Board, at: number, label: string): Verdict | undefined => {
  const prompt = [
    `# 개발자가 정한 결정 목록\n${decisions}`,
    `# 세션 기록 (오래된 것부터)\n${story(events)}`,
    `# 평가할 계획판: ${label}\n## 구조 (id와 상태)\n${describeBoard(b)}\n## 입력창 위 띠 (${BAND_WIDTH}칸)\n${asText(band(b, at))}\n## 서랍 (${DRAWER_WIDTH}칸, 처음 열었을 때)\n${asText(drawer(b, at))}`,
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
    : `<h2>${esc(title)}</h2><p style="color:#e8e6e3">${esc(v.verdict)}</p>
<table><tr><th>항목</th><th>점수</th><th>이유</th><th>고칠 점</th></tr>${v.scores
        .map(s => `<tr><td>${esc(s.name)}</td><td class="n">${s.score === 0 ? '–' : s.score}</td><td>${esc(s.why)}</td><td>${esc(s.fix)}</td></tr>`)
        .join('')}</table>${
        v.breaks.length === 0 ? '' : `<h3>결정과 어긋난 곳</h3><ul>${v.breaks.map(x => `<li><b>${esc(x.decision)}</b> — ${esc(x.where)}</li>`).join('')}</ul>`
      }`

const boardHtml = (b: Board, at: number): string =>
  `<div class="row">${preBox(`입력창 위 ${BAND_WIDTH}칸`, band(b, at), BAND_WIDTH, BAND_ROWS)}${preBox(`서랍 ${DRAWER_WIDTH}칸 (처음 열었을 때)`, drawer(b, at), DRAWER_WIDTH)}</div>`

const time = (ms: number): string => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const main = (): void => {
  const [sid, ...flags] = process.argv.slice(2)
  const saved = savedBoards()
  if (sid === undefined) {
    for (const [id, v] of Object.entries(saved).sort((a, b) => b[1].savedAt - a[1].savedAt)) console.log(`${id}  ${time(v.savedAt)}  ${v.plan.title}`)
    return
  }
  const last = saved[sid]
  const path = transcriptOf(sid)
  if (path === undefined) {
    say(`no transcript for session ${sid} under ${PROJECTS}`)
    process.exit(1)
  }
  const events = heard(readFileSync(path, 'utf8'))
  const claudeMd = readFileSync(join(process.cwd(), '.claude/CLAUDE.md'), 'utf8')
  const decisions = claudeMd.slice(claudeMd.indexOf('## Decisions'))
  const end = events.at(-1)?.at ?? Date.now()

  const sections: string[] = []
  const report: Record<string, unknown> = { session: sid, transcript: path, events: events.length }
  if (last !== undefined) {
    say('judging the board the person last saw…')
    const real: Board = { plan: last.plan, shelf: last.shelf }
    const v = judge(decisions, events, real, last.savedAt, '사람이 마지막으로 본 판')
    report.saved = { savedAt: last.savedAt, verdict: v }
    sections.push(verdictHtml(`사람이 마지막으로 본 판 · ${time(last.savedAt)}`, v), boardHtml(real, last.savedAt))
  }
  if (flags.includes('--replay')) {
    say(`replaying ${events.length} events through the side planner…`)
    const frames = replay(events)
    const final = frames.at(-1)
    const v = final === undefined ? undefined : judge(decisions, events, final.board, final.at, '지금 지시문으로 다시 돌린 판')
    report.replay = { looks: frames.length, verdict: v, ops: frames.map(f => ({ at: f.at, why: f.why, ops: f.ops })) }
    sections.push(
      verdictHtml(`지금 지시문으로 다시 돌린 판 · 계획판 모델 ${frames.length}번 호출`, v),
      ...frames.map(
        (f, i) =>
          `<details${i === frames.length - 1 ? ' open' : ''}><summary>${i + 1}. ${time(f.at)} · ${esc(f.why)}</summary>${boardHtml(f.board, f.at)}<pre class="ops">${esc(f.ops ?? '')}</pre></details>`,
      ),
    )
  }
  if (sections.length === 0) {
    say(`session ${sid} has no saved board; run with --replay to draw one`)
    process.exit(1)
  }

  const title = last?.plan.title ?? sid
  const dir = join(process.cwd(), '.scratch/review')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sid}.json`), JSON.stringify(report, null, 2))
  writeFileSync(
    join(dir, `${sid}.html`),
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>계획판 리뷰</title>${FONT_LINK}<style>
${PAGE_STYLE}
h3{font-size:14px;margin:16px 0 4px}table{border-collapse:collapse;margin:8px 0 16px;max-width:1200px}
th,td{border-top:1px solid #2c2926;padding:6px 10px;text-align:left;vertical-align:top}th{color:#9a968f;font-weight:400}td.n{text-align:center;font-weight:700}
th:nth-child(-n+2),td:nth-child(-n+2){white-space:nowrap}
details{margin:8px 0}summary{cursor:pointer;color:#9a968f}pre.ops{font-size:12px;width:auto;max-width:1200px;white-space:pre-wrap;margin-top:8px}
</style></head><body><h1>${esc(title)}</h1><p>세션 ${esc(sid)} · ${time(events[0]?.at ?? end)} ~ ${time(end)} · 기록 ${events.length}줄</p>
${sections.join('\n')}</body></html>`,
  )
  console.log(join(dir, `${sid}.html`))
}

main()
