# plan-flow

A Claude Code mod that draws the current plan inside Claude Code: a live plan tree above the prompt, and a card flowchart in a side drawer where each box expands to its tasks and checkpoints.

## Decisions

- 2026-11-04 — Built into Claude Code as a mod, not a separate browser window: "화면을 따로띄우기보다 아예 mods 같은걸로내장할수있으면 더 좋긴할것같고".
- 2026-11-04 — The repo never says where code or ideas came from: no source names in code, comments, docs or commit messages ("우리레포에는 어디서 가져왔는지에대한거 싹지워"). No code is copied from other projects; it is written here, so `LICENSE` carries only our own copyright.
- 2026-11-04 — Two views: the plan tree above the prompt while a plan runs, and the card flowchart in a side drawer opened with `/flow`.
- 2026-11-04 — The flow supports branches and joins (parallel steps), not only a straight line.
- 2026-11-04 — Three nested levels, all drawn: stages → tasks → checkpoints ("두개가 별개인게아니라 하이라키구조"). Above the prompt the tree shows the levels, folding completed subtrees when rows run short; the drawer shows every level as boxes, and expanding a box goes one level down.
- 2026-11-04 — Whether the plan appears on its own when it starts, or only after `/flow`, is a user setting.
- 2026-11-04 — The drawer's look is the card flowchart (picked from three mockups): rounded stage boxes joined by `▼`, splits and joins drawn as connectors, one orange accent on the running item. `DESIGN.md` holds the tokens; `docs/design-reference/terminal/` holds the target drawing.
- 2026-11-04 — Parallel work is a `parallel` group inside the plan tree (series-parallel only), not free "depends on" links: it matches the card drawing and needs no graph layout engine.
- 2026-11-04 — Progress: one full plan send, then short updates by node id, plus a `next` op.
- 2026-11-04 — The plan comes only from Claude calling the mod's tool. Plan-mode markdown and TodoWrite are not read in v0.1.
- 2026-11-04 — Blocking edits until a plan exists is a setting, off by default.
