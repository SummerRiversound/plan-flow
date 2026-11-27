/// <reference types="node" />
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { emptyBoard } from '../shared/board'
import type { Board } from '../shared/types'

// Where Paseo plugins keep their own files on the daemon host.
const DIR = join(homedir(), '.paseo', 'plugin-data', 'plan-flow')
const FILE = join(DIR, 'boards.json')
// The newest boards kept; an agent past this many starts from an empty board.
const KEPT = 50

type Saved = Record<string, { board: Board; savedAt: number }>

const readAll = async (): Promise<Saved> => {
  try {
    return JSON.parse(await readFile(FILE, 'utf8')) as Saved
  } catch {
    return {}
  }
}

export const loadBoard = async (agentId: string): Promise<{ board: Board; savedAt: number | null }> => {
  const saved = (await readAll())[agentId]
  return saved === undefined ? { board: emptyBoard(), savedAt: null } : saved
}

// Written to a temporary file and renamed over the old one, so a crash mid-write never leaves half a file.
export const saveBoard = async (agentId: string, board: Board, now: number): Promise<void> => {
  const all = { ...(await readAll()), [agentId]: { board, savedAt: now } }
  const newest = Object.fromEntries(Object.entries(all).sort(([, a], [, b]) => b.savedAt - a.savedAt).slice(0, KEPT))
  await mkdir(DIR, { recursive: true })
  const tmp = `${FILE}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(newest))
  await rename(tmp, FILE)
}
