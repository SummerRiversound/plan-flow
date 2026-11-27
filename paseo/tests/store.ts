import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { emptyBoard } from '../shared/board'

// The store keeps its file under the home folder, so the test gives it a fresh one.
process.env.HOME = await mkdtemp(join(tmpdir(), 'plan-flow-store-'))
const { loadBoard, loadBoards, saveBoard } = await import('../server/store')

const titled = (title: string) => ({ ...emptyBoard(), plan: { ...emptyBoard().plan, title } })

test('two agents that end their turns at once both keep their boards, each with its workspace', async () => {
  await Promise.all([saveBoard('a', titled('A'), 1, 'w1'), saveBoard('b', titled('B'), 2, null)])

  const all = await loadBoards()
  assert.equal(all.a?.board.plan.title, 'A')
  assert.equal(all.a?.workspaceId, 'w1')
  assert.equal(all.b?.board.plan.title, 'B')
  assert.equal(all.b?.workspaceId, null)
  assert.equal((await loadBoard('c')).savedAt, null)
})
