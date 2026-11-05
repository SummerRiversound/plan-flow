import { expect, test } from 'claude-code/testing'
import { manifestUrl, newerVersion, runningVersion, staleRelease } from './version'

test('a newer version installed beside the running one asks for a reload', () => {
  expect(newerVersion('0.1.3', ['0.1.3', '0.1.4'])).toEqual({ kind: 'installed', version: '0.1.4' })
  expect(newerVersion('0.1.10', ['0.1.9', '0.1.10'])).toBeNull()
  expect(newerVersion('0.1.4', ['0.1.4', 'tmp', '.DS_Store'])).toBeNull()
})

test('a newer release in the repository, not yet installed, asks for an update', () => {
  expect(newerVersion('0.1.4', ['0.1.4'], '0.1.5')).toEqual({ kind: 'released', version: '0.1.5' })
  expect(newerVersion('0.1.4', ['0.1.4'], '0.1.4')).toBeNull()
  expect(newerVersion('0.1.4', ['0.1.4'], 'not-a-version')).toBeNull()
})

test('an installed update comes first: the reload alone may be all that is left', () => {
  expect(newerVersion('0.1.3', ['0.1.3', '0.1.4'], '0.1.5')).toEqual({ kind: 'installed', version: '0.1.4' })
  expect(newerVersion('0.1.3', ['0.1.3', '0.1.5'], '0.1.5')).toEqual({ kind: 'installed', version: '0.1.5' })
})

test('the running version is the installed folder name; a development copy has none', () => {
  expect(runningVersion('/Users/me/.claude/plugins/cache/plan-flow/plan-flow/0.1.4')).toEqual({ version: '0.1.4', parent: '/Users/me/.claude/plugins/cache/plan-flow/plan-flow' })
  expect(runningVersion('C:\\Users\\me\\.claude\\plugins\\cache\\plan-flow\\plan-flow\\0.1.4')?.version).toBe('0.1.4')
  expect(runningVersion('/Users/me/Develop/plan-flow')).toBeNull()
  expect(runningVersion('/Users/me/.claude/dev-mods/abc/plan-flow')).toBeNull()
})

test('the repository is asked for its manifest on its default branch, GitHub only', () => {
  expect(manifestUrl('https://github.com/SummerRiversound/plan-flow')).toBe('https://raw.githubusercontent.com/SummerRiversound/plan-flow/HEAD/.claude-plugin/plugin.json')
  expect(manifestUrl('https://github.com/SummerRiversound/plan-flow.git')).toBe('https://raw.githubusercontent.com/SummerRiversound/plan-flow/HEAD/.claude-plugin/plugin.json')
  expect(manifestUrl('https://gitlab.com/a/b')).toBeUndefined()
  expect(manifestUrl(undefined)).toBeUndefined()
})

test('the repository is asked at most once a day', () => {
  const day = 24 * 60 * 60 * 1000
  expect(staleRelease(undefined, 0)).toBe(true)
  expect(staleRelease({ checkedAt: 0 }, day - 1)).toBe(false)
  expect(staleRelease({ checkedAt: 0, version: '0.1.4' }, day)).toBe(true)
})
