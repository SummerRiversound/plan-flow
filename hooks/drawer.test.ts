import { expect, test } from 'claude-code/testing'
import type { DrawerState } from '../types'
import { ASK, CONFIRM, COLLAPSE_ALL, EXPAND_ALL, FOLLOW, VIEW, drawFlow, drawerPage, drawerView, foldAll, isOpen, linkLabel, linkRow, pickStep, shelfLines, toggleFold } from './drawer'
import type { Plan, PlanInput, PlanResult } from './plan'
import { emptyPlan, nextStep, setPlan, updateNodes } from './plan'
import { idleActivity } from './activity'
import { lineText } from './tree'
import { cells } from './width'
import { setLanguage } from './i18n'

// The expectations below are written in Korean.
setLanguage('ko')

const ok = (r: PlanResult): Plan => {
  if ('error' in r) throw new Error(r.error)

  return r.plan
}

const STEPS: PlanInput[] = [
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
  { title: '검증', parallel: true, children: [{ title: '테스트', children: [{ title: '단위' }, { title: '통합' }, { title: '화면' }] }, { title: '문서', children: [{ title: 'README' }] }] },
  { title: '배포', children: [{ title: '스테이징' }, { title: '운영' }] },
]

// 조사 and 로그인 화면 done, 주소 만들기 done, 비밀번호 확인 and 색 맞추기 running.
const sample = (): Plan => {
  let p = ok(setPlan(emptyPlan(), '로그인 기능 추가', STEPS, 0))
  p = ok(nextStep(p, undefined, 1_000))
  p = ok(nextStep(p, undefined, 124_000))
  p = ok(nextStep(p, undefined, 172_000))
  return ok(nextStep(p, '2.2.1.1', 203_000))
}
const closed: DrawerState = { open: {}, focus: null }
const draw = (p: Plan, d: DrawerState = closed, width = 53) => drawFlow(p, d, { width, now: 252_000 })
const texts = (p: Plan, d: DrawerState = closed, width = 53): string[] => draw(p, d, width).lines.map(lineText)

const view = (p: Plan, d: DrawerState = closed, width = 53) => drawerView(p, [], d, idleActivity(), { width, now: 252_000 })

test('the pinned head names the plan, its progress, then the buttons that fold every box', () => {
  const head = view(sample()).head.map(lineText)
  expect(head[0]?.startsWith(' 로그인 기능 추가')).toBe(true)
  expect(head[1]).toMatch(/━+╸?━+ +3\/14 · 21%$/)
  expect(head.find(l => l.includes('모두 펼치기'))).toContain('모두 접기')
  expect(view(sample()).head.flat().filter(s => s.button !== undefined).map(s => s.button)).toEqual([EXPAND_ALL, COLLAPSE_ALL, VIEW])
  for (const l of head) expect(cells(l)).toBeLessThanOrEqual(53)
})

test('fold all and unfold all reach every box with something inside', () => {
  const p = sample()
  const all = drawFlow(p, foldAll(p, closed, true), { width: 53, now: 0 }).lines.map(lineText)
  expect(all.some(l => l.includes('단위'))).toBe(true)
  expect(all.some(l => l.includes('스테이징'))).toBe(true)
  const none = drawFlow(p, foldAll(p, closed, false), { width: 53, now: 0 }).lines.map(lineText)
  expect(none.some(l => l.includes('비밀번호 확인'))).toBe(false)
  expect(none.find(l => l.includes('● 구현'))).toContain('▸')
})

