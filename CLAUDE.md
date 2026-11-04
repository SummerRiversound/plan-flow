# plan-flow

A Claude Code mod that draws the current plan inside Claude Code: a live plan tree above the prompt, and a card flowchart in a side drawer where each box expands to its tasks and checkpoints.

## Decisions

- 2026-11-04 — Built into Claude Code as a mod, not a separate browser window: "화면을 따로띄우기보다 아예 mods 같은걸로내장할수있으면 더 좋긴할것같고".
- 2026-11-04 — The repo never says where code or ideas came from: no source names in code, comments, docs or commit messages ("우리레포에는 어디서 가져왔는지에대한거 싹지워"). No code is copied from other projects; it is written here, so `LICENSE` carries only our own copyright.
- 2026-11-04 — Two views: the plan tree above the prompt while a plan runs, and the card flowchart in a side drawer opened with `/flow`.
- 2026-11-04 — The flow supports branches and joins (parallel steps), not only a straight line.
- 2026-11-04 — Three nested levels, all drawn: stages → tasks → checkpoints ("두개가 별개인게아니라 하이라키구조"). Above the prompt the tree shows the levels, folding completed subtrees when rows run short; the drawer shows every level as boxes, and expanding a box goes one level down.
- 2026-11-04 — Whether the plan appears on its own when it starts, or only after `/flow`, is a user setting.
- 2026-11-04 — The drawer's look is the card flowchart (picked from three mockups): rounded stage boxes joined by `▼`, splits and joins drawn as connectors. `DESIGN.md` holds the tokens; `docs/design-reference/terminal/` holds the target drawing.
- 2026-11-04 — Parallel work is a `parallel` group inside the plan tree (series-parallel only), not free "depends on" links: it matches the card drawing and needs no graph layout engine.
- 2026-11-04 — Progress: one full plan send, then short updates by node id, plus a `next` op.
- 2026-11-04 — The plan comes only from Claude calling the mod's tool. Plan-mode markdown and TodoWrite are not read in v0.1.
- 2026-11-04 — Blocking edits until a plan exists is a setting, off by default.
- 2026-11-04 — The board follows the session's work, not each prompt: "프롬프트 하나에 만드는게 아니라 작업의 설계를 잘해주고 관리해줘서 사용자가 해당 세션의 흐름을 항상 직관적으로 이해할수있도록". Continuing work adds steps to the current plan; a detour parks it and it comes back when the detour ends; starting over cancels it. A new plan over open work must say whether the old one is parked or cancelled.
- 2026-11-04 — Claude classifies each request (a note on every prompt while a plan exists), not a separate model call.
- 2026-11-04 — Unrelated work: Claude suggests a fresh session first and parks only if the person stays.
- 2026-11-04 — Park or cancel without asking when the request is clear; ask only when the case is ambiguous.
- 2026-11-04 — Changes show as marks on steps (new, redo) and a parked list; a change log waits until it proves needed.
- 2026-11-04 — Each step has a short title plus a one-sentence detail on what it does and why ("각 항목이 너무 축약되어있어서 뭘하고있는지 이해가잘안되는데.."). Above the prompt the detail shows under the running step; in the drawer, under open boxes and running steps.
- 2026-11-04 — No single accent colour. A mark's shape is the step's status and its colour is the step's kind (explore, build, verify, person), each hue taken from the role reference palettes give it ("단순히 그냥 색이 존재한다기보다 색이 의미를 지니는게 좋을것같아서. 너무 복잡하지 않은 선에서"; "하늘 내가 정한거 primary 컬러로쓰지말고 각 요소의 적절한 색을 레퍼런스찾아서 정해줘"). Blocked stays the theme's error colour.
