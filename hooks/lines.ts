// A session's happenings in one line each: a tool call by what it is for, a notice by its summary.

const MAX_LINE = 160
// A command with no description says nothing of its purpose, and its words (a prompt sent to another
// session, a message's text) read like a request; a short cut keeps what it runs, not what it carries.
const MAX_COMMAND = 80

const cut = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}
const base = (p: unknown): string => (typeof p === 'string' ? (p.split('/').pop() ?? p) : '')

// A tool call in one line: what it is for where the call says so, else what it touches.
export const toolLine = (tool: string, input: Record<string, unknown>): string => {
  const said = typeof input.description === 'string' ? input.description : ''
  if (tool === 'Bash') return said !== '' ? cut(said, MAX_LINE) : cut(String(input.command ?? ''), MAX_COMMAND)
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read'].includes(tool)) return cut(`${tool} ${base(input.file_path ?? input.notebook_path)}`, MAX_LINE)
  if (said !== '') return cut(`${tool}: ${said}`, MAX_LINE)
  if (typeof input.pattern === 'string') return cut(`${tool} ${input.pattern}`, MAX_LINE)
  // A connected tool has no description of its own: its short fields say what the call did.
  const name = tool.replace(/^mcp__.*__/, '')
  const fields = QUIET.has(tool) ? '' : hint(input, 0)

  return fields === '' ? name : cut(`${name}: ${fields}`, MAX_HINT)
}

// Tools whose input says nothing of the work.
const QUIET: ReadonlySet<string> = new Set(['ToolSearch'])
const MAX_HINT = 120
// A field longer than this is content (a message, a script, a page), not what the call is for.
const MAX_FIELD = 60
const NOT_TELLING = /(^|_)(ids?|ur[il]|path)$|Ids?$/
const hint = (v: unknown, depth: number): string => {
  if (typeof v === 'string') return v.length <= MAX_FIELD ? v.replace(/\s+/g, ' ').trim() : ''
  if (typeof v !== 'object' || v === null || depth > 2) return ''
  if (Array.isArray(v)) return v.slice(0, 3).map(x => hint(x, depth + 1)).filter(s => s !== '').join('; ')

  return Object.entries(v)
    .filter(([k]) => !NOT_TELLING.test(k))
    .map(([k, x]) => [k, hint(x, depth + 1)] as const)
    .filter(([, s]) => s !== '')
    .map(([k, s]) => `${k} ${s}`)
    .join(', ')
}

// Where a prompt comes from when the person sent it; the rest (a task's notice, another session) is news, not a request.
export const PERSON: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk', 'scheduled-trigger', 'channel'])

// A notice in one line: a task notification's summary where it has one.
export const noticeLine = (text: string): string => /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1] ?? text
