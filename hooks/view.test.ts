import { describe, expect, test } from 'claude-code/testing'
import type { Activity } from '../types'
import type { Board } from './chapters'
import { emptyKept, hear, rewritten, shown } from './chapters'
import { setLanguage } from './i18n'
import type { Row, Shown } from './view'
import { awayRows, bandRows, bandStack, drawerRows, rowText } from './view'
import { cells } from './width'

// The expectations below are written in Korean.
setLanguage('ko')

const idle: Activity = { phase: 'idle', running: [] }
const working: Activity = { phase: 'tool', tool: 'Bash', running: [] }
const PR = 'https://github.com/o/r/pull/142'
const BOARD: Board = {
  title: '결제 웹훅 재시도 정리',
  goal: '결제 실패 알림이 고객에게 한 번만 가게',
  chapters: [
    { request: '알림이 두 번 간대', title: '중복 알림 원인 찾기', result: '재시도가 두 번 등록됨', links: [], done: true, left: [], receipts: [] },
    { request: '큐 바꿔줘', title: '재시도 큐 교체', result: 'PR #142', links: [PR], done: true, left: [], receipts: [] },
    {
      request: '리뷰 반영해줘',
      title: '리뷰 코멘트 반영',
      result: '코멘트 3개 반영, CI 통과',
      links: [],
      done: false,
      left: [
        { text: '스테이징에서 결제 한 건 확인', kind: 'mine' },
        { text: '확인되면 머지', kind: 'claude' },
        { text: '리뷰어의 재검토', kind: 'others' },
        { text: '로그 형식 정리', kind: 'optional' },
        { text: '부하는 재 보지 못함', kind: 'unverified' },
      ],
      receipts: [{ what: 'merged', ref: 'PR #142', url: PR }],
    },
  ],
}
const s: Shown = { board: BOARD, asked: [], running: 0 }
const text = (rows: readonly Row[]): string[] => rows.map(r => rowText(r).replace(/\s+$/, ''))

