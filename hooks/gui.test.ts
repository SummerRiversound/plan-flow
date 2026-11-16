import { expect, test } from 'claude-code/testing'
import { spinSvg } from './gui'

test('the turning mark carries on from where the clock stands instead of starting over', () => {
  expect(spinSvg(0)).toContain('begin="0.00s"')
  expect(spinSvg(400)).toContain('begin="-0.40s"')
})
