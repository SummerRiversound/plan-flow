---
version: alpha
name: plan-flow terminal
description: A plan drawn as a card flowchart inside Claude Code's terminal; a mark's shape says where a step stands and its colour says what kind of step it is.
colors:
  explore: "#9664ed"
  build: "#2c82ec"
  verify: "#30a246"
  person: "#bc8514"
  error: "#ff6b80"
  text: "#e8e6e3"
  muted: "#9a968f"
  surface: "#0f0e0d"
typography:
  body:
    fontFamily: terminal monospace
    fontSize: 1em
    fontWeight: 400
    lineHeight: 1
  title:
    fontFamily: terminal monospace
    fontSize: 1em
    fontWeight: 700
    lineHeight: 1
spacing:
  cell: 1
  box-padding: 1
  branch-gap: 5
  pane-columns: 53
omitted:
  - section: rounded
    reason: "Corners are box-drawing characters (╭╮╰╯), not a radius."
components:
  stage-box:
    textColor: "{colors.text}"
    typography: "{typography.body}"
  stage-box-running:
    textColor: "{colors.text}"
    typography: "{typography.title}"
  row-waiting:
    textColor: "{colors.muted}"
    typography: "{typography.body}"
  row-blocked:
    textColor: "{colors.error}"
    typography: "{typography.body}"
  mark-explore:
    textColor: "{colors.explore}"
  mark-build:
    textColor: "{colors.build}"
  mark-verify:
    textColor: "{colors.verify}"
  mark-person:
    textColor: "{colors.person}"
---

# plan-flow terminal

## Overview

A plan is drawn in two places: a live tree above the prompt, and a card flowchart in the `/flow` side drawer. It should read like a CI run graph: calm and dense. A row's mark carries two things at once: its shape is the status (`✓` done, `●` running, `○` waiting, `■` blocked, `–` skipped) and its colour is the kind of step. The target drawings are in `docs/design-reference/terminal/`.

## Colors

Colour means the kind of step, never decoration. The four kinds follow the roles common issue trackers and design systems already give these hues, so they read without a key: purple for looking into something, blue for work in progress, green for checks, amber for "waiting on a person". Each is a fixed hex of mid lightness, so it reads on both themes (at least 4.9:1 on the dark surface, 3.2:1 on white). The rest are Claude Code theme keys and follow the user's light or dark setting.

- **Explore (#9664ed):** reading code, logs or docs to find out how things stand.
- **Build (#2c82ec):** writing or changing code, files or settings.
- **Verify (#30a246):** tests, checks, reviews, looking at the result.
- **Person (#bc8514):** a step only the person can do: sign in, approve, press deploy.
- **Error (#ff6b80, `error`):** a blocked step and its note, whatever its kind.
- **Muted (#9a968f, `inactive`):** waiting items without a kind, skipped steps, borders, connectors, times, the legend's words.
- **Text (#e8e6e3, `text`):** step names; bold for buttons, the running step and the plan title.

A parent with no kind of its own takes the kind all its steps share. A done mark is its kind's colour dimmed. The progress bar fills in the colour of each finished step, so it shows what kind of work is behind. A legend line under the drawer's head names only the kinds the plan uses.

## Typography

The terminal's own monospace font; only weight varies. Bold marks the running item and the plan title. Hangul takes two cells, everything else one.

## Layout

All sizes are terminal cells. The tree above the prompt fits the rows the engine gives it, folding completed subtrees first. The drawer is 53 columns when docked at 45% of a 120-column terminal; boxes are centred on one axis and side-by-side branches sit 5 cells apart.

## Elevation & Depth

None. Hierarchy comes from nesting boxes, not shadows.

## Components

- **Stage box:** rounded box, status mark and name on the left, `1/4` or time flush right. Folded shows `▸`, unfolded `▾` with its tasks inside.
- **Running stage box:** border and mark in the step's kind colour, name bold.
- **Parallel group:** `╭ 동시에` header line inside a box, holding the tasks that run at the same time.
- **Connectors:** `┬`/`┴` on box edges, `▼` into the next box, `╭─┴─╮` for a split and `╰─┬─╯` for a join.
- **Tree above the prompt:** title, a progress line with `done/total · %`, then one row per node: mark, title, `∥ parallel` on a parallel parent, `done/total` flush right on parents, `◂` on the current leaf.

## Do's and Don'ts

- Do let colour say only the kind of step; status is the mark's shape.
- Do put the status mark first and the count or time last on every row.
- Do animate only while something runs, and only the running item.
- Don't use literal colors in code beyond the four kind colours; use theme keys.
- Don't draw icon tiles or subagent strips.
- Don't let the tree above the prompt grow past the rows it is given; fold completed subtrees instead.
