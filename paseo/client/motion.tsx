import { type ReactNode, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform } from 'react-native'

// The panel's motion (paseo/DESIGN.md, Motion): short, decelerating, and none when the person asked
// the system for reduced motion. Plugins get React Native's Animated only, not a layout animation library.
export const MOTION = { fast: 140, base: 220 } as const
const EASE = Easing.bezier(0.2, 0, 0, 1)
// Opacity and transforms run on the native thread where there is one; the web has none.
const NATIVE = Platform.OS !== 'web'

const to = (v: Animated.Value, toValue: number, duration: number, native: boolean) => Animated.timing(v, { toValue, duration, easing: EASE, useNativeDriver: native })

// Whether the person asked the system for reduced motion.
export const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then(v => live && setReduced(v))
      .catch(() => undefined)
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      live = false
      sub?.remove()
    }
  }, [])

  return reduced
}

// `still`: draw at once (reduced motion, or the panel's first frame, which appears whole).
export type Moving = { still: boolean }

// What opens and closes: its height and opacity follow its content, so a box unfolds, folds and grows
// as steps arrive. While it closes it keeps showing what it held, since a folded box comes with none.
export function Collapse({ open, still, children }: Moving & { open: boolean; children: ReactNode }) {
  const kept = useRef<ReactNode>(null)
  if (open) kept.current = children
  const [shown, setShown] = useState(open)
  const height = useRef(new Animated.Value(0)).current
  const opacity = useRef(new Animated.Value(open ? 1 : 0)).current
  const measured = useRef<number | null>(null)
  // Open on the panel's first frame: its first measure is drawn at once.
  const instant = useRef(open && still)

  const run = (h: number, o: number, done?: () => void) => {
    if (still || instant.current) {
      instant.current = false
      height.setValue(h)
      opacity.setValue(o)
      done?.()
      return
    }
    Animated.parallel([to(height, h, MOTION.base, false), to(opacity, o, MOTION.base, false)]).start(({ finished }) => {
      if (finished) done?.()
    })
  }

  useEffect(() => {
    if (open) {
      setShown(true)
      if (measured.current !== null) run(measured.current, 1)
    } else run(0, 0, () => setShown(false))
  }, [open])

  if (!open && !shown) return null

  return (
    <Animated.View style={{ height, opacity, overflow: 'hidden' }}>
      <Animated.View
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
        onLayout={e => {
          measured.current = e.nativeEvent.layout.height
          if (open) run(measured.current, 1)
        }}
      >
        {open ? children : kept.current}
      </Animated.View>
    </Animated.View>
  )
}

// What arrives after the panel's first frame (a new step, a mark that changed) fades in and rises a little.
export function Appear({ still, children }: Moving & { children: ReactNode }) {
  const v = useRef(new Animated.Value(still ? 1 : 0)).current
  useEffect(() => {
    if (!still) to(v, 1, MOTION.base, NATIVE).start()
  }, [])

  return <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>{children}</Animated.View>
}

// A chevron that turns a quarter as its box opens.
export function Turn({ open, still, children }: Moving & { open: boolean; children: ReactNode }) {
  const v = useRef(new Animated.Value(open ? 1 : 0)).current
  useEffect(() => {
    if (still) v.setValue(open ? 1 : 0)
    else to(v, open ? 1 : 0, MOTION.fast, NATIVE).start()
  }, [open])

  return <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) }] }}>{children}</Animated.View>
}

// A bar's fill that slides to its new share.
export function Fill({ pct, still, style }: Moving & { pct: number; style: object }) {
  const v = useRef(new Animated.Value(pct)).current
  useEffect(() => {
    if (still) v.setValue(pct)
    else to(v, pct, MOTION.base, false).start()
  }, [pct])

  return <Animated.View style={[style, { width: v.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]} />
}
