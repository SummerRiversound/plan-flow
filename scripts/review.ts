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

declare const process: { argv: string[]; cwd: () => string; env: Record<string, string | undefined>; exit: (code: number) => never; stderr: { write: (s: string) => void } }
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
type Verdict = { verdict: string; overall: number; scores: Score[]; breaks: Array<{ decision: string; where: string }> }

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

type Call = { at: number; call: 'look' | 'design'; ms: number; result: string; ops?: number; reason?: string }

// The session's recorded model calls across the installed copies, oldest first.
const savedCalls = (sid: string): Call[] =>
  readdirSync(STORE)
    .filter(f => f.startsWith('plan-flow') && f.endsWith('.json'))
    .flatMap(f => (JSON.parse(readFileSync(join(STORE, f), 'utf8')) as { calls?: Record<string, { calls: Call[] }> }).calls?.[sid]?.calls ?? [])
    .sort((a, b) => a.at - b.at)

const CALL = { look: '계획판 모델', design: '계획 다듬기' } as const
const RESULT: Record<string, string> = { answered: '답함', failed: '실패', 'timed out': '시간 초과', stale: '그사이 계획이 바뀌어 적용 안 함' }
const callsHtml = (calls: readonly Call[]): string =>
  `<h2>모델 호출 기록 · ${calls.length}건</h2><table><tr><th>시각</th><th>호출</th><th>걸린 시간</th><th>결과</th></tr>${calls
    .map(c => `<tr><td>${esc(new Date(c.at).toLocaleTimeString('ko-KR'))}</td><td>${CALL[c.call]}</td><td class="n">${(c.ms / 1000).toFixed(1)}초</td><td>${esc(RESULT[c.result] ?? c.result)}${c.ops === undefined ? '' : ` · 적용 ${c.ops}`}${c.reason === undefined ? '' : ` · ${esc(c.reason)}`}</td></tr>`)
    .join('')}</table>`

const transcriptOf = (sid: string): string | undefined =>
  readdirSync(PROJECTS)
    .map(d => join(PROJECTS, d, `${sid}.jsonl`))
    .find(p => existsSync(p))

