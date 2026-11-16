// The preview page: every demo frame at every snapshot size, in Korean and English, coloured as the
// terminal draws it; the desktop shots list their rows by kind. Run: bun scripts/preview.ts > <path>.html, then open it.
declare const console: { log: (text: string) => void }
import type { Shot } from '../hooks/snapshot'
import { shots, shotText } from '../hooks/snapshot'
import { esc, FONT_LINK, PAGE_STYLE, preBox } from './html'

const pre = (s: Shot): string =>
  s.width === undefined
    ? `<figure><figcaption>${s.view === 'band' ? '데스크톱 입력창 위' : '데스크톱 서랍'} (줄 종류 | 내용)</figcaption><pre>${esc(shotText(s))}</pre></figure>`
    : preBox(s.view === 'band' ? `입력창 위 ${s.width}칸 × ${s.rows}줄` : `서랍 ${s.width}칸`, s.lines.map(r => [{ text: ' '.repeat(r.indent) }, ...r.line]), s.width, s.rows)

const all = shots()
const groups = [...new Map(all.map(s => [`${s.language}|${s.scenario}|${s.label}`, all.filter(x => x.language === s.language && x.scenario === s.scenario && x.label === s.label)])).values()]
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
</style></head><body><h1>plan-flow 미리보기</h1><p>시연 장면 ${groups.length}개 · 입력창 위와 서랍을 크기별로 그린 결과예요. 점선 밑줄은 누를 수 있는 곳이에요.</p>
${sections}</body></html>`)
