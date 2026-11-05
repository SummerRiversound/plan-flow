// One pressable row of the desktop drawer, drawn as a Client so a press anywhere on the row
// counts, not only on its title: the step's mark and title, the 동시에 pill, and its count at
// the right edge. A click or Enter posts `{ press: id }`; the hooks module does the rest.
import type { ClientModule } from 'claude-code'

export type StepRowProps = {
  id: string
  // The list's tree guides (`│  ├─ `), drawn monospaced at the row's start so they line up row to row.
  guide: string | null
  // The status mark before the title; null where a turning picture stands beside the row.
  mark: { text: string; color: string } | null
  title: string
  strong: boolean
  muted: boolean
  strike: boolean
  redo: boolean
  pill: string | null
  right: { text: string; color: string } | null
  // The row's fill under the pointer.
  hover: string
  edge: string
}

const StepRow: ClientModule<StepRowProps, { over: boolean }> = (p, surface) => {
  const { Box, Text } = surface.elements
  surface.onPointer(e => {
    if (e.type === 'enter' || e.type === 'leave') surface.setState({ over: e.type === 'enter' })
    if (e.type === 'up' && e.button === 'left') surface.post({ press: p.id })
  })
  surface.onKey(k => {
    if (k.key === 'return' || k.key === ' ') surface.post({ press: p.id })
  })

  return (
    <Box flexDirection="row" alignItems="center" gap="xs" backgroundColor={surface.state?.over === true ? p.hover : undefined}>
      {p.guide === null ? null : (
        <Text mono color="inactive">
          {p.guide}
        </Text>
      )}
      <Text weight={p.strong ? 'semibold' : undefined} color={p.muted ? 'inactive' : undefined} strikethrough={p.strike ? true : undefined}>
        {p.mark === null ? null : <Text color={p.mark.color}>{p.mark.text} </Text>}
        {p.title}
        {p.redo ? ' ↺' : ''}
      </Text>
      {p.pill === null ? null : (
        <Box borderStyle="round" borderColor={p.edge} paddingX="xs" flexShrink={0}>
          <Text size="caption" color="inactive">
            {p.pill}
          </Text>
        </Box>
      )}
      <Box flexGrow={1} />
      {p.right === null ? null : (
        <Box flexShrink={0}>
          <Text size="footnote" tabular color={p.right.color}>
            {p.right.text}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export default StepRow
