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
- 2026-11-04 — Changes show as marks on steps (new, redo) and a parked list; a change log waits until it proves needed. The new mark is an inverted ` new ` badge ("새로 라고 하지말고 new 이런걸로하자. 그리고 일반 텍스트랑 구분이 잘안돼..").
- 2026-11-04 — Each step has a short title plus a one-sentence detail on what it does and why ("각 항목이 너무 축약되어있어서 뭘하고있는지 이해가잘안되는데.."). Above the prompt the detail shows under the running step; in the drawer, under open boxes and running steps.
- 2026-11-04 — Only two colours: green for done, red for blocked; everything else is plain text or muted ("색이 너무많아서 정신없어진것같다.. 녹색과 붉은색만 남기고 나머지는 흰색을써야하겠는데.."). No accent colour, no per-kind colours.
- 2026-11-04 — The band above the prompt folds to its title and progress-bar lines with a button on its title line ("접기도 있으면좋겠네 진행바행까지만 보이게").
- 2026-11-04 — Steps carry links to what they produced (PR, issue, commit, artifact, file), shown in the drawer as one row of short names that open on click ("해당 단계에서 나온 아티팩트나 github url 등이 있으면 펼칠때 같이 항목아래 보여줄수있나? 근데 너무 복잡하지는않고 적당히 잘보이게"). Claude attaches them; nothing is scraped from tool output.
- 2026-11-04 — Steps only the person can confirm get a "waiting for a check" status (`◐`) that counts as done, gathered on one "확인할 것 N" line under the progress bar; Claude checks its own work right after each change and never plans a catch-all check step for the end ("내가 뭔가 해야하는데 블로커까진 아니고 이런요소들이 계속 남아서 진행율을 안높일것같은데 이거에 대해 좀 구조적으로 접근방식을 바뀌어야하지않을까").
- 2026-11-04 — The running step is drawn, not pointed at: a turning mark and a bright band sweeping its title while Claude works ("진행중인 항목에 그냥 화살표띡 하지말고 그래픽적으로 표현할방법있지않아?", picked from three mockups). The terminal redraws for each frame; the desktop app and editor get a picture that animates itself, and every piece of text is monospaced so the lines hold there too.
- 2026-11-04 — The band above the prompt has no scrolling and no "rows above/below" hint: at most 10 rows, a window around the current step, the rest in the drawer ("위 14줄 아래 1줄을 글로 보여줄 필요도 없을것같고 전체는 흐름도에서 이런소리도 보여줄필요없어보여").
- 2026-11-04 — The drawer pins its head (title, progress, steps to check, buttons to unfold and fold every box) and, when the body runs past the pane, a foot that follows the running step until the person scrolls; "진행 중으로" sits only in the foot ("1이긴한데 진행중으로가 중복되게 있는건 고쳐야할듯 아래에있는게맞을것같은", picked from three mockups). Finished stages start folded; boxes holding the running step or a step to check start open.
- 2026-11-04 — Finished steps step back dim (green `✓` kept), steps still to come read plain, the running step bold ("이미 완료된 항목과 진행중인 항목, 진행예정인 항목이 구분이 다 잘됬으면좋겠는데", picked from three mockups). The progress bar is one heavy line to half a cell, done in green over the same line dimmed ("아까 그냥 같은굴기선 반칸이 낫겠다 너무커진듯").
- 2026-11-04 — A drawer wide enough for the flowchart offers a "목록 보기" button to switch to the list a narrow drawer shows, and back ("서랍이 커져서 흐름도로 볼수있을때에 한정해서, 서랍이 작을때처럼 목록뷰로 토글하는 버튼이 보이면 좋을것같아").
- 2026-11-04 — The drawer's buttons have no hotkeys and are drawn as buttons (`[ 모두 펼치기 ]`) so they read as something to press ("단축키 없애자 잘 동작도안한다. 버튼이란거 알수있게나해줘").
- 2026-11-04 — A step pressed in the drawer offers "확인했어요" (on a step waiting for a check) and "질문", which fills the prompt box as a draft instead of sending ("확인했어요, 질문, 입력창에 초안채우기 가 좋겠다"). Changes the person makes on the board reach Claude with the next request.
- 2026-11-04 — The view switch (목록 보기 / 흐름도 보기) sits flush right in the head so it stays put ("오른쪽으로 정렬시켜서 고정시켜. 위치가 바뀌니까 힘들다").
- 2026-11-04 — Flowchart boxes on one axis share one width, and side-by-side boxes split it evenly ("박스들의 크기가 다 제각각이니까 좀 힘든데 최소 너비를 정해주면 좀 보기편해지지않을까싶어", picked from two mockups).
- 2026-11-04 — Following keeps the running step in the middle of the drawer, with blank margin above and below the body so that holds near either end ("가운데로 두는건 좋은데 그럴수있으려면 상 하단에 패딩이있어야할듯"). "확인했어요" stays on steps waiting for a check only.
