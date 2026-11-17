import { expect, test } from 'claude-code/testing'
import { joinSvg, progressSvg, spinSvg, splitSvg, trunkSvg } from './gui'
import { setLanguage } from './i18n'

// The expectations below are written in Korean.
setLanguage('ko')

test('the lines between cards: a trunk, a split to the middle of each card and a join back, wide pictures that scale to the drawer', () => {
  const trunk = trunkSvg()
  expect(trunk).toMatch(/^<svg [^>]*viewBox="0 0 1200 \d+"/)
  expect(trunk).toContain('M600 0 V')
  // Three cards side by side: their middles at 1/6, 3/6 and 5/6 of the width.
  const split = splitSvg(3)
  for (const x of [200, 600, 1000]) expect(split).toMatch(new RegExp(`[MH]${x}( |$|")`))
  expect(split).toContain('M600 0 V')
  const join = joinSvg(2)
  for (const x of [300, 900]) expect(join).toContain(`M${x} 0 V`)
  expect(join).toContain('M600 24 V48')
  // The stroke follows the viewer's light or dark scheme.
  expect(trunk).toContain('prefers-color-scheme:dark')
})

test('the progress bar fills one slot per step in plan order, green for done and plain for waiting on a check', () => {
  const svg = progressSvg(['done', 'done', 'check', 'todo'])
  expect(svg).toContain('class="d" x="0" y="0" width="600"')
  expect(svg).toContain('class="c" x="600" y="0" width="300"')
  expect(svg.match(/class="[dc]"/g)).toHaveLength(2)
})

test('the turning mark carries on from where the clock stands instead of starting over', () => {
  expect(spinSvg(0)).toContain('begin="0.00s"')
  expect(spinSvg(400)).toContain('begin="-0.40s"')
})
