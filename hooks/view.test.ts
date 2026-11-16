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
  test('a written board shows its subject, goal, the latest chapters with results, receipts and what is left by who moves next', () => {
    expect(text(bandRows(s, idle, { width: 80, maxRows: 20, folded: false, now: 0 }))).toEqual([
      expect.stringMatching(/^결제 웹훅 재시도 정리 ▴ +목차 보기 ▸$/),
      '결제 실패 알림이 고객에게 한 번만 가게',
      '1 ✓ 중복 알림 원인 찾기  → 재시도가 두 번 등록됨',
      '2 ✓ 재시도 큐 교체  → PR #142',
      '3 ◐ 리뷰 코멘트 반영  → 코멘트 3개 반영, CI 통과',
      '  ↗ PR #142 머지됨',
      '  내 차례',
      '  ◐ 스테이징에서 결제 한 건 확인',
      '  Claude가 이어서 할 일',
      '  ○ 확인되면 머지',
      '  다른 사람을 기다림',
      '  ○ 리뷰어의 재검토',
    ])
  })

  test('only the latest three chapters show', () => {
    const four: Shown = { ...s, board: { ...BOARD, chapters: [BOARD.chapters[0], ...BOARD.chapters] as Board['chapters'] } }
    const rows = text(bandRows(four, idle, { width: 80, maxRows: 20, folded: false, now: 0 }))
    expect(rows.filter(r => /^\d /.test(r)).map(r => r.slice(0, 1))).toEqual(['2', '3', '4'])
  })

  test('short of rows, older chapters and what others do give way before the latest chapter and your turn', () => {
    const rows = text(bandRows(s, idle, { width: 80, maxRows: 6, folded: false, now: 0 }))
    expect(rows).toHaveLength(6)
    expect(rows).toContain('3 ◐ 리뷰 코멘트 반영  → 코멘트 3개 반영, CI 통과')
    expect(rows).toContain('  ◐ 스테이징에서 결제 한 건 확인')
    expect(rows.join('\n')).not.toContain('중복 알림')
  })

  test('a dialog question still open is your turn', () => {
    const asked: Shown = { board: { ...BOARD, chapters: [{ ...(BOARD.chapters[1] as Board['chapters'][number]), done: false }] }, asked: ['3번으로 둘까요, 5번으로 둘까요?'], running: 0 }
    const rows = text(bandRows(asked, idle, { width: 80, maxRows: 20, folded: false, now: 0 }))
    expect(rows).toContain('1 ◐ 재시도 큐 교체  → PR #142')
    expect(rows).toContain('  ◐ 3번으로 둘까요, 5번으로 둘까요?')
    const mine = bandRows(asked, idle, { width: 80, maxRows: 20, folded: false, now: 0 }).find(r => rowText(r).includes('3번으로'))
    expect(mine?.line[0]?.color).toBe('permission')
  })

  test('a request the rules heard shows as a chapter before the writer rewrites the board', () => {
    const k = hear(rewritten(emptyKept(), BOARD, 0), { kind: 'request', text: '스테이징 확인 끝났어, 머지해줘' })
    const rows = text(bandRows(shown(k), working, { width: 80, maxRows: 20, folded: false, now: 0 }))
    expect(rows).toContain('4 ⠋ 스테이징 확인 끝났어, 머지해줘')
  })

  test('while Claude works the latest chapter turns and one line says what it is doing; background work is counted', () => {
    const rows = text(bandRows({ ...s, running: 2 }, working, { width: 80, maxRows: 20, folded: false, now: 300 }))
    expect(rows).toContain('3 ⠸ 리뷰 코멘트 반영  → 코멘트 3개 반영, CI 통과')
    expect(rows).toContain('  ● Bash 실행 중')
    expect(rows).toContain('  백그라운드 작업 2개 진행 중')
  })

  test('folded, the band keeps its title and one row of goal', () => {
    expect(text(bandRows(s, idle, { width: 80, maxRows: 20, folded: true, now: 0 }))).toEqual([expect.stringMatching(/^결제 웹훅 재시도 정리 ▾/), '결제 실패 알림이 고객에게 한 번만 가게'])
  })

  test('every row fits a narrow terminal', () => {
    for (const r of text(bandRows(s, working, { width: 30, maxRows: 10, folded: false, now: 0 }))) expect(cells(r)).toBeLessThanOrEqual(30)
  })
})

describe('the note for a person coming back', () => {
  test('says how the latest chapter ended, its receipts and what waits on the person, framed down the left', () => {
    expect(text(awayRows(s, 60))).toEqual(['╭ 자리 비운 동안', '│ · 코멘트 3개 반영, CI 통과', '│ ↗ PR #142 머지됨', '│ ◐ 스테이징에서 결제 한 건 확인', '╰ 입력하면 평소 판으로 돌아가요'])
  })
  test('sits above the band, which keeps the rows left', () => {
    const rows = text(bandStack(s, idle, { width: 60, maxRows: 10, folded: false, now: 0, away: true }))
    expect(rows[0]).toBe('╭ 자리 비운 동안')
    expect(rows[5]).toMatch(/^결제 웹훅 재시도 정리 ▴/)
    expect(rows).toHaveLength(10)
  })
})

describe('the drawer', () => {
  test('lists every chapter with its request, result and links, your turn gathered at the top, and everything left under the latest', () => {
    const rows = text(drawerRows(s, idle, { width: 60, now: 0 }))
    expect(rows[2]).toBe('◐ 내 차례 1: 스테이징에서 결제 한 건 확인')
    for (const c of ['1 ✓ 중복 알림 원인 찾기', '2 ✓ 재시도 큐 교체', '3 ◐ 리뷰 코멘트 반영']) expect(rows).toContain(c)
    expect(rows).toContain('  요청  알림이 두 번 간대')
    expect(rows).toContain('  결과  재시도가 두 번 등록됨')
    expect(rows).toContain('  ↗ PR #142')
    expect(rows.slice(-11)).toEqual([
      '  ↗ PR #142 머지됨',
      '  내 차례',
      '  ◐ 스테이징에서 결제 한 건 확인',
      '  Claude가 이어서 할 일',
      '  ○ 확인되면 머지',
      '  다른 사람을 기다림',
      '  ○ 리뷰어의 재검토',
      '  선택 사항',
      '  · 로그 형식 정리',
      '  Claude가 확인하지 못한 것',
      '  ? 부하는 재 보지 못함',
    ])
  })

  test('links and receipts open on press', () => {
    const links = drawerRows(s, idle, { width: 60, now: 0 }).flatMap(r => r.line.filter(x => x.href !== undefined).map(x => [x.text, x.href]))
    expect(links).toEqual([
      ['↗ PR #142', PR],
      ['↗ PR #142 머지됨', PR],
    ])
  })

  test('a long request wraps under its own start', () => {
    const long: Shown = { ...s, board: { ...BOARD, chapters: [{ ...(BOARD.chapters[0] as Board['chapters'][number]), request: '결제 실패 알림이 고객에게 두 번씩 간다는 제보가 들어왔으니 원인을 찾아줘' }] } }
    const rows = text(drawerRows(long, idle, { width: 30, now: 0 }))
    const at = rows.findIndex(r => r.startsWith('  요청  '))
    expect(rows[at + 1]).toMatch(/^ {8}\S/)
  })

  test('the head carries ↻ at its right edge', () => {
    const head = drawerRows(s, idle, { width: 60, now: 0 })[0]
    expect(head?.line.at(-1)).toMatchObject({ text: '↻', button: 'refresh' })
  })
})
