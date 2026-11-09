// The preview page: every scenario frame at every snapshot size, coloured as the
// terminal draws it. Run: bun scripts/preview.ts > <path>.html, then open it.
declare const console: { log: (text: string) => void }
import { scenarios } from '../hooks/scenarios'
import type { Shot } from '../hooks/snapshot'
import { shots } from '../hooks/snapshot'
import { esc, FONT_LINK, PAGE_STYLE, preBox } from './html'

const pre = (s: Shot): string => preBox(s.view === 'band' ? `입력창 위 ${s.width}칸 × ${s.rows}줄` : `서랍 ${s.width}칸`, s.lines, s.width, s.rows)

const all = shots()
const groups = [...new Map(all.map(s => [`${s.scenario}|${s.label}`, all.filter(x => x.scenario === s.scenario && x.label === s.label)])).values()]
const sections = groups
  .map(g => {
    const first = g[0]
    if (first === undefined) return ''
    return `<section><h2>${esc(first.scenario)}</h2><p>${esc(first.label)}</p>
<div class="row">${g.filter(s => s.view === 'band').map(pre).join('')}</div>
<div class="row">${g.filter(s => s.view === 'drawer').map(pre).join('')}</div></section>`
  })
  .join('\n')

console.log(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>plan-flow 미리보기</title>${FONT_LINK}<style>
${PAGE_STYLE}
</style></head><body><h1>plan-flow 미리보기</h1><p>상황 ${scenarios().length}개 · 입력창 위와 서랍을 크기별로 그린 결과예요. 점선 밑줄은 누를 수 있는 곳이에요.</p>
${sections}</body></html>`)