test('a body taller than the pane scrolls under the pinned head and a foot that follows the running step', () => {
  const v = view(sample(), foldAll(sample(), closed, true))
  const follow = drawerPage(v, 20, undefined, 53)
  expect(follow.pinned).toBe(true)
  expect(follow.lines).toHaveLength(21)
  expect(follow.lines.slice(0, v.head.length)).toEqual(v.head)
  const shown = follow.lines.slice(v.head.length, 20 - 2).map(lineText)
  expect(shown.some(l => l.includes('비밀번호 확인'))).toBe(true)
  expect(lineText(follow.lines[19] ?? [])).toContain('따라가는 중')
  const stopped = drawerPage(v, 20, 0, 53)
  expect(stopped.top).toBe(0)
  expect(stopped.lines[19]?.find(s => s.button === FOLLOW)?.text).toBe('진행 중으로')
  expect(drawerPage(v, 20, 10_000, 53).top).toBe(stopped.max)
})

test('following puts the running step in the middle of the window, even near the start or the end', () => {
  const mid = (p: Plan) => {
    const v = view(p, foldAll(p, closed, true))
    const page = drawerPage(v, 20, undefined, 53)
    const room = 20 - v.head.length - 2
    return { row: page.lines.findIndex(l => l.some(s => s.node !== undefined && lineText(l).includes(currentTitle(p)))) - v.head.length, room }
  }
  const currentTitle = (p: Plan) => p.nodes.find(n => n.status === 'in_progress' && !p.nodes.some(c => c.parentId === n.id))?.title ?? ''
  const first = ok(nextStep(ok(setPlan(emptyPlan(), '로그인 기능 추가', STEPS, 0)), undefined, 1_000))
  let last = first
  while (last.nodes.some(n => n.title === '운영' && n.status !== 'in_progress')) last = ok(nextStep(last, undefined, 2_000))
  for (const p of [first, sample(), last]) {
    const { row, room } = mid(p)
    expect(row).toBe(Math.floor(room / 2))
  }
})

test('following a finished plan shows the end of the body, at the bottom of the window', () => {
  let done = ok(setPlan(emptyPlan(), '로그인 기능 추가', STEPS, 0))
  while (done.nodes.some(n => n.status !== 'completed')) done = ok(nextStep(done, undefined, 1_000))
  const v = view(done, foldAll(done, closed, true))
  const page = drawerPage(v, 20, undefined, 53)
  const room = 20 - v.head.length - 2
  const lastBody = v.body.map(lineText).filter(t => t.trim() !== '').at(-1)
  expect(page.pinned).toBe(true)
  expect(lineText(page.lines[v.head.length + room - 1] ?? [])).toBe(lastBody)
})

test('a finished plan ends with its closing note, in the flowchart and the list, following to it', () => {
  let done = ok(setPlan(emptyPlan(), '로그인 기능 추가', STEPS, 0))
  while (done.nodes.some(n => n.status !== 'completed')) done = ok(nextStep(done, undefined, 1_000))
  done = { ...done, summary: { goal: '로그인 기능을 앱에 붙이기', result: '화면과 API, 세션 저장을 만들고 폰에서 로그인부터 다음 화면까지 확인했어요' } }
  for (const v of [view(done), view(done, { ...closed, list: true })]) {
    const body = v.body.map(lineText)
    const at = body.findIndex(l => l.includes('✓ 완료 정리'))
    expect(at).toBeGreaterThan(0)
    expect(body.slice(at).join(' ').replace(/[│ ]+/g, ' ')).toContain('결과: 화면과 API, 세션 저장을 만들고 폰에서 로그인부터 다음 화면까지 확인했어요')
    for (const l of body) expect(cells(l)).toBeLessThanOrEqual(53)
    const page = drawerPage(v, 20, undefined, 53)
    expect(page.lines.map(lineText).join('\n')).toContain('결과:')
  }
  const flow = view(done).body.map(lineText)
  const at = flow.findIndex(l => l.includes('✓ 완료 정리'))
  // Joined to the last stage by an arrow, its walls where the stage boxes' are.
  expect(flow[at - 2]?.trim()).toBe('▼')
  expect(flow[at]?.indexOf('│')).toBe(flow.find(l => l.includes('✓ 조사'))?.indexOf('│'))
  expect(view({ ...done, summary: undefined }).body.map(lineText).join('\n')).not.toContain('완료 정리')
})

