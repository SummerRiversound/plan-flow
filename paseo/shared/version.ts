// Whether this session runs the newest plan-flow: against the versions installed beside it,
// and against the one its repository offers. Pure; the wiring reads the folders and the network.

export type Newer = { kind: 'installed' | 'released'; version: string }
// What the last look at the repository found, kept across sessions.
export type ReleaseCheck = { checkedAt: number; version?: string }

const DAY_MS = 24 * 60 * 60 * 1000

const parts = (v: string): number[] | null => (/^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null)
const isVersion = (v: string): boolean => parts(v) !== null
const compare = (a: string, b: string): number => {
  const x = parts(a) ?? []
  const y = parts(b) ?? []
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }

  return 0
}
const highest = (vs: readonly string[]): string | undefined => vs.filter(isVersion).sort(compare).at(-1)

// An update already installed comes first: a reload is all it needs.
export const newerVersion = (running: string, installed: readonly string[], released?: string): Newer | null => {
  const top = highest(installed)
  if (top !== undefined && compare(top, running) > 0) return { kind: 'installed', version: top }
  if (released !== undefined && isVersion(released) && compare(released, highest([running, ...installed]) ?? running) > 0) return { kind: 'released', version: released }

  return null
}

// An installed copy sits in a folder named for its version; a --plugin-dir or development copy does not.
export const runningVersion = (root: string): { version: string; parent: string } | null => {
  const cut = Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'))
  const version = root.slice(cut + 1)

  return cut > 0 && isVersion(version) ? { version, parent: root.slice(0, cut) } : null
}

// The manifest on the repository's default branch: the version an update would install.
export const manifestUrl = (repository: string | undefined): string | undefined => {
  const m = repository === undefined ? null : /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/.exec(repository)

  return m === null ? undefined : `https://raw.githubusercontent.com/${m[1]}/${m[2]}/HEAD/.claude-plugin/plugin.json`
}

export const staleRelease = (last: ReleaseCheck | undefined, now: number): boolean => last === undefined || now - last.checkedAt >= DAY_MS
