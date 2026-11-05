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
- **Muted (#9a968f, `inactive`):** waiting and skipped steps, borders, connectors, counts.

## Typography

The terminal's own monospace font; only weight varies. Every label comes in English and Korean; the Korean ones are quoted here. Bold marks the running item and the plan title. Hangul takes two cells, everything else one.

## Layout

All sizes are terminal cells. The tree above the prompt fits the rows the engine gives it, folding completed subtrees first. The drawer is 53 columns when docked at 45% of a 120-column terminal; boxes are centred on one axis. Every box on the axis has one width, open or folded: the drawer less 8 cells, or wider if the longest stage title needs it. Side-by-side branches share that width evenly, at least 5 cells apart, so their outer edges line up with the boxes above and below; when a title would not fit, fewer go to a row.

## Elevation & Depth

None. Hierarchy comes from nesting boxes, not shadows.

## Components

- **Stage box:** rounded box, status mark and name on the left, `1/4` flush right; no step shows how long it took. Folded shows `▸`, unfolded `▾` with its tasks inside.
- **Running stage box:** border and mark in text colour, name bold; the other boxes' borders are muted.
- **Step rows by status:** a finished step's title steps back dim (its `✓` stays green), a step still to come reads in plain text colour, the running step is bold with its motion; the eye goes from "now" to "next", not to what is behind. In the band and the drawer alike.
- **Progress bar:** up to 24 cells of one heavy line, each half cell a stretch of leaves in plan order: `━` in green where done, `╸` or `╺` for a half cell (text colour for a step waiting on a check), the same `━` dim and muted for the rest. One line weight along the whole bar.
- **Change marks:** a step the latest request reopened ends in a bold `↺`; a step it added carries no mark.
- **Parallel group:** a closed muted box inside a stage box, `╭ 동시에 ─╮` on top and `╰─╯` under it, holding the tasks that run at the same time; every row inside, a long note included, wraps within its borders.
- **Link row:** under a step whose row shows (a leaf, or an open box), one row of short names in text colour, each a hyperlink: `↗ PR #42  ↗ 아티팩트  ↗ LoginPage.tsx`, ending in muted `+N` for links that do not fit. The drawer only; the band above the prompt stays as it is.
- **Check line:** under the progress bar (band) or the head (drawer), bold `◐ 확인할 것 N:` then each step waiting for the person's check with its note, joined by ` · `; absent when there are none, and folded away with the band.
- **Connectors:** `┬`/`┴` on box edges, `▼` into the next box, `╭─┴─╮` for a split and `╰─┬─╯` for a join.
- **Tree above the prompt:** title, the plan's goal in one muted row (cut with `…`; it stays when the band folds), a progress line with `done/total · %` and no elapsed time, then one row per node: mark, title, `∥ parallel` on a parallel parent, `done/total` flush right on parents, `◂` only on the step up next while nothing runs.
- **Band title and buttons:** the band's title ends in a muted `▴` (open) or `▾` (folded), and pressing the title or its arrow folds or unfolds the band; there is no fold button. `[ 흐름도 보기 ▸ ]` sits at the right edge of the title line as the band's main action: a primary button, in the accent colour in the terminal and the app's own primary button on the desktop; the title gives way to it. The band sits above every other plugin's band above the prompt.
- **Running step:** while Claude works, its mark turns (`⠋⠙⠹…`, a frame each 100 ms) and a bright band three letters wide sweeps its bold title (muted letters, the band in text colour); waiting on the person or between turns it stands still as a bold `●`. In the band and the drawer alike. On the desktop app and the editor the title stays text in the app's type and only a small turning circle beside it is a picture, which turns by itself instead of redraws that would make it blink.
- **Drawer head and foot:** the drawer's top stays put while its body scrolls: the band's head (title, the goal wrapped to three muted rows at most, progress bar, check line, what Claude is doing), then buttons drawn as buttons — `[ 모두 펼치기 ]`, `[ 모두 접기 ]` from the left and `[ 목록 보기 ]` flush right where the rule ends, a native button on the desktop app — each kept only while it fits, then a muted `┄` rule. In the list the head keeps one button, `[ 흐름도 보기 ]`, flush right in the same place so the switch never moves; a drawer too narrow for the flowchart shows the list with no button. When the body runs past the pane, it gets half a window of blank rows above and below, so following keeps the running step in the middle even near either end; a finished plan follows to its last row, at the bottom, and a muted rule and a foot pin under it: `진행 중인 단계를 따라가는 중 · 휠로 둘러보면 멈춰요` while the window follows the running step, or `따라가기 멈춤` and a `[ 진행 중으로 ]` button once the person scrolls. A body that fits has no foot. At most three buttons in the head; "back to the running step" lives only in the foot. No hotkeys: the buttons are pressed by click or Enter under the focus.
- **Band and drawer on the desktop app and the editor:** drawn in the app's own type, not monospaced lines: no `├─` guides, no character progress bar. The head: the plan's title (semibold in the band, heading size in the drawer), the goal under it in footnote size, muted (one row in the band, three in the drawer), a slim rounded progress bar picture with one slot per step in plan order (done green, waiting for a check in text colour, the rest a muted track) and `done/total · %` beside it in tabular digits, then the check line and what Claude is doing in footnote size. In the band the title is the fold button with its muted arrow and `흐름도 보기 ▸` is the app's primary button at the right; the band's rows are the terminal's own rows (the same window and folding), each step indented by its level, parents with `done/total` flush right. In the drawer the head ends in native buttons, `모두 펼치기` and `모두 접기` from the left and `목록 보기` at the right. Then the flowchart as real boxes: each stage a card with a faint rounded edge, stronger on the running stage, its title row on a faint fill and its open steps below, one hairline between each row. Edge, fill, hairline and the row a pointer rests on use one neutral grey at low opacity, so the same value reads on the light and the dark theme (no theme key gives a card's fill). A row is the step's mark, its title as a plain button (semibold while it runs, muted once done), then flush right its links as small underlined names and its `done/total ▾` or `진행 중` in footnote size; under it the detail and note in footnote size, muted, the picked step's `확인 완료` and `논의` as native buttons, and its open steps indented with no hairlines; a task that runs with its siblings stays at their level with a small rounded `동시에` pill beside its title. Counts never wrap: the title gives way. Cards side by side stretch to the tallest. Stages are joined by thin lines drawn as pictures that scale to the drawer's width: straight down between two cards, splitting to the middle of each card for stages side by side and joining again under them. The app scrolls the drawer itself: no pinned foot and no following, the step Claude is on takes the focus. `목록 보기` keeps the character tree with its `├─` guides, as in the terminal, under the head in the app's type.
- **Closing note:** once every step is done and Claude has sent its summary, one more box ends the drawer's axis, joined by `▼` at the stages' width: green `✓` and bold `완료 정리`, a muted `┄` rule, then the parts as two columns: bold labels (`목적`, `결과`, `링크`) in one column as wide as the longest, each text wrapped under its own start in text colour, a blank row between parts; the `링크` row holds every link the steps produced. The list ends with the same rows after a blank line. The band above the prompt stays as it is. A step that opens again takes the note away.
- **Step buttons:** pressing a step's row in the drawer (the flowchart or the list) picks it: its whole detail and note show under its row, never cut short, and one row of buttons opens under them: `[ 확인 완료 ]` while the step waits for the person's check, then `[ 논의 ]`; pressing the row again closes it. A box's row still folds. 확인 완료 marks the step done and clears its note, and Claude hears of it with the next request; 논의 puts `[step title] ` in the prompt box as a draft, never sending it. The brackets are text, so box walls hold.

## Do's and Don'ts

- Do keep colour to green for done and red for blocked; the running step stands out by weight, not colour.
- Do put the status mark first and the count or `진행 중` last on every row.
- Do animate only while something runs, and only the running item.
- Don't use literal colors in code; use theme keys. The exceptions are on the desktop app and the editor: the pictures (the turning circle, the progress bar, the lines between cards, the hairlines), which cannot read theme keys and follow the viewer's light or dark scheme, and the cards' edge, fill and pointer highlight, one neutral grey at low opacity that holds on either theme.
- Don't draw icon tiles or subagent strips.
- Don't let the tree above the prompt grow past the rows it is given; fold completed subtrees, then show a window around the current step, with no hint row.
