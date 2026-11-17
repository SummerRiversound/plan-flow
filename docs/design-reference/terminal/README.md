# Terminal look

Target drawing for the `/flow` drawer: `pane.txt` (53 columns, Hangul = 2 cells). It is the `ko session#2 drawer 53` snapshot; every view, width and language is in `hooks/snapshots.data.ts`.

## Rules

1. One chapter per request. A chapter's mark is its state: green `●` done, `○` not done, `◐` the latest waits on you, a turning mark while Claude works. No times.
2. The band above the prompt opens with a badge for the session's state (`◐ 내 차례 N` on the permission colour, `⠋ 일하는 중`, a green `✓ 끝`), then the subject and the goal, a rail with one node per chapter and their short names, the current chapter with `→ result`, its receipts and links, what Claude is doing, what waits on you under a bar in the permission colour, and what Claude and others do next folded into one muted line each.
3. The drawer draws every chapter, oldest first, as a dot on one line down the left, with its request, result, receipts and links beside the line; what waits on you is gathered under the head, and what is left branches off the current chapter, each with a tag saying whose it is.
4. Three colours: green for done, red for an error, the permission colour for what waits on you. Everything else is plain text or muted.
5. Three minutes after an answer with no input, a note framed down its left edge sits above the band until you type.
6. No boxes, flowcharts or icon tiles; the only lines are the band's rail and the drawer's timeline.
