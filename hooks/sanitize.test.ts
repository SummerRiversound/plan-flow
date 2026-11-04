import { expect, test } from 'claude-code/testing'
import { clean } from './sanitize'

test('control characters, escape sequences and newlines become single spaces', () => {
  expect(clean('a\u001b[31mb')).toBe('a [31mb')
  expect(clean('one\ntwo\t\tthree')).toBe('one two three')
  expect(clean('\u0085x\u009b')).toBe('x')
})

test('bidi overrides and zero-width characters are dropped', () => {
  expect(clean('ab‮cd​ef﻿')).toBe('abcdef')
  expect(clean('⁦x⁩')).toBe('x')
})

test('Hangul and ordinary text pass through trimmed', () => {
  expect(clean('  로그인 기능 추가  ')).toBe('로그인 기능 추가')
})
