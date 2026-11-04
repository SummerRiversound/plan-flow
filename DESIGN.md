---
version: alpha
name: plan-flow terminal
description: A plan drawn as a card flowchart inside Claude Code's terminal, in plain text with two colours that mean something — green for done, red for blocked.
colors:
  success: "#5cc072"
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
  row-done:
    textColor: "{colors.success}"
    typography: "{typography.body}"
---

# plan-flow terminal

## Overview

A plan is drawn in two places: a live tree above the prompt, and a card flowchart in the `/flow` side drawer. It should read like a CI run graph: calm and dense. A row's mark shape is its status: `✓` done, `●` running, `○` waiting, `■` blocked, `–` skipped, `◐` waiting for the person to check. The target drawings are in `docs/design-reference/terminal/`.

## Colors

Two colours, each with one meaning; everything else is plain text or muted. More colours made the board noisy. All are Claude Code theme keys, so light and dark themes follow the user's setting; the hex values are the dark-theme reference.

- **Success (#5cc072, `success`):** done marks and the filled part of the progress bar.
- **Error (#ff6b80, `error`):** a blocked step and its note.
- **Text (#e8e6e3, `text`):** step names, the running mark and the running box's border; bold for buttons, the running step and the plan title.
- **Muted (#9a968f, `inactive`):** waiting and skipped steps, borders, connectors, times.

## Typography

The terminal's own monospace font; only weight varies. Bold marks the running item and the plan title. Hangul takes two cells, everything else one.

## Layout

All sizes are terminal cells. The tree above the prompt fits the rows the engine gives it, folding completed subtrees first. The drawer is 53 columns when docked at 45% of a 120-column terminal; boxes are centred on one axis. Every box on the axis has one width, open or folded: the drawer less 8 cells, or wider if the longest stage title needs it. Side-by-side branches share that width evenly, at least 5 cells apart, so their outer edges line up with the boxes above and below; when a title would not fit, fewer go to a row.

## Elevation & Depth

None. Hierarchy comes from nesting boxes, not shadows.

## Components

- **Stage box:** rounded box, status mark and name on the left, `1/4` or time flush right. Folded shows `▸`, unfolded `▾` with its tasks inside.
- **Running stage box:** border and mark in text colour, name bold; the other boxes' borders are muted.
- **Step rows by status:** a finished step's title steps back dim (its `✓` stays green), a step still to come reads in plain text colour, the running step is bold with its motion; the eye goes from "now" to "next", not to what is behind. In the band and the drawer alike.
- **Progress bar:** up to 24 cells of one heavy line, each half cell a stretch of leaves in plan order: `━` in green where done, `╸` or `╺` for a half cell (text colour for a step waiting on a check), the same `━` dim and muted for the rest. One line weight along the whole bar.
- **Change marks:** a step the latest request added ends in a bold inverted ` new ` badge, one space after its title, so it never reads as part of the title; a step it reopened ends in a bold `↺`.
- **Parallel group:** `╭ 동시에` header line inside a box, holding the tasks that run at the same time.
- **Link row:** under a step whose row shows (a leaf, or an open box), one row of short names in text colour, each a hyperlink: `↗ PR #42  ↗ 아티팩트  ↗ LoginPage.tsx`, ending in muted `+N` for links that do not fit. The drawer only; the band above the prompt stays as it is.
- **Check line:** under the progress bar (band) or the head (drawer), bold `◐ 확인할 것 N:` then each step waiting for the person's check with its note, joined by ` · `; absent when there are none, and folded away with the band.
- **Connectors:** `┬`/`┴` on box edges, `▼` into the next box, `╭─┴─╮` for a split and `╰─┬─╯` for a join.
- **Tree above the prompt:** title, a progress line with `done/total · %`, then one row per node: mark, title, `∥ parallel` on a parallel parent, `done/total` flush right on parents, `◂` only on the step up next while nothing runs.
- **Running step:** while Claude works, its mark turns (`⠋⠙⠹…`, a frame each 100 ms) and a bright band three letters wide sweeps its bold title (muted letters, the band in text colour); waiting on the person or between turns it stands still as a bold `●`. In the band and the drawer alike. A surface that draws pictures (the desktop app, the editor) gets a small picture that turns and sweeps by itself instead of redraws, which would make it blink.
- **Drawer head and foot:** the drawer's top stays put while its body scrolls: the band's head (title, progress bar, check line, what Claude is doing), then buttons drawn as buttons — `[ 모두 펼치기 ]`, `[ 모두 접기 ]` from the left and `[ 목록 보기 ]` flush right where the rule ends, a native button on the desktop app — each kept only while it fits, then a muted `┄` rule. In the list the head keeps one button, `[ 흐름도 보기 ]`, flush right in the same place so the switch never moves; a drawer too narrow for the flowchart shows the list with no button. When the body runs past the pane, a muted rule and a foot pin under it: `진행 중인 단계를 따라가는 중 · 휠로 둘러보면 멈춰요` while the window follows the running step, or `따라가기 멈춤` and a `[ 진행 중으로 ]` button once the person scrolls. A body that fits has no foot. At most three buttons in the head; "back to the running step" lives only in the foot. No hotkeys: the buttons are pressed by click or Enter under the focus.
- **Step buttons:** pressing a step's row in the drawer (the flowchart or the list) picks it, and one row of buttons opens under it: `[ 확인했어요 ]` while the step waits for the person's check, then `[ 질문 ]`; pressing the row again closes it. A box's row still folds. 확인했어요 marks the step done and clears its note, and Claude hears of it with the next request; 질문 puts `[step title] ` in the prompt box as a draft, never sending it. The brackets are text, so box walls hold.

## Do's and Don'ts

- Do keep colour to green for done and red for blocked; the running step stands out by weight, not colour.
- Do put the status mark first and the count or time last on every row.
- Do animate only while something runs, and only the running item.
- Don't use literal colors in code; use theme keys. The one exception is the running step's picture on picture surfaces, which cannot read theme keys and follows the viewer's light or dark scheme instead.
- Don't draw icon tiles or subagent strips.
- Don't let the tree above the prompt grow past the rows it is given; fold completed subtrees, then show a window around the current step, with no hint row.
