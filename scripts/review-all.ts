// Scores every session with a saved board (or the newest N) by running scripts/review.ts on each,
// five at a time, then gathers the scores into .scratch/review/index.html.
//   bun scripts/review-all.ts [--replay] [--limit N]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { esc, PAGE_STYLE } from './html'

declare const process: { argv: string[]; cwd: () => string; stderr: { write: (s: string) => void } }
declare const console: { log: (text: string) => void }

const STORE = join(homedir(), '.claude/plugins/store')
const CONCURRENCY = 5

type Saved = Record<string, { plan: { title: string }; savedAt: number }>
type Verdict = { overall: number; scores: Array<{ name: string; score: number }> }

// The same listing review.ts prints; review.ts runs on import, so it cannot be shared from there.
const savedBoards = (): Saved => {
  const out: Saved = {}
  for (const f of readdirSync(STORE).filter(f => f.startsWith('plan-flow') && f.endsWith('.json'))) {
    const plans = (JSON.parse(readFileSync(join(STORE, f), 'utf8')) as { plans?: Saved }).plans ?? {}
    for (const [sid, v] of Object.entries(plans)) if ((out[sid]?.savedAt ?? -1) < v.savedAt) out[sid] = v
  }

  return out
}

const runReview = (sid: string, replay: boolean): Promise<boolean> =>
  new Promise(done => {
    const child = spawn('bun', ['scripts/review.ts', sid, ...(replay ? ['--replay'] : [])], { stdio: ['ignore', 'ignore', 'inherit'] })
    child.on('error', () => done(false))
    child.on('close', code => done(code === 0))
  })

const date = (ms: number): string => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const replay = args.includes('--replay')
  const limit = Number(args[args.indexOf('--limit') + 1])
  let sessions = Object.entries(savedBoards()).sort((a, b) => b[1].savedAt - a[1].savedAt)
  if (args.includes('--limit') && limit > 0) sessions = sessions.slice(0, limit)

  const dir = join(process.cwd(), '.scratch/review')
  mkdirSync(dir, { recursive: true })
  const ok = new Map<string, boolean>()
  const queue = [...sessions]
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const [sid] = next
      // A leftover result from an earlier run must not pass for this run's.
      rmSync(join(dir, `${sid}.json`), { force: true })
      ok.set(sid, await runReview(sid, replay))
      process.stderr.write(`${ok.get(sid) === true ? 'done' : 'failed'}  ${sid}\n`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sessions.length) }, worker))

  const verdictOf = (sid: string): Verdict | undefined => {
    const file = join(dir, `${sid}.json`)
    if (ok.get(sid) !== true || !existsSync(file)) return undefined
    const report = JSON.parse(readFileSync(file, 'utf8')) as { saved?: { verdict?: Verdict } }
    return report.saved?.verdict
  }
  const rows = sessions.map(([sid, v]) => ({ sid, title: v.plan.title, at: v.savedAt, verdict: verdictOf(sid) }))
  const names = rows.find(r => r.verdict !== undefined)?.verdict?.scores.map(s => s.name) ?? []
  const cell = (n: number | undefined): string => (n === undefined ? '<td class="n">–</td>' : `<td class="n">${n === 0 ? '–' : n}</td>`)
  const avg = (pick: (v: Verdict) => number | undefined): string => {
    const xs = rows.flatMap(r => (r.verdict === undefined ? [] : [pick(r.verdict)])).filter((x): x is number => x !== undefined && x > 0)
    return cell(xs.length === 0 ? undefined : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10)
  }
  const body = rows
    .map(r => {
      const v = r.verdict
      const first = `<td><a href="${esc(r.sid)}.html">${esc(r.title)}</a>${v === undefined ? ' <b>실패</b>' : ''}</td><td>${date(r.at)}</td>`
      return `<tr>${first}${cell(v?.overall)}${names.map(n => cell(v?.scores.find(s => s.name === n)?.score)).join('')}</tr>`
    })
    .join('')
  writeFileSync(
    join(dir, 'index.html'),
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>계획판 리뷰 모음</title><style>
${PAGE_STYLE}
table{border-collapse:collapse}th,td{border-top:1px solid #2c2926;padding:6px 10px;text-align:left}th{color:#9a968f;font-weight:400}td.n{text-align:center;font-weight:700}
a{color:#e8e6e3}b{color:#ff6b80}tfoot td{border-top:2px solid #2c2926;font-weight:700}
</style></head><body><h1>계획판 리뷰 모음</h1><p>세션 ${rows.length}개${replay ? ' · 다시 돌린 판 포함' : ''}</p>
<table><thead><tr><th>세션</th><th>저장 시각</th><th>종합</th>${names.map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${body}</tbody>
<tfoot><tr><td>평균</td><td></td>${avg(v => v.overall)}${names.map(n => avg(v => v.scores.find(s => s.name === n)?.score)).join('')}</tr></tfoot></table></body></html>`,
  )
  console.log(join(dir, 'index.html'))
}

void main()
