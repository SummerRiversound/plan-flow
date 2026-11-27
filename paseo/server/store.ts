/// <reference types="node" />
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { emptyBoard } from '../shared/board'
import type { Board } from '../shared/types'
import type { DesignState } from './turn'

// Where Paseo plugins keep their own files on the daemon host.
const DIR = join(homedir(), '.paseo', 'plugin-data', 'plan-flow')
const FILE = join(DIR, 'boards.json')
// The newest boards kept; an agent past this many starts from an empty board.
const KEPT = 50

// `workspaceId` lets a workspace's sidebar row find its agents' boards; null when Paseo gave none.
// `design`: where the agent's designs stand, and the plugin's model calls for it.
export type SavedBoard = { board: Board; savedAt: number; workspaceId?: string | null; design?: DesignState }
type Saved = Record<string, SavedBoard>

const readAll = async (): Promise<Saved> => {
  try {
    return JSON.parse(await readFile(FILE, 'utf8')) as Saved
  } catch {
    return {}
  }
}

export const loadBoard = async (agentId: string): Promise<{ board: Board; savedAt: number | null; design?: DesignState }> => {
  const saved = (await readAll())[agentId]
  return saved === undefined ? { board: emptyBoard(), savedAt: null } : saved
}

// Every saved board by agent id.
export const loadBoards = (): Promise<Readonly<Saved>> => readAll()

// Saves run one after another: two agents ending their turns at once would otherwise both read
// the file, and the second write would drop the first one's board.
let writing: Promise<unknown> = Promise.resolve()

export const saveBoard = (agentId: string, board: Board, now: number, workspaceId: string | null, design?: DesignState): Promise<void> => {
  const next = writing.then(() => write(agentId, { board, savedAt: now, workspaceId, ...(design === undefined ? {} : { design }) }))
  writing = next.catch(() => undefined)
  return next
}

// Written to a temporary file and renamed over the old one, so a crash mid-write never leaves half a file.
const write = async (agentId: string, entry: SavedBoard): Promise<void> => {
  const all = { ...(await readAll()), [agentId]: entry }
  const newest = Object.fromEntries(Object.entries(all).sort(([, a], [, b]) => b.savedAt - a.savedAt).slice(0, KEPT))
  await mkdir(DIR, { recursive: true })
  const tmp = `${FILE}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(newest))
  await rename(tmp, FILE)
}
