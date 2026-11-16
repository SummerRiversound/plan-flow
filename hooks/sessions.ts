// Every session's state in one line, kept in the store all sessions share, and the drawer's
// section that lists the other sessions from it. Pure: register.tsx writes and reads the store.
import type { Activity } from '../types'
import { t } from './i18n'
import type { Line, Row, Shown } from './view'
import { WAIT_COLOR, isLive, mineOf } from './view'
import { cells, fit } from './width'

// `mine`: something waits on the person; `working`: a turn or background work runs; `done`: the last
// chapter is done with nothing for the person; `idle`: anything else (an interrupted turn, an error).
export type State = 'mine' | 'working' | 'done' | 'idle'
// `mine` counts what waits on the person; `savedAt` is when the line last changed.
export type SessionLine = { title: string; state: State; mine: number; savedAt: number }
export type Lines = Record<string, SessionLine>

export const DAY_MS = 24 * 3_600_000

export const stateOf = (s: Shown, a: Activity): { state: State; mine: number } => {
  const mine = mineOf(s).length
  const last = s.board.chapters.at(-1)
  const waiting = a.phase === 'question' || a.phase === 'permission'
  const busy = isLive(a) || s.running > 0 || (a.background ?? 0) > 0
  // A turn that ended with the latest chapter open waits on the person to say what next.
  const state: State = mine > 0 || waiting ? 'mine' : busy ? 'working' : last?.done === true ? 'done' : a.phase === 'idle' && last !== undefined ? 'mine' : 'idle'

  return { state, mine }
}

const RANK: Record<State, number> = { mine: 0, working: 1, done: 2, idle: 2 }

// The other sessions, your turn first, then working, then the rest, newest first within each;
// lines older than a day are left out.
export const othersOf = (all: Lines, me: string, now: number): SessionLine[] =>
  Object.entries(all)
    .filter(([id, l]) => id !== me && l.title !== '' && now - l.savedAt <= DAY_MS)
    .map(([, l]) => l)
    .sort((a, b) => RANK[a.state] - RANK[b.state] || b.savedAt - a.savedAt)

const MARK: Record<State, { text: string; color: string }> = {
  mine: { text: '◐', color: WAIT_COLOR },
  working: { text: '●', color: 'text' },
  done: { text: '✓', color: 'success' },
  idle: { text: '○', color: 'inactive' },
}

// The drawer's section: a rule, its heading, then a row per session, the title cut before the time is.
export const sessionRows = (others: readonly SessionLine[], now: number, w: number | undefined): Row[] => {
  if (others.length === 0) return []
  const line = (l: SessionLine): Line => {
    const ago = `  ${t().ago(now - l.savedAt)}`
    return [
      { text: `${MARK[l.state].text} `, color: MARK[l.state].color },
      { text: w === undefined ? l.title : fit(l.title, Math.max(1, w - 2 - cells(ago))), color: 'text' },
      { text: ago, color: 'inactive' },
    ]
  }

  return [
    { kind: 'rule', indent: 0, line: [{ text: '┄'.repeat(w ?? 1), color: 'inactive' }] },
    { kind: 'heading', indent: 0, line: [{ text: t().sessions, bold: true, color: 'text' }] },
    ...others.map((l): Row => ({ kind: 'item', indent: 0, line: line(l) })),
  ]
}
