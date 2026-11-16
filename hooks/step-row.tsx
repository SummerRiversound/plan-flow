// The band's title row on the desktop app, drawn as a Client so a press anywhere on the row
// folds the band, not only on its words. A click or Enter posts `{ press: id }`; the hooks
// module does the rest.
import type { ClientModule } from 'claude-code'

export type StepRowProps = {
  id: string
  title: string
  // Muted text right after the title: the fold arrow.
  after: string | null
  // The row's fill under the pointer.
  hover: string
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
      <Text weight="semibold">
        {p.title}
        {p.after === null ? null : <Text color="inactive"> {p.after}</Text>}
      </Text>
      <Box flexGrow={1} />
    </Box>
  )
}

export default StepRow
