// Drawn lines to HTML, coloured as the terminal draws them; the preview and review pages share it.
import type { Line } from '../hooks/tree'
import { cells } from '../hooks/width'

// Theme keys to DESIGN.md colours; a hex is drawn as it is.
const COLOR: Record<string, string> = { success: '#5cc072', error: '#ff6b80', warning: '#e5b567', inactive: '#9a968f', text: '#e8e6e3' }

export const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Every non-ASCII character gets a fixed one or two cells, so columns line up whatever the font does with Hangul.
const chars = (t: string): string =>
  [...t].map(ch => (cells(ch) === 2 ? `<span class="w2">${esc(ch)}</span>` : ch > '~' ? `<span class="w1">${esc(ch)}</span>` : esc(ch))).join('')

export const linesHtml = (lines: readonly Line[]): string =>
  lines
    .map(line =>
      line
        .map(seg => {
          const style = [
            `color:${seg.color?.startsWith('#') === true ? seg.color : (COLOR[seg.color ?? 'text'] ?? COLOR.text)}`,
            seg.bold === true ? 'font-weight:700' : '',
            seg.dim === true ? 'opacity:.6' : '',
            seg.strike === true ? 'text-decoration:line-through' : '',
            seg.button !== undefined ? 'text-decoration:underline dotted' : '',
          ]
            .filter(x => x !== '')
            .join(';')
          const body = `<span style="${style}">${chars(seg.text)}</span>`
          return seg.href === undefined ? body : `<a href="${esc(seg.href)}" style="text-decoration:underline">${body}</a>`
        })
        .join(''),
    )
    .join('\n')

// A drawn view in a box `width` cells wide, `rows` tall when given.
export const preBox = (caption: string, lines: readonly Line[], width: number, rows?: number): string =>
  `<figure><figcaption>${esc(caption)}</figcaption><pre style="width:${width}ch;${rows === undefined ? '' : `height:${rows * 1.35}em`}">${linesHtml(lines)}</pre></figure>`

export const PAGE_STYLE = `body{background:#0f0e0d;color:#e8e6e3;font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 2px}p{color:#9a968f;margin:0 0 12px}
.row{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;margin-bottom:16px}
figure{margin:0}figcaption{color:#9a968f;font-size:12px;margin-bottom:4px}
pre{font:14px/1.35 Menlo,ui-monospace,"Nanum Gothic Coding",monospace;background:#1a1816;border:1px solid #2c2926;border-radius:6px;padding:8px 10px;margin:0;overflow:hidden;box-sizing:content-box;white-space:pre}
.w2{display:inline-block;width:2ch;text-align:center}.w1{display:inline-block;width:1ch;text-align:center}`

export const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Gothic+Coding:wght@400;700&display=swap">'
