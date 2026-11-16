# Terminal look

Target drawing for the `/flow` drawer: `pane.txt` (53 columns, Hangul = 2 cells). It is the `ko session#2 drawer 53` snapshot; every view, width and language is in `hooks/snapshots.data.ts`.

## Rules

1. One chapter per request: number, mark (`✓` done, `○` not done, `◐` the latest waits on you, a turning mark while Claude works), title. No times, no progress bar.
2. The band above the prompt shows the subject, the goal, the latest three chapters with `→ result`, the latest one's receipts and links, what Claude is doing, and what is left by who moves next.
3. The drawer lists every chapter, oldest first, with its request, result, receipts and links; what waits on you is gathered under the head, and the latest chapter lists everything left, the optional and what Claude did not check included.
4. Three colours: green for done, red for an error, the permission colour for what waits on you. Everything else is plain text or muted.
5. Three minutes after an answer with no input, a note framed down its left edge sits above the band until you type.
6. No boxes, flowcharts, icon tiles or timeline bars.
