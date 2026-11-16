// Pictures for surfaces that draw them (the desktop app, the editor). They cannot read the
// app's theme keys, so light and dark follow the viewer's scheme.
const SPIN_S = 1

// The running chapter on a surface with its own type: only the turning mark, the title stays
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
