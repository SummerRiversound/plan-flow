// The running step for a surface that draws pictures (the desktop app, the editor):
// a turning arc and a bright band moving over the title, animated by the picture
// itself. Redrawing for each frame there rebuilds the picture and it blinks, so the
// picture moves on its own and `now` only sets where the motion stands when it is
// rebuilt (by the one-second redraw), so it carries on instead of starting over.

// One terminal cell and one row in the picture's pixels, beside monospaced Text.
// shortcut: guessed from a 13px monospaced face; measure on the desktop app if rows do not line up.
export const CELL_PX = 8
export const ROW_PX = 18
const SPIN_S = 1
const SWEEP_S = 2

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// `cells` is the title's width in terminal cells; the picture is two cells wider for the mark.
export const liveSvg = (title: string, cells: number, now: number): { source: string; width: number; height: number } => {
  const width = (cells + 2) * CELL_PX
  const textW = Math.max(1, cells * CELL_PX)
  const spinAt = (-((now / 1000) % SPIN_S)).toFixed(2).replace('-0.00', '0.00')
  const sweepAt = (-((now / 1000) % SWEEP_S)).toFixed(2).replace('-0.00', '0.00')
  const band = 3 * CELL_PX
  const mid = CELL_PX / 2 + 1
  const words = `<text x="${2 * CELL_PX}" y="13" textLength="${textW}" lengthAdjust="spacingAndGlyphs">${esc(title)}</text>`
  // Light and dark follow the viewer's scheme; the picture cannot read the app's theme keys.
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${ROW_PX}" viewBox="0 0 ${width} ${ROW_PX}">` +
    '<style>text{font:700 13px ui-monospace,Menlo,monospace}.b{fill:#6b6760}.h{fill:#111}.m{stroke:#111}' +
    '@media (prefers-color-scheme:dark){.b{fill:#9a968f}.h{fill:#fff}.m{stroke:#e8e6e3}}</style>' +
    `<defs><clipPath id="s"><rect x="${-band}" y="0" width="${band}" height="${ROW_PX}">` +
    `<animate attributeName="x" from="${-band}" to="${width}" dur="${SWEEP_S}s" begin="${sweepAt}s" repeatCount="indefinite"/></rect></clipPath></defs>` +
    `<circle class="m" cx="${mid}" cy="${ROW_PX / 2}" r="4.5" fill="none" stroke-width="2" stroke-dasharray="18 10" stroke-linecap="round">` +
    `<animateTransform attributeName="transform" type="rotate" from="0 ${mid} ${ROW_PX / 2}" to="360 ${mid} ${ROW_PX / 2}" dur="${SPIN_S}s" begin="${spinAt}s" repeatCount="indefinite"/></circle>` +
    `<g class="b">${words}</g><g class="h" clip-path="url(#s)">${words}</g></svg>`

  return { source, width, height: ROW_PX }
}

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
