import { describe, expect, test } from 'claude-code/testing'
import type { Activity } from '../types'
import type { Board } from './chapters'
import { setLanguage } from './i18n'
import type { Lines } from './sessions'
import { DAY_MS, othersOf, sessionRows, stateOf } from './sessions'
import type { Row, Shown } from './view'
import { rowText } from './view'

// The expectations below are written in Korean.
setLanguage('ko')

const idle: Activity = { phase: 'idle', running: [] }
const chapter = (done: boolean, left: Board['chapters'][number]['left'] = []): Board['chapters'][number] => ({ request: 'r', title: 't', result: '', links: [], done, left, receipts: [] })
const shownWith = (c: Board['chapters'][number], o: Partial<Shown> = {}): Shown => ({ board: { title: '세션', goal: '', chapters: [c] }, asked: [], running: 0, ...o })
const text = (rows: readonly Row[]): string[] => rows.map(r => rowText(r).replace(/\s+$/, ''))

describe("a session's state", () => {
  test('an open dialog question or something left to the person is their turn, counted', () => {
    expect(stateOf(shownWith(chapter(false), { asked: ['몇 번?'] }), { phase: 'question', running: [] })).toEqual({ state: 'mine', mine: 1 })
    expect(stateOf(shownWith(chapter(true, [{ text: '확인', kind: 'mine' }, { text: '머지', kind: 'claude' }])), idle)).toEqual({ state: 'mine', mine: 1 })
  })
  test('a turn that ended with the chapter open is their turn too', () => {
    expect(stateOf(shownWith(chapter(false)), idle)).toEqual({ state: 'mine', mine: 0 })
  })
  test('a running turn or background work is working', () => {
    expect(stateOf(shownWith(chapter(false)), { phase: 'tool', tool: 'Bash', running: [] }).state).toBe('working')
    expect(stateOf(shownWith(chapter(false), { running: 1 }), idle).state).toBe('working')
    expect(stateOf(shownWith(chapter(true)), { ...idle, background: 2 }).state).toBe('working')
  })
  test('a done last chapter with nothing for the person is done; an interrupted turn is idle', () => {
    expect(stateOf(shownWith(chapter(true)), idle).state).toBe('done')
    expect(stateOf(shownWith(chapter(false)), { phase: 'interrupted', running: [] }).state).toBe('idle')
  })
})

describe('every other session', () => {
  const now = 10 * DAY_MS
  const all: Lines = {
    me: { title: '이 세션', state: 'mine', mine: 1, savedAt: now },
    a: { title: '끝난 일', state: 'done', mine: 0, savedAt: now - 60_000 },
    b: { title: '도는 일', state: 'working', mine: 0, savedAt: now - 120_000 },
    c: { title: '오래된 내 차례', state: 'mine', mine: 2, savedAt: now - 3 * 3_600_000 },
    d: { title: '새 내 차례', state: 'mine', mine: 1, savedAt: now - 30_000 },
    e: { title: '어제 일', state: 'mine', mine: 1, savedAt: now - DAY_MS - 1 },
    f: { title: '멈춘 일', state: 'idle', mine: 0, savedAt: now - 5 * 60_000 },
  }

  test('your turn first, then working, then the rest, newest first within each; this session and lines older than a day left out', () => {
    expect(othersOf(all, 'me', now).map(l => l.title)).toEqual(['새 내 차례', '오래된 내 차례', '도는 일', '끝난 일', '멈춘 일'])
  })

  test('the drawer section draws a mark, the title and how long ago it changed', () => {
    expect(text(sessionRows(othersOf(all, 'me', now), now, 40)).slice(1)).toEqual([
      '모든 세션',
      '◐ 새 내 차례  방금',
      '◐ 오래된 내 차례  3시간 전',
      '● 도는 일  2분 전',
      '✓ 끝난 일  1분 전',
      '○ 멈춘 일  5분 전',
    ])
  })

  test('a long title is cut, the time kept', () => {
    const rows = text(sessionRows([{ title: '아주 긴 세션 제목이 여기 있어요 정말 길어요', state: 'done', mine: 0, savedAt: now - 60_000 }], now, 20))
    expect(rows.at(-1)).toMatch(/…  1분 전$/)
  })

  test('with no other session there is no section', () => {
    expect(sessionRows(othersOf({ me: all.me as Lines[string] }, 'me', now), now, 40)).toEqual([])
  })
})
