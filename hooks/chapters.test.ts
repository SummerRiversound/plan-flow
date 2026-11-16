import { describe, expect, test } from 'claude-code/testing'
import type { Board, Kept } from './chapters'
import { backgroundDone, emptyKept, goAhead, hear, isBackground, receiptOf, rewritten, shown } from './chapters'

const board = (titles: string[]): Board => ({
  title: '결제 웹훅 재시도',
  goal: '결제 실패 알림이 한 번만 가게',
  chapters: titles.map(title => ({ request: title, title, result: `${title} 끝`, links: [], done: true, left: [], receipts: [] })),
})
const heardAll = (k: Kept, ...hs: Parameters<typeof hear>[1][]): Kept => hs.reduce(hear, k)

describe('a request continues the chapter before only when it is a bare go-ahead', () => {
  for (const text of ['ㄱㄱ', '응', 'ㅇㅇ', '해', '진행해', 'ok', '이어서해 ', '해봐']) test(`${text} continues`, () => expect(goAhead(text)).toBe(true))
  for (const text of ['릴리즈까지해', '응 추천방향으로 하는데, 탭 제목은?', '이 PR 리뷰해']) test(`${text} starts a chapter`, () => expect(goAhead(text)).toBe(false))
})

describe('what a command produced is read off its output', () => {
  test('an opened PR takes its number and link from the output', () => {
    expect(receiptOf('gh pr create --title x', 'https://github.com/o/r/pull/12\n')).toEqual({ what: 'opened', ref: 'PR #12', url: 'https://github.com/o/r/pull/12' })
  })
  test('a merge and a ready by number, a release by tag', () => {
    expect(receiptOf('gh pr merge 12 --squash', '')).toEqual({ what: 'merged', ref: 'PR #12' })
    expect(receiptOf('gh pr ready 12', '')).toEqual({ what: 'ready', ref: 'PR #12' })
    expect(receiptOf('gh release create v1.2.0 --notes x', '')).toEqual({ what: 'release', ref: 'v1.2.0' })
  })
  test('a merge by link keeps the link', () => {
    expect(receiptOf('gh pr merge https://github.com/o/r/pull/7 --squash', '')).toEqual({ what: 'merged', ref: 'PR #7', url: 'https://github.com/o/r/pull/7' })
  })
  test('any other command produces nothing', () => {
    expect(receiptOf('gh pr view 12', '')).toBeUndefined()
    expect(receiptOf('gh pr create', 'could not create')).toBeUndefined()
  })
})

describe('background work', () => {
  test('a call set to run in the background, or a workflow, is background work', () => {
    expect(isBackground('Bash', { command: 'x', run_in_background: true })).toBe(true)
    expect(isBackground('Agent', { prompt: 'x', run_in_background: true })).toBe(true)
    expect(isBackground('Workflow', { script: 'x' })).toBe(true)
    expect(isBackground('Bash', { command: 'x' })).toBe(false)
  })
  test('a task notification names the call it ends', () => {
    expect(backgroundDone('<task-notification><tool-use-id>toolu_1</tool-use-id><status>completed</status></task-notification>')).toBe('toolu_1')
    expect(backgroundDone('just a note')).toBeUndefined()
  })
})

describe('the board the rules keep between rewrites', () => {
  test('a request that is not a go-ahead starts a chapter named by its words', () => {
    const s = shown(heardAll(emptyKept(), { kind: 'request', text: '결제 웹훅 재시도 정리해줘' }, { kind: 'request', text: 'ㄱㄱ' }))
    expect(s.board.chapters.map(c => [c.title, c.done])).toEqual([['결제 웹훅 재시도 정리해줘', false]])
  })
  test('a receipt goes to the latest chapter', () => {
    const k = heardAll(emptyKept(), { kind: 'request', text: '재시도 큐 교체' }, { kind: 'receipt', receipt: { what: 'opened', ref: 'PR #142' } })
    expect(shown(k).board.chapters[0]?.receipts).toEqual([{ what: 'opened', ref: 'PR #142' }])
  })
  test('an open question waits on the person until it is answered', () => {
    const k = heardAll(emptyKept(), { kind: 'asked', id: 'q', question: '어느 쪽으로 갈까요?' })
    expect(shown(k).asked).toEqual(['어느 쪽으로 갈까요?'])
    expect(shown(hear(k, { kind: 'answered', id: 'q' })).asked).toEqual([])
  })
  test('background work runs until its notice', () => {
    const k = heardAll(emptyKept(), { kind: 'background', id: 'a' }, { kind: 'background', id: 'b' }, { kind: 'backgroundDone', id: 'a' })
    expect(shown(k).running).toBe(1)
  })
})

describe('a rewrite lands on the board', () => {
  test('what was heard after the rewrite started still shows on top of it', () => {
    const k = heardAll(emptyKept(), { kind: 'request', text: '재시도 큐 교체' })
    const startedAt = k.seq
    const later = hear(k, { kind: 'request', text: '리뷰 코멘트 반영' })
    const s = shown(rewritten(later, board(['재시도 큐 교체']), startedAt)).board
    expect(s.chapters.map(c => c.title)).toEqual(['재시도 큐 교체', '리뷰 코멘트 반영'])
    expect(s.title).toBe('결제 웹훅 재시도')
  })
  test('what was heard before it is left to the rewrite', () => {
    const k = heardAll(emptyKept(), { kind: 'request', text: '재시도 큐 교체' }, { kind: 'receipt', receipt: { what: 'opened', ref: 'PR #142' } })
    expect(shown(rewritten(k, board(['재시도 큐 교체']), k.seq)).board.chapters[0]?.receipts).toEqual([])
  })
  test('an older rewrite landing after a newer one is dropped', () => {
    const k = heardAll(emptyKept(), { kind: 'request', text: '하나' }, { kind: 'request', text: '둘' })
    const newer = rewritten(k, board(['하나', '둘']), 2)
    expect(rewritten(newer, board(['하나']), 1)).toBe(newer)
  })
  test('open questions and background work outlive a rewrite', () => {
    const k = heardAll(emptyKept(), { kind: 'asked', id: 'q', question: '어느 쪽?' }, { kind: 'background', id: 'a' })
    const s = shown(rewritten(k, board(['하나']), k.seq))
    expect([s.asked, s.running]).toEqual([['어느 쪽?'], 1])
  })
})
