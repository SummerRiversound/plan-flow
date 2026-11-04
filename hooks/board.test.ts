import { expect, test } from 'claude-code/testing'
import type { Board, BoardResult } from './board'
import { cancelBoard, emptyBoard, MAX_SHELF, resumeBoard, setBoard, settle } from './board'
import { nextStep, updateNodes } from './plan'
import { setLanguage } from './i18n'

// The expectations below are written in Korean.
setLanguage('ko')

const ok = (r: BoardResult): Board => {
  if ('error' in r) throw new Error(r.error)

  return r.board
}
const fails = (r: BoardResult): string => ('error' in r ? r.error : 'no error')
const login = (): Board => ok(setBoard(emptyBoard(), '로그인', [{ title: '화면' }, { title: 'API' }], undefined, 0))

test('a different plan over open work must say whether the old one is parked or cancelled', () => {
  const b = login()
  expect(fails(setBoard(b, '버그', [{ title: '재현' }], undefined, 1))).toContain('previous "park"')
  expect(ok(setBoard(b, '로그인', [{ title: '화면' }, { title: 'API' }, { title: '문서' }], undefined, 1)).plan.nodes).toHaveLength(3)
})

test('parking sets the plan aside, and it comes back when the detour is finished', () => {
  const parked = setBoard(login(), '버그', [{ title: '재현' }], 'park', 1)
  expect('notice' in parked && parked.notice).toBe('"로그인" 보관 · "버그" 시작')
  let b = ok(parked)
  expect(b.shelf.map(s => [s.plan.title, s.state])).toEqual([['로그인', 'parked']])
  b = ok(settle(b, nextStep(b.plan, undefined, 2), 2))
  expect(b.plan.title).toBe('버그')
  const back = settle(b, nextStep(b.plan, undefined, 3), 3)
  expect('notice' in back && back.notice).toBe('"버그" 완료 · "로그인"(으)로 돌아왔어요')
  b = ok(back)
  expect(b.plan.title).toBe('로그인')
  expect(b.shelf.map(s => [s.plan.title, s.state])).toEqual([['버그', 'done']])
})

test('starting over keeps the cancelled plan on the shelf', () => {
  const b = ok(setBoard(login(), '로그인 v2', [{ title: '설계' }], 'cancel', 1))
  expect(b.shelf[0]?.state).toBe('cancelled')
  expect(ok(resumeBoard(b, '로그인', 'cancel', 2)).plan.title).toBe('로그인')
})

test('a finished plan gives way without being asked', () => {
  let b = login()
  b = ok(settle(b, updateNodes(b.plan, [{ id: '1', status: 'completed' }, { id: '2', status: 'completed' }], 1), 1))
  b = ok(setBoard(b, '문서', [{ title: '정리' }], undefined, 2))
  expect(b.shelf[0]?.state).toBe('done')
})

test('resume takes the newest parked plan, or one by title, and refuses an unknown one', () => {
  let b = ok(setBoard(login(), '버그', [{ title: '재현' }], 'park', 1))
  b = ok(resumeBoard(b, undefined, 'park', 2))
  expect(b.plan.title).toBe('로그인')
  expect(b.shelf.map(s => s.plan.title)).toEqual(['버그'])
  expect(fails(resumeBoard(b, '없는 계획', 'park', 3))).toContain('"버그"')
})

test('cancel drops the plan in hand and brings the newest parked one back', () => {
  let b = ok(setBoard(login(), '버그', [{ title: '재현' }], 'park', 1))
  b = ok(cancelBoard(b, 2))
  expect(b.plan.title).toBe('로그인')
  expect(b.shelf.map(s => [s.plan.title, s.state])).toEqual([['버그', 'cancelled']])
  expect(ok(cancelBoard(b, 3)).plan.nodes).toHaveLength(0)
})

test('the shelf keeps parked plans before ended ones', () => {
  let b = login()
  for (let i = 0; i < MAX_SHELF + 3; i++) b = ok(setBoard(b, `일 ${i}`, [{ title: 'x' }], i === 0 ? 'park' : 'cancel', i))
  expect(b.shelf).toHaveLength(MAX_SHELF)
  expect(b.shelf.some(s => s.plan.title === '로그인' && s.state === 'parked')).toBe(true)
})
