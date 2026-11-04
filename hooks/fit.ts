// Fitting the tree above the prompt into the rows it is given. Only the current path
// is unfolded: every subtree off it stays folded. If that still does not fit, rows
// give way by priority (the current path, then the stages) and a last line counts
// what is hidden.
import type { Plan, PlanNode } from './plan'
import { currentLeaf, hasChildren, runningLeaves } from './plan'

export type FitRow<L> = { line: L; node: PlanNode }

// The ids that must stay in view: the leaves being worked on and every parent above them.
export const currentPath = (plan: Plan): Set<string> => {
  const leaves = [...runningLeaves(plan)]
  const current = currentLeaf(plan)
  if (current !== null && !leaves.includes(current)) leaves.push(current)
  const ids = new Set<string>()
  for (const leaf of leaves) {
    const parts = leaf.id.split('.')
    for (let i = 1; i <= parts.length; i++) ids.add(parts.slice(0, i).join('.'))
  }

  return ids
}

// The parents folded above the prompt: every one off the current path.
export const foldedParents = (plan: Plan): Set<string> => {
  const path = currentPath(plan)

  return new Set(plan.nodes.filter(n => hasChildren(plan.nodes, n.id) && !path.has(n.id)).map(n => n.id))
}

// `rowsFor(folded)` draws the tree with the children of every id in `folded` hidden;
// `overflow(hidden)` draws the line that counts what was left out.
export const fitRows = <L>(
  plan: Plan,
  budget: number,
  rowsFor: (folded: ReadonlySet<string>) => FitRow<L>[],
  overflow: (hidden: readonly PlanNode[]) => L,
): L[] => {
  if (budget <= 0) return []
  const path = currentPath(plan)
  const rows = rowsFor(foldedParents(plan))
  if (rows.length <= budget) return rows.map(r => r.line)
  if (budget === 1) return [overflow(rows.map(r => r.node))]
  const rank = (r: FitRow<L>): number => (path.has(r.node.id) ? 0 : r.node.parentId === null ? 1 : 2)
  const kept = new Set(
    rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
      .slice(0, budget - 1)
      .map(x => x.r),
  )

  return [...rows.filter(r => kept.has(r)).map(r => r.line), overflow(rows.filter(r => !kept.has(r)).map(r => r.node))]
}
