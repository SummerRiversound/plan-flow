import { describe, expect, test } from 'claude-code/testing'
import { STATUS_PROMPT, parseStatus } from './status'

describe('the status block at the end of an answer', () => {
  test('done becomes the result, the other lines what is left by who moves next', () => {
    const answer = [
      '큐를 바꿨어요.',
      '<status>',
      'done: 재시도 큐를 교체했다',
      'mine: 스테이징에서 결제 한 건 확인',
      'mine: 재시도 횟수 정하기',
      'next: 확인되면 머지',
      'others: 리뷰어의 재검토',
      'unchecked: 부하',
      '</status>',
    ].join('\n')
    expect(parseStatus(answer)).toEqual({
      result: '재시도 큐를 교체했다',
      left: [
        { text: '스테이징에서 결제 한 건 확인', kind: 'mine' },
        { text: '재시도 횟수 정하기', kind: 'mine' },
        { text: '확인되면 머지', kind: 'claude' },
        { text: '리뷰어의 재검토', kind: 'others' },
        { text: '부하', kind: 'unverified' },
      ],
    })
  })

  test('items listed under a key as dashes count, empty and unknown lines do not, and the last block wins', () => {
    const answer = '<status>\ndone: old\n</status>\nmore\n<status>\nDone: 끝\nmine:\n- 하나\n- 둘\nnote: x\nnext: \n</status>'
    expect(parseStatus(answer)).toEqual({ result: '끝', left: [{ text: '하나', kind: 'mine' }, { text: '둘', kind: 'mine' }] })
  })

  test('an answer with no block has no status', () => {
    expect(parseStatus('했어요')).toBeUndefined()
    expect(parseStatus('<status>\n</status>')).toBeUndefined()
  })

  test('the request for the block names every line', () => {
    for (const key of ['<status>', 'done:', 'mine:', 'next:', 'others:', 'unchecked:', '</status>']) expect(STATUS_PROMPT).toContain(key)
  })
})
