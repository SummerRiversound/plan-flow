import { expect, test } from 'claude-code/testing'
import { pickLanguage, setLanguage } from './i18n'
import { shots, shotText } from './snapshot'
import { demoList, scenarios } from './scenarios'

test('the language is the option, else Claude Code language setting, else the locale, else English', () => {
  expect(pickLanguage('ko', 'English', 'en_US.UTF-8')).toBe('ko')
  expect(pickLanguage('auto', '한국어', 'en_US.UTF-8')).toBe('ko')
  expect(pickLanguage('auto', 'Korean', undefined)).toBe('ko')
  expect(pickLanguage('auto', undefined, 'ko_KR.UTF-8')).toBe('ko')
  expect(pickLanguage('auto', 'kotlin', 'C')).toBe('en')
  expect(pickLanguage(undefined, undefined, undefined)).toBe('en')
})

test('in English every view and demo reads without Hangul', () => {
  for (const s of shots().filter(x => x.language === 'en')) expect(`${s.key}\n${shotText(s)}`).not.toMatch(/[가-힣]/)
  setLanguage('en')
  try {
    expect(demoList()).not.toMatch(/[가-힣]/)
    for (const s of scenarios()) for (const f of s.frames) expect(f.label).not.toMatch(/[가-힣]/)
  } finally {
    setLanguage('ko')
  }
})
