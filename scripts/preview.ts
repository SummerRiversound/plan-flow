// The preview page: every scenario frame at every snapshot size, coloured as the
// terminal draws it. Run: bun scripts/preview.ts > <path>.html, then open it.
declare const console: { log: (text: string) => void }
import { SCENARIOS } from '../hooks/scenarios'
import type { Shot } from '../hooks/snapshot'
import { shots } from '../hooks/snapshot'
import { cells } from '../hooks/width'

// Theme keys to DESIGN.md colours; the accent is the theme's `claude`.
const COLOR: Record<string, string> = { claude: '#d97757', success: '#5cc072', error: '#ff6b80', warning: '#e5b567', inactive: '#9a968f', text: '#e8e6e3' }

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Every non-ASCII character gets a fixed one or two cells, so columns line up whatever the font does with Hangul.
const chars = (t: string): string =>
  [...t].map(ch => (cells(ch) === 2 ? `<span class="w2">${esc(ch)}</span>` : ch > '~' ? `<span class="w1">${esc(ch)}</span>` : esc(ch))).join('')

const pre = (s: Shot): string => {
  const body = s.lines
    .map(line =>
      line
        .map(seg => {
          const style = [
            `color:${COLOR[seg.color ?? 'text'] ?? COLOR.text}`,
            seg.bold === true ? 'font-weight:700' : '',
            seg.dim === true ? 'opacity:.6' : '',
            seg.strike === true ? 'text-decoration:line-through' : '',
            seg.button !== undefined ? 'text-decoration:underline dotted' : '',
          ]
            .filter(x => x !== '')
            .join(';')
          return `<span style="${style}">${chars(seg.text)}</span>`
        })
        .join(''),
    )
    .join('\n')
  const size = s.view === 'band' ? `입력창 위 ${s.width}칸 × ${s.rows}줄` : `서랍 ${s.width}칸`

  return `<figure><figcaption>${size}</figcaption><pre style="width:${s.width}ch;${s.rows === undefined ? '' : `height:${s.rows * 1.35}em`}">${body}</pre></figure>`
}

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
<title>plan-flow 미리보기</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Gothic+Coding:wght@400;700&display=swap"><style>
body{background:#0f0e0d;color:#e8e6e3;font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 2px}p{color:#9a968f;margin:0 0 12px}
.row{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;margin-bottom:16px}
figure{margin:0}figcaption{color:#9a968f;font-size:12px;margin-bottom:4px}
pre{font:14px/1.35 Menlo,ui-monospace,"Nanum Gothic Coding",monospace;background:#1a1816;border:1px solid #2c2926;border-radius:6px;padding:8px 10px;margin:0;overflow:hidden;box-sizing:content-box;white-space:pre}
.w2{display:inline-block;width:2ch;text-align:center}.w1{display:inline-block;width:1ch;text-align:center}
</style></head><body><h1>plan-flow 미리보기</h1><p>상황 ${SCENARIOS.length}개 · 입력창 위와 서랍을 크기별로 그린 결과예요. 점선 밑줄은 누를 수 있는 곳이에요.</p>
${sections}</body></html>`)
