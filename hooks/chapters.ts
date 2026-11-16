// The request-list board: one chapter per request the person sent, kept by a model that rereads the
// session now and then, and by rules in between. The rules add what is certain the moment it happens:
// a new chapter, a PR or release, an open dialog question, background work.

// What is left, by who moves next: the person, Claude, someone outside, nobody unless wanted, or
// something Claude says it did not check.
export type Kind = 'mine' | 'claude' | 'others' | 'optional' | 'unverified'
export type Item = { text: string; kind: Kind }
export type Receipt = { what: 'opened' | 'merged' | 'ready' | 'release'; ref: string; url?: string }
export type Chapter = { request: string; title: string; result: string; links: string[]; done: boolean; left: Item[]; receipts: Receipt[] }
export type Board = { title: string; goal: string; chapters: Chapter[] }

export type Heard =
  | { kind: 'request'; text: string }
  | { kind: 'receipt'; receipt: Receipt }
  | { kind: 'asked'; id: string; question: string }
  | { kind: 'answered'; id: string }
  | { kind: 'background'; id: string }
  | { kind: 'backgroundDone'; id: string }
  | { kind: 'status'; result: string; left: Item[] }

// `seq` counts everything heard; `since` holds what came after the rewrite `base` was written from.
// Open questions and background work are the session's, so they outlive a rewrite.
export type Kept = {
  base: Board
  cut: number
  seq: number
  since: Array<{ seq: number; heard: Heard }>
  asked: Array<{ id: string; question: string }>
  running: string[]
}

export const emptyBoard = (): Board => ({ title: '', goal: '', chapters: [] })
export const emptyKept = (): Kept => ({ base: emptyBoard(), cut: 0, seq: 0, since: [], asked: [], running: [] })

// A bare go-ahead or yes continues the chapter before; anything else the person asks starts one.
export const goAhead = (text: string): boolean =>
  /^\s*(ㄱ+|ㅇㅇ|ㅇㅋ|응+|웅|네+|예|ok(ay)?|go|고고|해|해줘|해봐|하자|좋아|그래|진행(해|해줘)?|이어서(해|해줘)?|계속(해|해줘)?)\s*[.!~]*\s*$/i.test(text)

const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/

// A PR opened, merged or marked ready, or a release, read off a Bash command that succeeded.
export const receiptOf = (command: string, output: string): Receipt | undefined => {
  const byRef = (what: 'merged' | 'ready'): Receipt | undefined => {
    const url = PR_URL.exec(command)
    const n = url?.[1] ?? new RegExp(`gh pr ${what === 'merged' ? 'merge' : 'ready'}\\s+(\\d+)`).exec(command)?.[1]
    return n === undefined ? undefined : { what, ref: `PR #${n}`, ...(url === null ? {} : { url: url[0] }) }
  }
  if (/\bgh pr create\b/.test(command)) {
    const url = PR_URL.exec(output)
    return url === null ? undefined : { what: 'opened', ref: `PR #${url[1]}`, url: url[0] }
  }
  if (/\bgh pr merge\b/.test(command)) return byRef('merged')
  if (/\bgh pr ready\b/.test(command)) return byRef('ready')
  const tag = /\bgh release create\s+([^\s-]\S*)/.exec(command)?.[1]
  return tag === undefined ? undefined : { what: 'release', ref: tag }
}

export const isBackground = (tool: string, input: Record<string, unknown>): boolean => tool === 'Workflow' || input.run_in_background === true

// The call a task notification says has ended.
export const backgroundDone = (notice: string): string | undefined =>
  notice.includes('<task-notification>') ? /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(notice)?.[1] : undefined

export const hear = (k: Kept, h: Heard): Kept => {
  const seq = k.seq + 1
  const next: Kept = { ...k, seq, since: [...k.since, { seq, heard: h }] }
  if (h.kind === 'asked') return { ...next, asked: [...k.asked, { id: h.id, question: h.question }] }
  if (h.kind === 'answered') return { ...next, asked: k.asked.filter(a => a.id !== h.id) }
  if (h.kind === 'background') return { ...next, running: [...k.running, h.id] }
  if (h.kind === 'backgroundDone') return { ...next, running: k.running.filter(id => id !== h.id) }
  return next
}

// A rewrite written from everything heard up to `cut`. One started earlier than the board's own is stale.
export const rewritten = (k: Kept, base: Board, cut: number): Kept =>
  cut < k.cut ? k : { ...k, base, cut, since: k.since.filter(s => s.seq > cut) }

const words = (text: string, n: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat
}

export const shown = (k: Kept): { board: Board; asked: string[]; running: number } => {
  const chapters = k.base.chapters.map(c => ({ ...c, receipts: [...c.receipts] }))
  for (const { heard: h } of k.since) {
    if (h.kind === 'request' && !(goAhead(h.text) && chapters.length > 0))
      chapters.push({ request: words(h.text, 200), title: words(h.text, 40), result: '', links: [], done: false, left: [], receipts: [] })
    if (h.kind === 'receipt') chapters.at(-1)?.receipts.push(h.receipt)
    const latest = chapters.at(-1)
    // The status block Claude ended its answer with (an opt-in experiment): everything left now.
    if (h.kind === 'status' && latest !== undefined) chapters[chapters.length - 1] = { ...latest, result: h.result === '' ? latest.result : h.result, left: h.left }
  }
  return { board: { ...k.base, chapters }, asked: k.asked.map(a => a.question), running: k.running.length }
}