test('a body that fits the pane is drawn whole, with no foot', () => {
  const v = view(sample())
  const page = drawerPage(v, 200, undefined, 53)
  expect(page.pinned).toBe(false)
  expect(page.lines).toEqual([...v.head, ...v.body])
})

test('the running stage is open with the running task, the rest is folded', () => {
  const lines = texts(sample())
  expect(lines.find(l => l.includes('● 구현'))).toMatch(/1\/4 ▾ │$/)
  expect(lines.some(l => l.includes('╭ 동시에'))).toBe(true)
  expect(lines.find(l => l.includes('● API'))).toContain('1/3 ▾')
  expect(lines.find(l => l.includes('✓ 주소 만들기'))).toMatch(/주소 만들기 +│$/)
  expect(lines.find(l => l.includes('● 비밀번호 확인'))).toContain('진행 중')
  expect(lines.find(l => l.includes('디자인 다듬기'))).toContain('0/2 ▸')
  expect(lines.some(l => l.includes('색 맞추기'))).toBe(false)
  expect(lines.find(l => l.includes('○ 배포'))).toContain('0/2 ▸')
})

test('stages join with arrows, a parallel stage splits and joins', () => {
  const lines = texts(sample())
  expect(lines.filter(l => l.trim() === '▼').length).toBeGreaterThanOrEqual(2)
  expect(lines.some(l => /╭─+┴─+╮/.test(l))).toBe(true)
  expect(lines.some(l => /^ *▼ +▼ *$/.test(l))).toBe(true)
  expect(lines.some(l => /╰─+┬─+╯/.test(l))).toBe(true)
  // Side by side on one line.
  expect(lines.some(l => l.includes('테스트') && l.includes('문서'))).toBe(true)
})

test('a branch that does not fit beside the other goes to the next row', () => {
  const lines = texts(sample(), closed, 30)
  expect(lines.some(l => l.includes('테스트') && l.includes('문서'))).toBe(false)
  expect(lines.some(l => l.includes('테스트'))).toBe(true)
  expect(lines.some(l => l.includes('문서'))).toBe(true)
})

test('no line is wider than the drawer, Hangul counted as two cells', () => {
  const long = ok(setPlan(emptyPlan(), '아주 긴 한글 계획 제목이 여기에 있습니다', [{ title: '한글로 된 아주 긴 단계 이름입니다', children: [{ title: '체크포인트 이름도 꽤 깁니다' }] }], 0))
  const all: DrawerState = { open: { '2': true, '2.2.1': true, '2.2.2': true, '3.1': true, '3.2': true, '4': true, '1': true }, focus: null }
  for (const p of [sample(), ok(nextStep(long, undefined, 1))]) {
    for (const d of [closed, all]) {
      for (let width = 12; width <= 80; width++) {
        for (const line of draw(p, d, width).lines) expect(cells(lineText(line))).toBeLessThanOrEqual(width)
      }
    }
  }
})

test('every row that shows is a button, in the order the rows are drawn', () => {
  expect(draw(sample()).buttons).toEqual(['1', '2', '2.1', '2.2.1', '2.2.1.1', '2.2.1.2', '2.2.1.3', '2.2.2', '2.3', '3.1', '3.2', '4'])
  // A folded box's steps are not drawn, so they become buttons once it opens.
  expect(draw(sample(), toggleFold(sample(), closed, '2.2.2')).buttons).toContain('2.2.2.1')
})

// Buttons under a step, as the rows read them: `확인 완료` and `논의`.
const actions = (lines: readonly (readonly { text: string; button?: string }[])[]): string[][] =>
  lines.map(l => l.flatMap(s => (s.button === CONFIRM || s.button === ASK ? [s.button] : []))).filter(b => b.length > 0)

