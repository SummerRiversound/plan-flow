import { expect, test } from 'claude-code/testing'
import { spinSvg, sweepSvg } from './gui'

test('the turning mark carries on from where the clock stands instead of starting over', () => {
  expect(spinSvg(0)).toContain('begin="0.00s"')
  expect(spinSvg(400)).toContain('begin="-0.40s"')
})

test('the swept title carries on from where the clock stands, its words escaped, as wide as its cells', () => {
  const pic = sweepSvg('A < B & "C"', 11, 2500)
  expect(pic.source).toContain('begin="-0.50s"')
  expect(pic.source).toContain('A &lt; B &amp; &quot;C&quot;')
  expect(pic.width).toBeGreaterThan(11 * 6)
})
