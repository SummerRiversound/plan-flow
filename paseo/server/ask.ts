/// <reference types="node" />
import { spawnProcess, terminateProcess } from '@getpaseo/plugin/server'
import type { Ask } from './look'

// The small model the planner runs on, at low effort, as the mod's planner does.
const PLANNER_MODEL = 'claude-haiku-5-5'
// A look given up on after this long; the call is killed, so it never answers late.
const LOOK_TIMEOUT_MS = 90_000
// The printed JSON is the answer and a few counters; more than this is not a planner answer.
const MAX_OUTPUT = 4 * 1024 * 1024

// A one-shot Claude Code print with none of the person's setup (CLAUDE.md, skills, plugins and hooks,
// MCP servers), no tools, and no saved session: the planner reads the board and the log, and answers.
// A full Paseo agent per look measured about 175K input tokens and 7-15 s; this measured about 4.3K.
// The prompt itself goes on stdin.
export const plannerArgs = (system: string): string[] => [
  '--print',
  '--safe-mode',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--tools', '',
  '--model', PLANNER_MODEL,
  '--effort', 'low',
  '--output-format', 'json',
  '--system-prompt', system,
]

// The answer in a print's JSON, or null when the call failed or printed something else.
export const answerOf = (stdout: string): string | null => {
  let out: unknown
  try {
    out = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof out !== 'object' || out === null) return null
  const r = out as { is_error?: unknown; result?: unknown }

  return r.is_error === false && typeof r.result === 'string' ? r.result : null
}

// shortcut: Claude only, through the `claude` on the daemon's PATH; other providers get their own call in the design milestone.
export const claudeAsk =
  (cwd: string): Ask =>
  (system, prompt) =>
    new Promise(resolve => {
      const child = spawnProcess('claude', plannerArgs(system), { cwd, stdio: 'pipe' })
      let out = ''
      const stop = (answer: string | null) => {
        clearTimeout(timer)
        resolve(answer)
      }
      const timer = setTimeout(() => {
        void terminateProcess(child)
        console.error('[plan-flow] planner call timed out')
        stop(null)
      }, LOOK_TIMEOUT_MS)
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString()
        if (out.length > MAX_OUTPUT) {
          void terminateProcess(child)
          stop(null)
        }
      })
      child.on('error', err => {
        console.error('[plan-flow] planner call failed:', err.message)
        stop(null)
      })
      child.on('close', () => stop(answerOf(out)))
      child.stdin.end(prompt)
    })