test('pressing a step picks it: a step waiting for a check offers 확인 완료 and 논의, others only 논의; again lets it go', () => {
  const p = ok(updateNodes(sample(), [{ id: '2.2.1.1', status: 'needs_check', note: '응답 보기' }], 210_000))
  const waiting = pickStep(closed, '2.2.1.1')
  expect(actions(draw(p, waiting).lines)).toEqual([[CONFIRM, ASK]])
  expect(texts(p, waiting).join('\n')).toContain('[ 확인 완료 ]  [ 논의 ]')
  expect(actions(draw(p, pickStep(closed, '2.2.1.2')).lines)).toEqual([[ASK]])
  expect(pickStep(waiting, '2.2.1.1').pick).toBeUndefined()
  // A box keeps folding when pressed; the drawer still holds its width.
  expect(actions(draw(p, closed).lines)).toEqual([])
  for (const w of [53, 40]) for (const l of texts(p, waiting, w)) expect(cells(l)).toBeLessThanOrEqual(w)
  // The list offers the same buttons under the picked step.
  expect(actions(view(p, { ...waiting, list: true }).body)).toEqual([[CONFIRM, ASK]])
  expect(view(p, { ...waiting, list: true }).buttons).toContain('2.2.1.1')
})

test('a picked step shows its whole note and detail under its row, in the flowchart and the list', () => {
  const note = '폰에서 로그인 버튼을 눌러 보고 다음 화면으로 넘어가는지, 에러 문구가 맞는지 확인'
  const p = ok(updateNodes(sample(), [{ id: '2.2.1.1', status: 'needs_check', note }], 210_000))
  const picked = pickStep(closed, '2.2.1.1')
  const joined = (ls: string[]) => ls.map(l => l.replace(/[│ ]+/g, ' ')).join(' ').replace(/ +/g, ' ')
  // Folded, the row cuts the note; picked, every word of it shows.
  expect(joined(texts(p, closed))).not.toContain('에러 문구가 맞는지 확인')
  expect(joined(texts(p, picked))).toContain('에러 문구가 맞는지 확인')
  expect(joined(view(p, { ...picked, list: true }).body.map(lineText))).toContain('에러 문구가 맞는지 확인')
  for (const w of [53, 40]) for (const l of texts(p, picked, w)) expect(cells(l)).toBeLessThanOrEqual(w)
})

test('pressing a folded box unfolds it, pressing again folds it', () => {
  const p = sample()
  expect(isOpen(p, closed, '4')).toBe(false)
  const opened = toggleFold(p, closed, '4')
  expect(isOpen(p, opened, '4')).toBe(true)
  expect(texts(p, opened).some(l => l.includes('○ 스테이징'))).toBe(true)
  expect(texts(p, opened).find(l => l.includes('○ 배포'))).toContain('0/2 ▾')
  // The running stage starts open; pressing it folds it.
  const folded = toggleFold(p, closed, '2')
  expect(isOpen(p, folded, '2')).toBe(false)
  expect(texts(p, folded).some(l => l.includes('로그인 화면'))).toBe(false)
})

test('a closed box is wide enough for its whole title', () => {
  const steps: PlanInput[] = [{ title: '코드 읽기' }, { title: '진행 부분만 펼치기' }, { title: '화면 확인' }]
  let p = ok(setPlan(emptyPlan(), '서랍', steps, 0))
  p = ok(nextStep(p, undefined, 0))
  p = ok(nextStep(p, undefined, 65_000))
  p = ok(nextStep(p, undefined, 70_000))
  const flow = drawFlow(p, { open: {}, focus: null }, { width: 50, now: 80_000 })
  const text = flow.lines.map(lineText).join('\n')
  expect(text).toMatch(/코드 읽기 +│/)
  expect(text).toContain('진행 부분만 펼치기')
  expect(text).not.toContain('…')
  expect(flow.cut).toBe(false)
})

