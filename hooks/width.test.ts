import { expect, test } from 'claude-code/testing'
import { cells, fit, padLeft, padRight, wrap } from './width'

test('a Hangul syllable takes two cells, ASCII one', () => {
  expect(cells('abc')).toBe(3)
  expect(cells('로그인')).toBe(6)
  expect(cells('API 설계')).toBe(8)
  expect(cells('')).toBe(0)
})

test('box drawing and status marks take one cell', () => {
  expect(cells('╭─╮│✓●○▸▾▼∥◂┄')).toBe(13)
})

test('combining marks and zero-width joiners add nothing', () => {
  expect(cells('é')).toBe(1)
  expect(cells('a‍b')).toBe(2)
})

test('CJK, fullwidth forms and wide emoji take two cells', () => {
  expect(cells('漢字')).toBe(4)
  expect(cells('ＡＢ')).toBe(4)
  expect(cells('🚀')).toBe(2)
})

test('fit cuts by cells and marks the cut with an ellipsis', () => {
  expect(fit('로그인 기능 추가', 20)).toBe('로그인 기능 추가')
  expect(fit('로그인 기능 추가', 8)).toBe('로그인 …')
  expect(cells(fit('로그인 기능 추가', 8))).toBeLessThanOrEqual(8)
  // A wide character that would straddle the edge is dropped, not split.
  expect(fit('가나다', 5)).toBe('가나…')
  expect(fit('abc', 1)).toBe('…')
  expect(fit('abc', 0)).toBe('')
})

test('padding fills to an exact cell count', () => {
  expect(padRight('조사', 6)).toBe('조사  ')
  expect(padLeft('48초', 6)).toBe('  48초')
  expect(cells(padRight('비밀번호 확인', 20))).toBe(20)
  // Too long text is cut to fit first.
  expect(cells(padRight('비밀번호 확인', 6))).toBe(6)
})

test('wrap breaks at spaces by cells and ends the last row in an ellipsis', () => {
  expect(wrap('하나 둘 셋', 20, 2)).toEqual(['하나 둘 셋'])
  expect(wrap('비밀번호를 해시와 비교한다', 12, 2)).toEqual(['비밀번호를', '해시와 비교…'])
  expect(wrap('aaaa bbbb cccc', 9, 3)).toEqual(['aaaa bbbb', 'cccc'])
  expect(wrap('', 10, 2)).toEqual([])
})