describe('the band above the prompt', () => {
  const ASKED = '재시도 횟수를 3번으로 둘까요, 5번으로 둘까요?'
  const waits: Shown = { ...s, asked: [ASKED] }
  const band = (x: Shown, a: Activity, o: Partial<{ width: number; maxRows: number; folded: boolean; now: number }> = {}) =>
    bandRows(x, a, { width: 80, maxRows: 20, folded: false, now: 0, ...o })
  const segOf = (rows: readonly Row[], kind: Row['kind'], text: string) => rows.find(r => r.kind === kind)?.line.find(x => x.text.includes(text))

  test('a written board shows the state badge, subject, goal, the rail of chapters, the current chapter and what is left by who moves next', () => {
    expect(text(band(waits, idle))).toEqual([
      expect.stringMatching(/^ ◐ 내 차례 2  결제 웹훅 재시도 정리 ▴ +전체 보기 ▸$/),
      '결제 실패 알림이 고객에게 한 번만 가게',
      '●━━━━━●━━━━━◐   1 중복 알림 원인 찾기 · 2 재시도 큐 교체 · 3 리뷰 코멘트 반영',
      '3 리뷰 코멘트 반영  → 코멘트 3개 반영, CI 통과',
      '  ↗ PR #142 머지됨',
      '▌ 내 차례',
      `▌ ◐ ${ASKED}`,
      '▌ ◐ 스테이징에서 결제 한 건 확인',
      '  Claude가 이어서: 확인되면 머지',
      '  다른 사람 기다림: 리뷰어의 재검토',
    ])
  })

  test('the badge says your turn with a count on the permission colour, working with the turning mark, done in green, else nothing', () => {
    expect(segOf(band(waits, idle), 'title', '내 차례')).toMatchObject({ text: ' ◐ 내 차례 2 ', bg: 'permission', color: 'inverseText', bold: true })
    const notYours: Shown = { ...s, board: { ...BOARD, chapters: BOARD.chapters.map(c => ({ ...c, left: c.left.filter(l => l.kind !== 'mine') })) } }
    expect(segOf(band(notYours, working, { now: 0 }), 'title', '일하는 중')).toMatchObject({ text: '⠋ 일하는 중', bold: true, live: 'mark' })
    const done: Shown = { ...notYours, board: { ...notYours.board, chapters: notYours.board.chapters.map(c => ({ ...c, done: true })) } }
    expect(segOf(band(done, idle), 'title', '끝')).toMatchObject({ text: '✓ 끝', color: 'success' })
    expect(rowText(band(notYours, idle)[0] as Row)).toMatch(/^결제 웹훅 재시도 정리 ▴/)
  })

  test('the rail has a node per chapter: done ones green with green joins, the current one waiting on you in the permission colour, joins after the last done one dim', () => {
    const rail = band(waits, idle).find(r => r.kind === 'rail')?.line ?? []
    expect(rail.slice(0, 4)).toEqual([
      { text: '●', color: 'success' },
      { text: '━━━━━', color: 'success' },
      { text: '●', color: 'success' },
      { text: '━━━━━', color: 'inactive' },
    ])
    expect(rail[4]).toMatchObject({ text: '◐', color: 'permission' })
    expect(rail.find(x => x.text.includes('3 리뷰'))).toMatchObject({ bold: true, color: 'text' })
    expect(rail.find(x => x.text.includes('1 중복'))).toMatchObject({ color: 'inactive' })
  })

  test('on the rail the current chapter turns while Claude works and is a plain ○ when nothing waits', () => {
    expect(band(s, working, { now: 300 }).find(r => r.kind === 'rail')?.line[4]).toMatchObject({ text: '⠸', live: 'mark' })
    const open: Shown = { ...s, board: { ...BOARD, chapters: BOARD.chapters.map(c => ({ ...c, left: [] })) } }
    expect(band(open, idle).find(r => r.kind === 'rail')?.line[4]).toMatchObject({ text: '○', color: 'text' })
  })

  test('with many chapters the rail keeps the latest eight after …, and short names are cut to fit', () => {
    const many: Shown = { ...s, board: { ...BOARD, chapters: Array.from({ length: 12 }, (_, i) => ({ ...(BOARD.chapters[i % 3] as Board['chapters'][number]), done: i < 11, left: [] })) } }
    const rail = rowText(band(many, idle, { width: 60 }).find(r => r.kind === 'rail') as Row)
    expect(rail.startsWith('… ●')).toBe(true)
    expect([...rail].filter(c => '●◐○'.includes(c))).toHaveLength(8)
    expect(rail).toContain('12 ')
    expect(cells(rail)).toBeLessThanOrEqual(60)
  })

  test('only the current chapter is listed; the rail stands for the older ones', () => {
    const rows = text(band(s, idle))
    expect(rows.filter(r => /^\d /.test(r))).toEqual(['3 리뷰 코멘트 반영  → 코멘트 3개 반영, CI 통과'])
    expect(rows.join('\n')).not.toContain('→ 재시도가 두 번 등록됨')
  })

  test('a session of one chapter has no rail', () => {
    const one: Shown = { ...s, board: { ...BOARD, chapters: [BOARD.chapters[2] as Board['chapters'][number]] } }
    expect(band(one, idle).some(r => r.kind === 'rail')).toBe(false)
  })

  test('what waits on the person sits under a bar in the permission colour on every row', () => {
    const rows = band(waits, idle).filter(r => r.line[0]?.text === '▌')
    expect(rows.map(rowText)).toEqual(['▌ 내 차례', `▌ ◐ ${ASKED}`, '▌ ◐ 스테이징에서 결제 한 건 확인'])
    for (const r of rows) expect(r.line[0]).toMatchObject({ color: 'permission' })
  })

  test('what Claude goes on with and what waits on others fold into one dim line each, naming the first and counting the rest', () => {
    const more: Shown = { ...s, board: { ...BOARD, chapters: [{ ...(BOARD.chapters[2] as Board['chapters'][number]), left: [{ text: '확인되면 머지', kind: 'claude' }, { text: '릴리스', kind: 'claude' }, { text: '태그', kind: 'claude' }] }] } }
    const line = band(more, idle).find(r => rowText(r).includes('Claude가 이어서'))
    expect(rowText(line as Row)).toBe('  Claude가 이어서: 확인되면 머지 외 2')
    expect(line?.line.every(x => x.color === 'inactive')).toBe(true)
  })

  test('a request the rules heard shows as the current chapter before the writer rewrites the board', () => {
    const k = hear(rewritten(emptyKept(), BOARD, 0), { kind: 'request', text: '스테이징 확인 끝났어, 머지해줘' })
    expect(text(band(shown(k), working))).toContain('4 스테이징 확인 끝났어, 머지해줘')
  })

  test('while Claude works a bright band sweeps the current title; still, it is one bold run', () => {
    const live = band(s, working, { now: 300 }).find(r => r.kind === 'chapter')?.line.filter(x => x.live === 'title') ?? []
    expect(live.map(x => x.text).join('')).toBe('리뷰 코멘트 반영')
    expect(live[0]).toMatchObject({ text: '리뷰', color: 'text', bold: true })
    expect(live[1]).toMatchObject({ color: 'inactive', bold: true })
    const still = band(s, idle).find(r => r.kind === 'chapter')?.line ?? []
    expect(still.some(x => x.live !== undefined)).toBe(false)
    expect(still.find(x => x.text.includes('리뷰'))).toMatchObject({ text: '3 리뷰 코멘트 반영', bold: true, color: 'text' })
  })

  test('while Claude works one line says what it is doing; background work is counted', () => {
    const rows = text(band({ ...s, running: 2 }, working))
    expect(rows).toContain('  ● Bash 실행 중')
    expect(rows).toContain('  백그라운드 작업 2개 진행 중')
  })

  test('short of rows, what others and Claude do and the rail give way before the current chapter and your turn', () => {
    const rows = text(band(waits, idle, { maxRows: 6 }))
    expect(rows).toHaveLength(6)
    expect(rows).toContain('3 리뷰 코멘트 반영  → 코멘트 3개 반영, CI 통과')
    expect(rows).toContain('▌ ◐ 스테이징에서 결제 한 건 확인')
    expect(rows.join('\n')).not.toContain('Claude가 이어서')
  })

  test('folded, the band keeps its badge, title and one row of goal', () => {
    expect(text(band(waits, idle, { folded: true }))).toEqual([expect.stringMatching(/^ ◐ 내 차례 2  결제 웹훅 재시도 정리 ▾/), '결제 실패 알림이 고객에게 한 번만 가게'])
  })

  test('every row fits a narrow terminal', () => {
    for (const r of text(band(waits, working, { width: 30, maxRows: 10 }))) expect(cells(r)).toBeLessThanOrEqual(30)
  })
})

