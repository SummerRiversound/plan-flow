# Terminal look

Target drawing for the `/flow` drawer: `pane.txt` (53 columns, Hangul = 2 cells).

## Rules

1. Each row: status mark on the left (`✓` done, `●` running, `○` waiting, `✗` failed), time taken or progress (`1/3`) flush right.
2. The drawer flow runs top to bottom. A split is `┬` with one `▼` per branch, a join is `┴` back into one `▼`.
3. A stage is a rounded box. Folded, it shows only its name and `0/3 ▸`; unfolded (`▾`), its tasks sit inside it and the running task shows its checkpoints. Tasks that run at the same time sit in a `╭ 동시에` group.
4. Only the running item is accented (Claude orange, bold, a slow pulse); done is green, waiting is dim. One accent at a time.
5. Above the prompt: a plan tree (title, progress line, one row per node).
6. No icon tiles, free canvas, subagent strips or timeline bars.
