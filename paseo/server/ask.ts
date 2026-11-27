/// <reference types="node" />
import { spawnProcess, terminateProcess } from '@getpaseo/plugin/server'
import type { Ask } from './look'

// The small model the planner runs on, at low effort, as the mod's planner does.
const PLANNER_MODEL = 'claude-haiku-5-5'
// The design reads the whole session's log: a mid-size model, at low effort. Measured on two long
// recorded sessions: about 37K input tokens, $0.12 and 30-45 s a design.
const DESIGN_MODEL = 'claude-sonnet-5-5'
// A look given up on after this long; the call is killed, so it never answers late.
const LOOK_TIMEOUT_MS = 90_000
const DESIGN_TIMEOUT_MS = 120_000
// The printed JSON is the answer and a few counters; more than this is not a planner answer.
const MAX_OUTPUT = 4 * 1024 * 1024

// A one-shot Claude Code print with none of the person's setup (CLAUDE.md, settings, skills, plugins
// and hooks, MCP servers), no tools, and no saved session: the model reads the prompt and answers.
// A full Paseo agent per look measured about 175K input tokens and 7-15 s; this measured about 4.3K.
// The prompt itself goes on stdin.
export const plannerArgs = (system: string, model = PLANNER_MODEL): string[] => [
  '--print',
  '--safe-mode',
  // Safe mode still applies the settings' `language`, which would set the plan's language.
  '--setting-sources', '',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--tools', '',
  '--model', model,
  '--effort', 'low',
  '--output-format', 'json',
  '--system-prompt', system,
]

// What a print gave: its answer, what it cost, and the tokens it read and wrote.
export type Printed = { text: string; cost: number; input: number; output: number }

// The answer in a print's JSON and its counters, or null when the call failed or printed something else.
export const printedOf = (stdout: string): Printed | null => {
  let out: unknown
  try {
    out = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof out !== 'object' || out === null) return null
  const r = out as { is_error?: unknown; result?: unknown; total_cost_usd?: unknown; usage?: Record<string, unknown> }
  if (r.is_error !== false || typeof r.result !== 'string') return null
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0)
  const u = r.usage ?? {}

  return { text: r.result, cost: n(r.total_cost_usd), input: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens), output: n(u.output_tokens) }
}

export const answerOf = (stdout: string): string | null => printedOf(stdout)?.text ?? null

// shortcut: through the `claude` on the daemon's PATH, whatever the agent's provider; a daemon without Claude Code plans nothing.
const print = (cwd: string, args: string[], prompt: string, timeoutMs: number, env?: Record<string, string>): Promise<Printed | null> =>
  new Promise(resolve => {
    const child = spawnProcess('claude', args, { cwd, stdio: 'pipe', ...(env === undefined ? {} : { env: { ...process.env, ...env } }) })
    let out = ''
    const stop = (answer: Printed | null) => {
      clearTimeout(timer)
      resolve(answer)
    }
    const timer = setTimeout(() => {
      void terminateProcess(child)
      console.error('[plan-flow] model call timed out')
      stop(null)
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      if (out.length > MAX_OUTPUT) {
        void terminateProcess(child)
        stop(null)
      }
    })
    child.on('error', err => {
      console.error('[plan-flow] model call failed:', err.message)
      stop(null)
    })
    child.on('close', () => stop(printedOf(out)))
    child.stdin.end(prompt)
  })

export const claudeAsk =
  (cwd: string): Ask =>
  async (system, prompt) =>
    (await print(cwd, plannerArgs(system), prompt, LOOK_TIMEOUT_MS))?.text ?? null

// The design is asked once and its prompt differs every time, so a cache write would be paid and never read.
export const designAsk =
  (cwd: string) =>
  (system: string, prompt: string): Promise<Printed | null> =>
    print(cwd, plannerArgs(system, DESIGN_MODEL), prompt, DESIGN_TIMEOUT_MS, { DISABLE_PROMPT_CACHING: '1' })
