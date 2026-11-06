import { expect, test } from 'claude-code/testing'
import type { Activity, ActivityEvent } from './activity'
import { activityLabel, idleActivity, step } from './activity'
import { setLanguage } from './i18n'

// The expectations below are written in Korean.
setLanguage('ko')

const run = (...events: ActivityEvent[]): Activity => events.reduce(step, idleActivity())

test('a turn works, runs tools by id and settles back', () => {
  expect(activityLabel(idleActivity())).toBeUndefined()
  expect(activityLabel(run({ type: 'turnStart' }))).toBe('작업 중')
  const two = run({ type: 'turnStart' }, { type: 'toolStart', id: 'a', tool: 'Bash' }, { type: 'toolStart', id: 'b', tool: 'Read' })
  expect(activityLabel(two)).toBe('Read 실행 중')
  expect(activityLabel(step(two, { type: 'toolEnd', id: 'b' }))).toBe('Bash 실행 중')
  expect(activityLabel(step(step(two, { type: 'toolEnd', id: 'b' }), { type: 'toolEnd', id: 'a' }))).toBe('작업 중')
  // An end for a call never seen changes nothing.
  expect(step(two, { type: 'toolEnd', id: 'zzz' })).toEqual(two)
})

test('waiting on the person outranks running tools until it ends', () => {
  const asked = run({ type: 'turnStart' }, { type: 'toolStart', id: 'a', tool: 'Bash' }, { type: 'permissionAsk', tool: 'Bash' })
  expect(activityLabel(asked)).toBe('권한 기다리는 중: Bash')
  expect(activityLabel(step(asked, { type: 'toolStart', id: 'b', tool: 'Read' }))).toBe('권한 기다리는 중: Bash')
  expect(activityLabel(step(asked, { type: 'permissionEnd' }))).toBe('Bash 실행 중')
  const question = run({ type: 'turnStart' }, { type: 'questionOpen' })
  expect(activityLabel(question)).toBe('답변 기다리는 중')
  expect(activityLabel(step(question, { type: 'questionClose' }))).toBe('작업 중')
})

test('compaction shows while it runs', () => {
  const c = run({ type: 'turnStart' }, { type: 'compactStart' })
  expect(activityLabel(c)).toBe('대화 압축 중')
  expect(activityLabel(step(c, { type: 'compactEnd' }))).toBe('작업 중')
})

test('the end of a turn says how it ended and drops running calls', () => {
  const busy = run({ type: 'turnStart' }, { type: 'toolStart', id: 'a', tool: 'Bash' })
  expect(activityLabel(step(busy, { type: 'turnEnd', reason: 'answer' }))).toBeUndefined()
  expect(step(busy, { type: 'turnEnd', reason: 'answer' }).running).toEqual([])
  expect(activityLabel(step(busy, { type: 'turnEnd', reason: 'aborted' }))).toBe('중단됨')
  expect(activityLabel(step(busy, { type: 'failure', detail: 'rate limit' }))).toBe('오류: rate limit')
})

test('tool names from events are cleaned', () => {
  expect(activityLabel(run({ type: 'turnStart' }, { type: 'toolStart', id: 'a', tool: 'Ba\u001bsh' }))).toBe('Ba sh 실행 중')
})

test('a turn that ends with background work in flight says so, whichever of the two comes first, until the next turn', () => {
  const after = run({ type: 'turnStart' }, { type: 'turnEnd', reason: 'answer' }, { type: 'background', count: 2 })
  expect(activityLabel(after)).toBe('백그라운드 작업 2개 진행 중')
  const before = run({ type: 'turnStart' }, { type: 'background', count: 1 }, { type: 'turnEnd', reason: 'answer' })
  expect(activityLabel(before)).toBe('백그라운드 작업 1개 진행 중')
  expect(step(after, { type: 'turnStart' }).background).toBeUndefined()
  expect(run({ type: 'turnEnd', reason: 'answer' }, { type: 'background', count: 0 }).background).toBeUndefined()
})
