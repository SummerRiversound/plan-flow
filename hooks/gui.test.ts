import { expect, test } from 'claude-code/testing'
import { CELL_PX, joinSvg, liveSvg, splitSvg, trunkSvg } from './gui'
import { setLanguage } from './i18n'

// The expectations below are written in Korean.
setLanguage('ko')

test('the running step as a picture: a turning mark and a moving band, sized to the title cells, escaped', () => {
  const svg = liveSvg('A<B & "C"', 9, 0)
  expect(svg.width).toBe(11 * CELL_PX)
  expect(svg.source.startsWith('<svg')).toBe(true)
  expect(svg.source).toContain('A&lt;B &amp; &quot;C&quot;')
  expect(svg.source).toContain('animateTransform')
  expect(svg.source).toContain('<animate ')
})

test('a picture rebuilt later carries on where the motion stands instead of starting over', () => {
  const begin = (now: number) => [...liveSvg('가', 2, now).source.matchAll(/begin="(-?[\d.]+)s"/g)].map(m => m[1])
  expect(begin(0)).toEqual(['0.00', '0.00'])
  expect(begin(1_250)).toEqual(['-1.25', '-0.25'])
})

test('the lines between cards: a trunk, a split to the middle of each card and a join back, wide pictures that scale to the drawer', () => {
  const trunk = trunkSvg()
  expect(trunk).toMatch(/^<svg [^>]*viewBox="0 0 1200 \d+"/)
  expect(trunk).toContain('M600 0 V')
  // Three cards side by side: their middles at 1/6, 3/6 and 5/6 of the width.
  const split = splitSvg(3, true)
  for (const x of [200, 600, 1000]) expect(split).toMatch(new RegExp(`[MH]${x}( |$|")`))
  expect(split).toContain('M600 0 V')
  expect(splitSvg(3, false)).not.toContain('M600 0 V')
  const join = joinSvg(2, true)
  for (const x of [300, 900]) expect(join).toContain(`M${x} 0 V`)
  expect(joinSvg(2, false)).not.toMatch(/M600 \d+ V\d+$/)
  // The stroke follows the viewer's light or dark scheme.
  expect(trunk).toContain('prefers-color-scheme:dark')
})
