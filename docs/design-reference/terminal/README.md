# Terminal look

Target drawing for the `/flow` drawer: `pane.txt` (53 columns, Hangul = 2 cells). It is the `basic drawer 53` snapshot; every view and width is in `hooks/snapshots.data.ts`.

## Rules

1. Each row: status mark on the left (`✓` done, `●` running, `○` waiting, `■` blocked, `–` skipped, `◐` waiting for the person's check), progress (`1/3`) flush right. No times.
2. The drawer flow runs top to bottom. A split is `┬` with one `▼` per branch, a join is `┴` back into one `▼`.
3. A stage is a rounded box. Folded, it shows only its name and `0/3 ▸`; unfolded (`▾`), its tasks sit inside it and the running task shows its checkpoints. Tasks that run at the same time sit in a `╭ 동시에` group.
4. Two colours only: green for done, red for blocked. The running step stands out by weight and motion, not colour.
5. Above the prompt: a plan tree (title, goal, the plans this session finished on one muted row, progress line, one row per node).
6. No icon tiles, free canvas, subagent strips or timeline bars.
7. The plans a session finished are listed at the top of the drawer's body, each a separate piece of work with no line to the plan in hand; the parked ones at the bottom.
