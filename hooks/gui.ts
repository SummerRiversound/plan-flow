// Pictures for surfaces that draw them (the desktop app, the editor). They cannot read the
// app's theme keys, so light and dark follow the viewer's scheme.
const SPIN_S = 1

// The current chapter's title while Claude works: muted words with a bright band sweeping across,
// a picture that moves by itself, since redrawing text each frame there would make it blink. `now`
// sets where the sweep stands when the picture is rebuilt, so it carries on instead of starting over.
// shortcut: the width is guessed from the title's terminal cells at a 13px face; measure on the app if the sweep stops short.
const SWEEP_S = 2
const CELL_PX = 7
const ROW_PX = 18
const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const sweepSvg = (title: string, cells: number, now: number): { source: string; width: number; height: number } => {
  const width = cells * CELL_PX + 4
  const band = 3 * CELL_PX
  const at = (-((now / 1000) % SWEEP_S)).toFixed(2).replace('-0.00', '0.00')
  const words = `<text x="0" y="13">${esc(title)}</text>`
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${ROW_PX}" viewBox="0 0 ${width} ${ROW_PX}">` +
    '<style>text{font:600 13px system-ui,-apple-system,sans-serif}.b{fill:#8a867f}.h{fill:#111}@media (prefers-color-scheme:dark){.b{fill:#9a968f}.h{fill:#fff}}</style>' +
    `<defs><clipPath id="s"><rect x="${-band}" y="0" width="${band}" height="${ROW_PX}">` +
    `<animate attributeName="x" from="${-band}" to="${width}" dur="${SWEEP_S}s" begin="${at}s" repeatCount="indefinite"/></rect></clipPath></defs>` +
    `<g class="b">${words}</g><g class="h" clip-path="url(#s)">${words}</g></svg>`

  return { source, width, height: ROW_PX }
}

// The running chapter's turning mark on a surface with its own type.
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