describe('the note for a person coming back', () => {
  test('says how the latest chapter ended, its receipts and what waits on the person, framed down the left', () => {
    expect(text(awayRows(s, 60))).toEqual(['╭ 자리 비운 동안', '│ · 코멘트 3개 반영, CI 통과', '│ ↗ PR #142 머지됨', '│ ◐ 스테이징에서 결제 한 건 확인', '╰ 입력하면 평소 판으로 돌아가요'])
  })
  test('sits above the band, which keeps the rows left', () => {
    const rows = text(bandStack(s, idle, { width: 60, maxRows: 10, folded: false, now: 0, away: true }))
    expect(rows[0]).toBe('╭ 자리 비운 동안')
    expect(rows[5]).toMatch(/결제 웹훅 재시도 정리 ▴/)
    expect(rows).toHaveLength(10)
  })
})

describe('the drawer', () => {
  const drawer = (x: Shown, a: Activity = idle, width = 60) => drawerRows(x, a, { width, now: 0 })

  test('draws every chapter as a dot on one line, with its request, result and links under it, and your turn gathered at the top', () => {
    expect(text(drawer(s))).toEqual([
      expect.stringMatching(/^결제 웹훅 재시도 정리 +↻$/),
      '결제 실패 알림이 고객에게 한 번만 가게',
      '◐ 내 차례 1: 스테이징에서 결제 한 건 확인',
      '●  1 중복 알림 원인 찾기',
      '│    요청  알림이 두 번 간대',
      '│    결과  재시도가 두 번 등록됨',
      '│',
      '●  2 재시도 큐 교체',
      '│    요청  큐 바꿔줘',
      '│    결과  PR #142',
      '│    ↗ PR #142',
      '│',
      '◐  3 리뷰 코멘트 반영',
      '│    요청  리뷰 반영해줘',
      '│    결과  코멘트 3개 반영, CI 통과',
      '│    ↗ PR #142 머지됨',
      expect.stringMatching(/^├─ 내 차례 +스테이징에서 결제 한 건 확인$/),
      expect.stringMatching(/^├─ Claude +확인되면 머지$/),
      expect.stringMatching(/^├─ 다른 사람 +리뷰어의 재검토$/),
      expect.stringMatching(/^├─ 선택 +로그 형식 정리$/),
      expect.stringMatching(/^└─ 확인 못 함 +부하는 재 보지 못함$/),
    ])
  })

  test('the line under a done chapter is green, under the current one dim', () => {
    const rows = drawer(s)
    expect(rows.find(r => rowText(r).startsWith('●  1'))?.line[0]).toMatchObject({ text: '●', color: 'success' })
    expect(rows.find(r => rowText(r).startsWith('│    요청  알림이'))?.line[0]).toMatchObject({ text: '│', color: 'success' })
    expect(rows.find(r => rowText(r).startsWith('│    요청  리뷰'))?.line[0]).toMatchObject({ text: '│', color: 'inactive' })
    expect(rows.find(r => rowText(r).startsWith('◐  3'))?.line[0]).toMatchObject({ text: '◐', color: 'permission' })
  })

  test('what is left branches off the current chapter, each tagged with whose it is: your turn as a tag on the permission colour, the rest dim', () => {
    const branches = drawer(s).filter(r => /^[├└]─/.test(rowText(r)))
    const tag = (i: number) => branches[i]?.line[1]
    expect(tag(0)).toMatchObject({ text: ' 내 차례 ', bg: 'permission', color: 'inverseText', bold: true, tag: true })
    for (const i of [1, 2, 3, 4]) expect(tag(i)).toMatchObject({ color: 'inactive', tag: true })
    expect(branches.map(b => b.line[1]?.text.trim())).toEqual(['내 차례', 'Claude', '다른 사람', '선택', '확인 못 함'])
  })

  test('the current chapter title row is tinted end to end, and only that one', () => {
    const rows = drawer(s)
    const current = rows.find(r => rowText(r).startsWith('◐  3')) as Row
    expect(current.tint).toBe(true)
    expect(cells(rowText(current))).toBe(60)
    expect(current.line.slice(1).every(x => x.bg === 'subtle')).toBe(true)
    expect(rows.filter(r => r.tint === true)).toHaveLength(1)
  })

  test('while Claude works the current chapter turns and its title sweeps', () => {
    const current = drawerRows(s, working, { width: 60, now: 300 }).find(r => r.tint === true)
    expect(current?.line[0]).toMatchObject({ text: '⠸', live: 'mark' })
    expect(current?.line.some(x => x.live === 'title')).toBe(true)
  })

  test('links and receipts open on press', () => {
    const links = drawer(s).flatMap(r => r.line.filter(x => x.href !== undefined).map(x => [x.text, x.href]))
    expect(links).toEqual([
      ['↗ PR #142', PR],
      ['↗ PR #142 머지됨', PR],
    ])
  })

  test('a long request wraps under its own start, beside the line', () => {
    const long: Shown = { ...s, board: { ...BOARD, chapters: [{ ...(BOARD.chapters[0] as Board['chapters'][number]), request: '결제 실패 알림이 고객에게 두 번씩 간다는 제보가 들어왔으니 원인을 찾아줘' }, BOARD.chapters[2] as Board['chapters'][number]] } }
    const rows = text(drawer(long, idle, 30))
    const at = rows.findIndex(r => r.startsWith('│    요청  '))
    expect(rows[at + 1]).toMatch(/^│ {10}\S/)
    for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(30)
  })

  test('the head carries ↻ at its right edge', () => {
    const head = drawer(s)[0]
    expect(head?.line.at(-1)).toMatchObject({ text: '↻', button: 'refresh' })
  })
})
