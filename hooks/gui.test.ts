import { expect, test } from 'claude-code/testing'
import { CELL_PX, liveSvg } from './gui'
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
