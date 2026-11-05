// Pictures for surfaces that draw them (the desktop app, the editor). They cannot read the
// app's theme keys, so light and dark follow the viewer's scheme.
const SPIN_S = 1

// The lines between cards in the drawer: pictures 1200 wide that the surface scales to the
// drawer's width, so a card's middle sits at a fixed fraction of it. `n` cards side by side
// share the width evenly.
const W = 1200
const H = 48
const MID = W / 2
const line = (d: string, h = H): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">` +
  '<style>.l{stroke:#c9c5bd}@media (prefers-color-scheme:dark){.l{stroke:#5a5752}}</style>' +
  `<path class="l" d="${d}" fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linecap="round"/></svg>`

const middles = (n: number): number[] => [...Array(n).keys()].map(i => Math.round((W * (2 * i + 1)) / (2 * n)))

// Straight down from one card to the next.
export const trunkSvg = (): string => line(`M${MID} 0 V${H}`)

// From the card above (`trunk`) out to the middle of each card below.
export const splitSvg = (n: number, trunk: boolean): string => {
  const xs = middles(n)
  const bar = n > 1 ? ` M${xs[0]} ${H} V${H / 2} H${xs[n - 1]} V${H}` : ` M${xs[0]} ${H / 2} V${H}`
  const drops = xs.slice(1, -1).map(x => ` M${x} ${H / 2} V${H}`).join('')

  return line(`${trunk ? `M${MID} 0 V${H / 2}` : ''}${bar}${drops}`.trim())
}

// From the middle of each card above back to one line (`trunk`: on to the card below).
export const joinSvg = (n: number, trunk: boolean): string => {
  const xs = middles(n)
  const down = xs.map(x => `M${x} 0 V${H / 2}`).join(' ')
  const bar = n > 1 ? ` M${xs[0]} ${H / 2} H${xs[n - 1]}` : ''

  return line(`${down}${bar}${trunk ? ` M${MID} ${H / 2} V${H}` : ''}`)
}

// The drawer head's progress bar: one slot per step in plan order, done in green, waiting
// for a check in the text colour, the rest a muted track, inside one rounded bar.
const BAR_H = 14
export const progressSvg = (slots: ReadonlyArray<'done' | 'check' | 'todo'>): string => {
  const n = Math.max(1, slots.length)
  const runs: Array<{ kind: string; from: number; to: number }> = []
  slots.forEach((k, i) => {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.kind === k) last.to = i + 1
    else runs.push({ kind: k, from: i, to: i + 1 })
  })
  const x = (i: number) => Math.round((W * i) / n)
  const rects = runs
    .filter(r => r.kind !== 'todo')
    .map(r => `<rect class="${r.kind === 'done' ? 'd' : 'c'}" x="${x(r.from)}" y="0" width="${x(r.to) - x(r.from)}" height="${BAR_H}"/>`)
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAR_H}" viewBox="0 0 ${W} ${BAR_H}">` +
    '<style>.t{fill:#e6e3dd}.d{fill:#2f9e5b}.c{fill:#1f1e1d}@media (prefers-color-scheme:dark){.t{fill:#3a3834}.d{fill:#4cc27a}.c{fill:#e8e6e3}}</style>' +
    `<defs><clipPath id="r"><rect width="${W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>` +
    `<g clip-path="url(#r)"><rect class="t" width="${W}" height="${BAR_H}"/>${rects}</g></svg>`
  )
}

// The running step on a surface with its own type: only the turning mark, the title stays
// text beside it in the app's face.
const SPIN_PX = 14
export const spinSvg = (now: number): string => {
  const at = (-((now / 1000) % SPIN_S)).toFixed(2).replace('-0.00', '0.00')
  const c = SPIN_PX / 2

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SPIN_PX}" height="${SPIN_PX}" viewBox="0 0 ${SPIN_PX} ${SPIN_PX}">` +
    '<style>.m{stroke:#1f1e1d}@media (prefers-color-scheme:dark){.m{stroke:#e8e6e3}}</style>' +
    `<circle class="m" cx="${c}" cy="${c}" r="5" fill="none" stroke-width="2" stroke-dasharray="20 12" stroke-linecap="round">` +
    `<animateTransform attributeName="transform" type="rotate" from="0 ${c} ${c}" to="360 ${c} ${c}" dur="${SPIN_S}s" begin="${at}s" repeatCount="indefinite"/></circle></svg>`
  )
}
