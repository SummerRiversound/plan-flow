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

A plan is drawn in two places: a live tree above the prompt, and a card flowchart in the `/flow` side drawer. It should read like a CI run graph: calm and dense. A row's mark shape is its status: `✓` done, `●` running, `○` waiting, `■` blocked, `–` skipped. The target drawings are in `docs/design-reference/terminal/`.

## Colors

Two colours, each with one meaning; everything else is plain text or muted. More colours made the board noisy. All are Claude Code theme keys, so light and dark themes follow the user's setting; the hex values are the dark-theme reference.

- **Success (#5cc072, `success`):** done marks and the filled part of the progress bar.
- **Error (#ff6b80, `error`):** a blocked step and its note.
- **Text (#e8e6e3, `text`):** step names, the running mark and the running box's border; bold for buttons, the running step and the plan title.
- **Muted (#9a968f, `inactive`):** waiting and skipped steps, borders, connectors, times.

## Typography

The terminal's own monospace font; only weight varies. Bold marks the running item and the plan title. Hangul takes two cells, everything else one.

## Layout

All sizes are terminal cells. The tree above the prompt fits the rows the engine gives it, folding completed subtrees first. The drawer is 53 columns when docked at 45% of a 120-column terminal; boxes are centred on one axis and side-by-side branches sit 5 cells apart.

## Elevation & Depth

None. Hierarchy comes from nesting boxes, not shadows.

## Components

- **Stage box:** rounded box, status mark and name on the left, `1/4` or time flush right. Folded shows `▸`, unfolded `▾` with its tasks inside.
- **Running stage box:** border and mark in text colour, name bold; the other boxes' borders are muted.
- **Parallel group:** `╭ 동시에` header line inside a box, holding the tasks that run at the same time.
- **Link row:** under a step whose row shows (a leaf, or an open box), one row of short names in text colour, each a hyperlink: `↗ PR #42  ↗ 아티팩트  ↗ LoginPage.tsx`, ending in muted `+N` for links that do not fit. The drawer only; the band above the prompt stays as it is.
- **Connectors:** `┬`/`┴` on box edges, `▼` into the next box, `╭─┴─╮` for a split and `╰─┬─╯` for a join.
- **Tree above the prompt:** title, a progress line with `done/total · %`, then one row per node: mark, title, `∥ parallel` on a parallel parent, `done/total` flush right on parents, `◂` on the current leaf.

## Do's and Don'ts

- Do keep colour to green for done and red for blocked; the running step stands out by weight, not colour.
- Do put the status mark first and the count or time last on every row.
- Do animate only while something runs, and only the running item.
- Don't use literal colors in code; use theme keys.
- Don't draw icon tiles or subagent strips.
- Don't let the tree above the prompt grow past the rows it is given; fold completed subtrees instead.