const ask = (model: string, system: string, prompt: string): string =>
  execFileSync('claude', ['-p', '--model', model, '--setting-sources', '', '--tools', '', '--no-session-persistence', '--system-prompt', system], {
    input: prompt,
    // A terminal that wraps claude reports each run's status into the pane it runs in; these runs are not the session there.
    env: { ...process.env, CMUX_CLAUDE_HOOKS_DISABLED: '1' },
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
    else if (e.kind === 'tool' || e.kind === 'subagent') {
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

// The rubric is the person's own bar, read from what they said about the board while using it.
const JUDGE = `당신은 plan-flow라는 Claude Code 플러그인의 개발자를 돕는 평가자입니다. plan-flow는 코딩 세션 옆에 계획판(입력창 위의 띠와 옆 서랍)을 그립니다.
이 판을 쓰는 사람은 세션을 20개쯤 동시에 켜 두고 탭을 바꿔 가며 일합니다. 탭을 바꾼 순간 판을 몇 초 훑고 "이 세션은 무엇을 위해 무엇을 하고 있고, 지금 어디까지 왔고, 다음은 뭐지"를 알아내는 게 판의 쓸모입니다. 판이 틀리면 그 사람은 판을 믿지 않게 되고, 그러면 판은 쓸모가 없습니다.
그 사람이 판을 쓰면서 실제로 한 말이 기준입니다:
- "탭전환하다가 이걸보면 그냥 '현재 PR' 혹은 번호로만 써있는걸 알아먹고 아 이세션은 무슨 작업을 하는 세션이구나 하고 알수있을것같냐?"
- "써머리는, 내가 궁극적으로 하려는 무언가를 도출해낸느낌이아니라 현황 소개느낌이고, 여전히 단계도 이후 단계가 설계되어있지 않고 제안도 되지않는것같아"
- "진행중인 체크포인트가 최신이 아닌것같은 현상"
- "요청한 일에서 파생된 너가 정말 세워서 나한테 묻지않고 진행할 계획들은 실선으로그려져야하는데"
- "각 항목이 너무 축약되어있어서 뭘하고있는지 이해가잘안되는데" / "몇줄 수정하는지까지 다보고싶은건 아니야. 상위레벨의 상황파악을위한 체크포인트들이 하이라키구조에 맞게"
- "결정기록, 구현, pr 같은 걸로만 묶여버리는데 너무 단순화되고 항상 똑같은게 나올까 걱정" / "모든일이 pr 단위로 일어나지않잖아"
- "그냥 히스토리 목록처럼 아까전까지 뭐했고 지금 뭐하고있다 하면서 마지막카드만 계속 바꾸는식으로" 동작하는 걸 싫어합니다. 판은 작업의 계획입니다.
- 글을 읽을 때 막히는 곳은 어려운 개념이 아니라 처음 보는 이름·번호·약어입니다.

세션 기록과 그 세션의 계획판을 받아, 이 사람 입장에서 채점하세요. 각 점수의 뜻:
5 = 훑고 그대로 믿고 넘어간다. 4 = 바로 알아보고, 사소한 흠은 있어도 행동이 달라지지 않는다. 3 = 알아보긴 하지만 한두 군데는 세션 본문을 다시 확인해야 한다. 2 = 판만 보면 헷갈리거나 일부를 잘못 안다. 1 = 판이 사실과 달라 잘못 판단하게 만든다.

항목:
1. 세션 알아보기: 제목이 번호나 일반어가 아니라 작업 주제로 이 세션을 알아보게 하는가, 목표가 현황 소개가 아니라 궁극적으로 얻으려는 것을 말하는가, 일이 넓어졌으면 그에 맞게 바뀌었는가
2. 믿을 수 있는 현재 위치: 끝난 일은 끝났고 진행 중인 체크포인트가 최신이며, 세션 후반의 요청과 결과까지 반영됐는가. 판과 실제가 다르면 이 항목은 2점 이하
3. 남은 길: Claude가 묻지 않고 할 다음 단계가 실선으로 설계돼 있고, 사람이나 외부를 기다리는 일은 점선 예상이나 확인할 것으로 보이는가
4. 수준과 구조: 단계 아래 체크포인트로 나뉜 계층인가(평평한 목록이 아닌가), 단계가 결과물 이름이고 PR·구현·머지 같은 루틴 이름이 아닌가, 파일명·명령 같은 코드 단위가 아닌가
5. 이해되는 문장: 각 단계가 무엇을 왜 하는지 알 수 있게 쓰였는가(너무 축약되지 않았는가), 처음 보는 번호·약어에 기대지 않는가, 군더더기는 없는가
overall: 이 판이 이 사람에게 얼마나 쓸모 있었는지 하나의 점수. 2번이 낮으면 overall도 그보다 높을 수 없습니다.

결정 목록은 참고 자료입니다. 이 사람이 실제로 불편해할 흠만 점수에 반영하고, 행동이 달라지지 않는 사소한 위반(링크 하나 누락, 완료 정리 문구 같은 것)은 점수를 깎지 말고 breaks에만 적으세요.
각 항목의 이유와 고칠 점은 계획판의 실제 문구를 인용해 구체적으로 쓰세요. 고칠 점은 계획판을 만드는 지시문을 어떻게 바꾸면 좋을지로 씁니다.
띠와 서랍의 활동 표시(작업 중, 답변 기다림 같은 말)는 저장된 판에 없는 정보라서 이 도구가 Claude가 쉬는 상태라고 가정하고 그린 것이에요. 평가에 넣지 마세요.
결정 목록과 어긋난 곳은 breaks에 결정 요약과 계획판의 위치로 적으세요.
모든 문장은 한국어 해요체로 씁니다.
JSON 하나로만 답하세요. 코드 펜스와 다른 글은 쓰지 않습니다:
{"verdict":"전체 판정 1~2문장","overall":3,"scores":[{"name":"세션 알아보기","score":4,"why":"…","fix":"…"}],"breaks":[{"decision":"…","where":"…"}]}`

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
    : `<h2>${esc(title)} · 종합 ${v.overall}/5</h2><p style="color:#e8e6e3">${esc(v.verdict)}</p>
<table><tr><th>항목</th><th>점수</th><th>이유</th><th>고칠 점</th></tr>${v.scores
        .map(s => `<tr><td>${esc(s.name)}</td><td class="n">${s.score === 0 ? '–' : s.score}</td><td>${esc(s.why)}</td><td>${esc(s.fix)}</td></tr>`)
        .join('')}</table>${
        v.breaks.length === 0 ? '' : `<h3>결정과 어긋난 곳</h3><ul>${v.breaks.map(x => `<li><b>${esc(x.decision)}</b> — ${esc(x.where)}</li>`).join('')}</ul>`
      }`

const boardHtml = (b: Board, at: number): string =>
  `<div class="row">${preBox(`입력창 위 ${BAND_WIDTH}칸 · 활동 표시는 쉬는 상태로 가정`, band(b, at), BAND_WIDTH, BAND_ROWS)}${preBox(`서랍 ${DRAWER_WIDTH}칸 (처음 열었을 때) · 활동 표시는 쉬는 상태로 가정`, drawer(b, at), DRAWER_WIDTH)}</div>`

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
  const subagentDir = join(path.slice(0, -'.jsonl'.length), 'subagents')
  const subagents = existsSync(subagentDir) ? readdirSync(subagentDir).filter(f => f.endsWith('.jsonl')).map(f => readFileSync(join(subagentDir, f), 'utf8')) : []
  const events = heard(readFileSync(path, 'utf8'), subagents)
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
  const calls = savedCalls(sid)
  if (calls.length > 0) {
    report.calls = calls
    sections.push(callsHtml(calls))
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