test('a drawer too narrow for the titles says so', () => {
  expect(drawFlow(sample(), { open: {}, focus: null }, { width: 53, now: 0 }).cut).toBe(false)
  expect(drawFlow(sample(), { open: {}, focus: null }, { width: 24, now: 0 }).cut).toBe(true)
})

test('a long note on a step is cut short in its box and does not send the drawer back to the tree', () => {
  const p = ok(updateNodes(sample(), [{ id: '1', note: '이 단계는 다른 방식으로 바꾸면서 따로 두지 않고 각 변경 직후에 바로 확인하기로 했어요. '.repeat(3) }], 300_000))
  expect(drawFlow(p, closed, { width: 53, now: 0 }).cut).toBe(false)
})

test('parked plans are listed under the flowchart', () => {
  const parked = { plan: sample(), state: 'parked' as const, at: 0 }
  const lines = shelfLines([parked, { ...parked, state: 'cancelled' as const }], 40).map(lineText)
  expect(lines).toHaveLength(3)
  expect(lines[1]).toContain('보관한 계획')
  expect(lines[2]).toMatch(/^ ▸ 로그인 기능 추가 +\d+\/\d+$/)
  expect(shelfLines([], 40)).toEqual([])
})

test('an open box and the running step show their details; folded and finished ones do not', () => {
  const p = ok(setPlan(emptyPlan(), 'T', [
    { title: '조사', detail: '끝난 단계 설명' },
    { title: '구현', detail: '로그인을 실제로 동작하게 만드는 단계', children: [{ title: '화면', detail: '아이디와 비밀번호 입력칸을 그린다' }, { title: 'API', detail: '접힌 단계 설명' }] },
  ], 0))
  const lines = texts(ok(nextStep(ok(nextStep(p, undefined, 1)), undefined, 2)))
  const head = lines.findIndex(l => l.includes('● 구현'))
  expect(lines[head + 1]).toContain('로그인을 실제로 동작하게 만드는 단계')
  const run = lines.findIndex(l => l.includes('● 화면'))
  expect(lines[run + 1]).toContain('아이디와 비밀번호 입력칸을 그린다')
  expect(lines.some(l => l.includes('끝난 단계 설명') || l.includes('접힌 단계 설명'))).toBe(false)
  expect(lines.every(l => cells(l) <= 53)).toBe(true)
})

test('links get short names: PR, issue and commit by number, an artifact as such, a URL by host, a file by name', () => {
  expect(linkLabel('https://github.com/o/r/pull/42')).toBe('PR #42')
  expect(linkLabel('https://github.com/o/r/issues/7#c1')).toBe('이슈 #7')
  expect(linkLabel('https://github.com/o/r/commit/3f9a2c1d8e')).toBe('커밋 3f9a2c1')
  expect(linkLabel('https://claude.ai/code/artifact/abc')).toBe('아티팩트')
  expect(linkLabel('https://www.notion.so/page-1')).toBe('notion.so')
  expect(linkLabel('/home/me/docs/plan.md')).toBe('plan.md')
})

test('a link row fits its width and counts what it leaves out', () => {
  const links = ['https://github.com/o/r/pull/1', 'https://github.com/o/r/pull/2', 'https://github.com/o/r/pull/3']
  expect(lineText(linkRow(links, 60)[0] ?? [])).toBe('  ↗ PR #1  ↗ PR #2  ↗ PR #3')
  expect(lineText(linkRow(links, 20)[0] ?? [])).toBe('  ↗ PR #1  +2')
  expect(linkRow(links, 60)[0]?.find(s => s.text === '↗ PR #1')?.href).toBe('https://github.com/o/r/pull/1')
  expect(linkRow(['/a/b.md'], 60)[0]?.find(s => s.text === '↗ b.md')?.href).toBe('file:///a/b.md')
  expect(linkRow(['notes.md'], 60)[0]?.find(s => s.text === '↗ notes.md')?.href).toBeUndefined()
})

