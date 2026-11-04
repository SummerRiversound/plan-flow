import { expect, test } from 'claude-code/testing'
import { shots, shotText } from './snapshot'
import { SNAPSHOTS } from './snapshots.data'
import { cells } from './width'

// A failure here means a view changed: look at it on the preview page
// (bun scripts/preview.ts), and if it is right, rewrite the file (bun scripts/snapshots.ts).
test('every scenario draws as its snapshot', () => {
  const all = shots()
  expect(all.map(s => s.key).sort()).toEqual(Object.keys(SNAPSHOTS).sort())
  for (const s of all) expect(`${s.key}\n${shotText(s)}`).toBe(`${s.key}\n${SNAPSHOTS[s.key]}`)
})

test('no snapshot is wider or taller than its view', () => {
  for (const s of shots()) {
    for (const l of shotText(s).split('\n')) expect(cells(l)).toBeLessThanOrEqual(s.width)
    if (s.rows !== undefined) expect(s.lines.length).toBeLessThanOrEqual(s.rows)
  }
})
