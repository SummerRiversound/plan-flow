import type { PluginTheme } from '@getpaseo/plugin'
import { Icon } from '@getpaseo/plugin/client/ui'
import { useEffect, useRef } from 'react'
import { Animated, Easing, Platform, View } from 'react-native'
import type { PlanStatus } from '../shared/types'

export const MARK_SIZE = 14

// A ring that turns while Claude is on the step: motion, not colour, marks the running step.
function Spinner({ color }: { color: string }) {
  const turn = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }))
    loop.start()
    return () => loop.stop()
  }, [turn])
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Icon name="LoaderCircle" size={MARK_SIZE} color={color} />
    </Animated.View>
  )
}

// `live`: Claude is at work. A running step while Claude waits on the person shows a still dot in the
// warning colour; the accent is green in some themes and would read as done.
export function StatusMark({ status, live, theme }: { status: PlanStatus; live: boolean; theme: PluginTheme }) {
  const c = theme.colors
  const icon =
    status === 'in_progress' ? (live ? null : { name: 'CircleDot', color: c.statusWarning })
    : status === 'completed' ? { name: 'CircleCheck', color: c.statusSuccess }
    : status === 'blocked' ? { name: 'CircleX', color: c.statusDanger }
    : status === 'skipped' ? { name: 'CircleMinus', color: c.foregroundMuted }
    : status === 'needs_check' ? { name: 'Eye', color: c.statusWarning }
    : { name: 'Circle', color: c.foregroundMuted }

  return (
    <View style={{ width: MARK_SIZE, height: MARK_SIZE, marginTop: 2, alignItems: 'center', justifyContent: 'center' }}>
      {icon === null ? <Spinner color={c.foreground} /> : <Icon name={icon.name} size={MARK_SIZE} color={icon.color} />}
    </View>
  )
}
