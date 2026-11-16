import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'
import { parseBoard, storyOf, writerPrompt } from './writer'

const person = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const claude = (text: string, ...uses: Array<{ tool: string; input: Record<string, unknown>; isError?: true; text?: string }>): SessionMessage => ({
  role: 'assistant',
  text,
  toolUses: uses.map((u, i) => ({ tool_use_id: `t${i}`, ...u })),
})

describe('the session as the writer reads it', () => {
  test('requests, calls, what Claude said between them and its answer, oldest first', () => {
    const s = storyOf([
      person('결제 웹훅 재시도 정리해줘'),
      claude('큐부터 볼게요.', { tool: 'Bash', input: { command: 'rg retry', description: 'Find the retry code' } }),
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't0', text: 'x', isError: undefined } as never] },
      claude('재시도 큐를 바꿨어요.'),
    ])
    expect(s.split('\n')).toEqual(['- The person asked: 결제 웹훅 재시도 정리해줘', '- Claude said: 큐부터 볼게요.', '- Claude ran: Find the retry code', '- Claude answered: 재시도 큐를 바꿨어요.'])
  })
  test('a failed call is marked, and a notice is not taken for a request', () => {
    const s = storyOf([
      claude('', { tool: 'Bash', input: { command: 'gh pr merge 1' }, isError: true }),
      person('<task-notification><summary>Agent "review" completed</summary></task-notification>'),
    ])
    expect(s.split('\n')).toEqual(['- Claude ran: gh pr merge 1 (failed)', '- Claude was told: Agent "review" completed'])
  })
  test('a dialog question reads as Claude asking, with the answer once given', () => {
    const s = storyOf([claude('', { tool: 'AskUserQuestion', input: { questions: [{ question: '어느 쪽으로 갈까요?' }] }, text: 'A안' })])
    expect(s).toBe('- Claude asked the person in a choice dialog: 어느 쪽으로 갈까요? → the person answered: A안')
  })
  test('command output and local commands are left out', () => {
    expect(storyOf([person('<command-name>/flow</command-name>'), person('<local-command-stdout>ok</local-command-stdout>')])).toBe('')
  })
  test('a long session keeps its newest lines within the limit', () => {
    const s = storyOf([person('오래된 요청'), ...Array.from({ length: 50 }, (_, i) => claude(`답 ${i} ${'가'.repeat(600)}`))], 2_000)
    expect(s.includes('오래된 요청')).toBe(false)
    expect(s.includes('답 49')).toBe(true)
    expect(s.length).toBeLessThan(2_000 + 700)
  })
})

describe('the writer prompt asks for every kind of what is left', () => {
  test('the five kinds, each by name', () => {
    const p = writerPrompt('- The person asked: x')
    for (const kind of ['"mine"', '"claude"', '"others"', '"optional"', '"unverified"']) expect(p.includes(kind)).toBe(true)
  })
})

describe('the writer answer as a board', () => {
  test('chapters keep their fields, and what is left only under the last', () => {
    const b = parseBoard(
      'here: {"title":"결제 웹훅 재시도","goal":"알림이 한 번만","chapters":[{"request":"a","title":"큐 교체","result":"교체함","links":["https://x"],"done":true,"left":[{"text":"x","kind":"mine"}]},{"request":"b","title":"리뷰 반영","result":"","done":false,"left":[{"text":"스테이징 확인","kind":"mine"},{"text":"재검토","kind":"others"},{"text":"??","kind":"weird"}]}]}',
    )
    expect(b?.title).toBe('결제 웹훅 재시도')
    expect(b?.chapters.map(c => [c.title, c.done, c.left.length])).toEqual([
      ['큐 교체', true, 0],
      ['리뷰 반영', false, 2],
    ])
    expect(b?.chapters[1]?.left).toEqual([
      { text: '스테이징 확인', kind: 'mine' },
      { text: '재검토', kind: 'others' },
    ])
  })
  test('an answer that is not a board is no board', () => {
    expect(parseBoard('sorry')).toBeUndefined()
    expect(parseBoard('{"title":"x"}')).toBeUndefined()
  })
})