test('links show under a step whose row shows: inside an open box, and not under a closed one', () => {
  const r = updateNodes(sample(), [{ id: '2.1', links: ['https://github.com/o/r/pull/42'] }, { id: '3', links: ['https://github.com/o/r/pull/9'] }], 252_000)
  const p = ok(r)
  const text = draw(p).lines.map(lineText).join('\n')
  expect(text).toContain('↗ PR #42')
  expect(text).not.toContain('↗ PR #9')
})

test('the drawer names the steps waiting for the person to check in its head, and opens the boxes holding them', () => {
  const p = ok(updateNodes(sample(), [{ id: '4.1', status: 'needs_check', note: '문서 읽어 보기' }], 300_000))
  expect(view(p).head.map(lineText)[2]).toBe(' ◐ 확인할 것 1: 스테이징 (문서 읽어 보기)')
  expect(isOpen(p, closed, '4')).toBe(true)
})

test('while Claude works the running steps in the drawer turn instead of showing a still mark', () => {
  const live = drawFlow(sample(), closed, { width: 53, now: 0, live: true }).lines.map(lineText)
  const still = drawFlow(sample(), closed, { width: 53, now: 0 }).lines.map(lineText)
  expect(still.some(l => l.includes('● 비밀번호 확인'))).toBe(true)
  expect(live.some(l => l.includes('● 비밀번호 확인'))).toBe(false)
  expect(live.some(l => l.includes('⠋ 비밀번호 확인'))).toBe(true)
})

test('finished steps step back dim, steps still to come read plain, the running one bold', () => {
  const segs = (title: string) => draw(sample(), foldAll(sample(), closed, true)).lines.flat().find(s => s.text === ` ${title}`)
  expect(segs('조사')).toMatchObject({ color: 'text', dim: true })
  const check = draw(sample()).lines.find(l => l.some(s => s.text === ' 조사'))?.find(s => s.text === '✓')
  expect(check).toMatchObject({ color: 'success' })
  expect(check?.dim).not.toBe(true)
  expect(segs('에러 처리')).toMatchObject({ color: 'text' })
  expect(segs('에러 처리')?.dim).not.toBe(true)
  expect(segs('비밀번호 확인')).toMatchObject({ color: 'text', bold: true })
})

test('a drawer wide enough for the flowchart offers the list, and the list offers the flowchart back', () => {
  const buttons = (v: ReturnType<typeof view>) => v.head.flat().filter(s => s.button !== undefined).map(s => `${s.button}:${s.text}`)
  expect(buttons(view(sample()))).toEqual([`${EXPAND_ALL}:모두 펼치기`, `${COLLAPSE_ALL}:모두 접기`, `${VIEW}:목록 보기`])
  const list = view(sample(), { ...closed, list: true })
  expect(buttons(list)).toEqual([`${VIEW}:흐름도 보기`])
  // The switch ends where the rule ends in both views, so it does not move when pressed.
  const end = (v: ReturnType<typeof view>) => {
    const l = v.head.find(x => x.some(s => s.button === VIEW)) ?? []
    return cells(lineText(l)) + 4 * l.filter(s => s.button !== undefined).length
  }
  for (const w of [53, 70]) {
    expect(end(view(sample(), closed, w))).toBe(w - 1)
    expect(end(view(sample(), { ...closed, list: true }, w))).toBe(w - 1)
  }
  expect(list.body.map(lineText).some(l => l.startsWith('├─ ✓ 조사'))).toBe(true)
  expect(list.body.map(lineText).some(l => l.includes('╭'))).toBe(false)
  // The list follows the running step too.
  expect(lineText(list.body[list.at ?? -1] ?? [])).toContain('비밀번호 확인')
})

test('a drawer too narrow for the flowchart shows the list with no way to switch', () => {
  const narrow = view(sample(), closed, 24)
  expect(narrow.head.flat().some(s => s.button !== undefined)).toBe(false)
  expect(narrow.body.map(lineText).some(l => l.includes('창을 넓히면'))).toBe(true)
})
