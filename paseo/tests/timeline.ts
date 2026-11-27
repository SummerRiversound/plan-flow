import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentTimelineItem } from '@getpaseo/protocol/agent-types'
import { happenedFrom } from '../server/timeline'

// Shapes as `paseo agent logs <id> --json` prints them for a Claude agent on Paseo 0.17.5.
const shell = (command: string, status: 'completed' | 'failed' = 'completed'): AgentTimelineItem => ({
  type: 'tool_call', callId: `c-${command}`, name: 'Bash', detail: { type: 'shell', command, output: '' }, status, error: status === 'failed' ? 'exit 1' : null,
}) as AgentTimelineItem

test('a turn reads back as what the planner hears: the request, calls with failures marked, words between calls and the answer', () => {
  const turn: AgentTimelineItem[] = [
    { type: 'user_message', text: 'Add a dark theme' },
    { type: 'reasoning', text: 'thinking it over' },
    { type: 'assistant_message', text: 'Reading the theme file first.' },
    { type: 'tool_call', callId: 'r1', name: 'Read', detail: { type: 'read', filePath: '/repo/src/theme.ts' }, status: 'completed', error: null },
    { type: 'tool_call', callId: 'e1', name: 'Edit', detail: { type: 'edit', filePath: '/repo/src/theme.ts', oldString: 'a', newString: 'b' }, status: 'completed', error: null },
    shell('npm test', 'failed'),
    { type: 'assistant_message', text: 'The dark theme is in; one test still fails.' },
  ]

  assert.deepEqual(happenedFrom(turn), [
    { kind: 'request', text: 'Add a dark theme' },
    { kind: 'said', text: 'Reading the theme file first.' },
    { kind: 'tool', text: 'Read theme.ts' },
    { kind: 'tool', text: 'Edit theme.ts' },
    { kind: 'tool', text: 'npm test (failed)' },
    { kind: 'answer', text: 'The dark theme is in; one test still fails.' },
  ])
})

test('calls still running or cancelled, tool searches and questions are left out; a task notice is news, not a call', () => {
  const turn: AgentTimelineItem[] = [
    shell('npm run build'),
    { ...(shell('sleep 60') as object), status: 'running', error: null } as AgentTimelineItem,
    { ...(shell('rm -rf dist') as object), status: 'canceled', error: null } as AgentTimelineItem,
    { type: 'tool_call', callId: 's1', name: 'ToolSearch', detail: { type: 'unknown', input: { query: 'select:Monitor' }, output: null }, status: 'completed', error: null },
    { type: 'tool_call', callId: 'q1', name: 'AskUserQuestion', detail: { type: 'unknown', input: { questions: [] }, output: null }, status: 'completed', error: null },
    { type: 'tool_call', callId: 'n1', name: 'task_notification', detail: { type: 'plain_text', label: 'Build finished', text: 'Build finished' }, metadata: { synthetic: true }, status: 'completed', error: null },
  ]

  assert.deepEqual(happenedFrom(turn), [
    { kind: 'tool', text: 'npm run build' },
    { kind: 'notice', text: 'Build finished' },
  ])
})

test('a message another agent sent is news, as the mod hears a prompt no person typed', () => {
  const turn: AgentTimelineItem[] = [
    {
      type: 'tool_call', callId: 'paseo-agent-message:1', name: 'agent_message', status: 'completed', error: null,
      agentMessage: { event: 'message', sender: { id: 'a-1', title: 'Main' }, text: 'Write the release notes' },
      detail: { type: 'plain_text', text: 'Write the release notes' },
    } as AgentTimelineItem,
    shell('git log --oneline'),
  ]

  assert.deepEqual(happenedFrom(turn), [
    { kind: 'notice', text: 'Write the release notes' },
    { kind: 'tool', text: 'git log --oneline' },
  ])
})

test('a subagent call, a search and a connected tool each read as one line', () => {
  const turn: AgentTimelineItem[] = [
    { type: 'tool_call', callId: 'a1', name: 'Agent', detail: { type: 'sub_agent', description: 'Review the diff' }, status: 'completed', error: null },
    { type: 'tool_call', callId: 'g1', name: 'Grep', detail: { type: 'search', query: 'darkTheme', toolName: 'grep' }, status: 'completed', error: null },
    { type: 'tool_call', callId: 'm1', name: 'mcp__github__create_issue', detail: { type: 'unknown', input: { title: 'Dark theme follow-up' }, output: null }, status: 'completed', error: null },
  ]

  assert.deepEqual(happenedFrom(turn), [
    { kind: 'tool', text: 'Agent: Review the diff' },
    { kind: 'tool', text: 'Grep darkTheme' },
    { kind: 'tool', text: 'create_issue: title Dark theme follow-up' },
  ])
})

test('for a design that reads no conversation, a call carries the start of what it gave back; a file it read or changed carries nothing', () => {
  const turn: AgentTimelineItem[] = [
    { type: 'user_message', text: 'Open the pull request' },
    { type: 'tool_call', callId: 'p1', name: 'Bash', detail: { type: 'shell', command: 'gh pr create', output: `${'x'.repeat(300)} https://github.com/acme/app/pull/12` }, status: 'completed', error: null },
    { type: 'tool_call', callId: 'a1', name: 'Agent', detail: { type: 'sub_agent', description: 'Review the diff', log: 'No blocking findings. Two nits.' }, status: 'completed', error: null },
    { type: 'tool_call', callId: 'r1', name: 'Read', detail: { type: 'read', filePath: '/repo/src/app.ts', content: 'secret file text' }, status: 'completed', error: null },
  ]

  const lines = happenedFrom(turn, true).map(h => h.text)
  assert.ok(lines[1]?.startsWith('gh pr create → '))
  assert.ok(lines[1]?.endsWith('https://github.com/acme/app/pull/12'))
  assert.equal(lines[2], 'Agent: Review the diff → No blocking findings. Two nits.')
  assert.equal(lines[3], 'Read app.ts')
  // The planner keeps reading calls without what they gave back.
  assert.equal(happenedFrom(turn)[1]?.text, 'gh pr create')
})
