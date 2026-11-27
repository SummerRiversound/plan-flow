---
version: alpha
name: plan-flow for Paseo
description: The plan as a card flowchart in Paseo's Explorer, a pill above the composer and a count on the workspace row, drawn with Paseo's own theme so it sits beside Files and Changes as one of them.
colors:
  surface0: "#12151c"
  surface1: "#191d26"
  surface2: "#222733"
  border: "#2c3240"
  foreground: "#e6e8ee"
  foregroundMuted: "#8f96a3"
  accent: "#4c8dff"
  statusWarning: "#d29922"
  statusSuccess: "#3fb950"
  statusDanger: "#f0726a"
typography:
  title:
    fontFamily: Paseo UI
    fontSize: 15px
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: Paseo UI
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
  body-strong:
    fontFamily: Paseo UI
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.45
  small:
    fontFamily: Paseo UI
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
rounded:
  card: 10px
  bracket: 6px
  tag: 10px
spacing:
  panel: 16px
  panel-compact: 12px
  card-x: 10px
  card-y: 6px
  stem: 12px
  stage-gap: 8px
components:
  stage-card:
    backgroundColor: "{colors.surface1}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-x}"
  stage-card-running:
    backgroundColor: "{colors.surface1}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.card}"
  step-done:
    textColor: "{colors.foregroundMuted}"
    typography: "{typography.body}"
  step-detail:
    textColor: "{colors.foregroundMuted}"
    typography: "{typography.small}"
  link:
    textColor: "{colors.accent}"
    typography: "{typography.small}"
  progress-fill:
    backgroundColor: "{colors.statusSuccess}"
  progress-track:
    backgroundColor: "{colors.surface2}"
  blocked-note:
    textColor: "{colors.statusDanger}"
    typography: "{typography.small}"
  your-turn:
    textColor: "{colors.statusWarning}"
    typography: "{typography.small}"
---

# plan-flow for Paseo

## Overview

The plan reads like a CI run graph in a narrow side panel: calm, dense, the stage Claude is on opened and everything else one row. It is the mod's card flowchart (picked on 2026-11-04) drawn as Paseo draws its own panels, so it looks like a sibling of Files and Changes. The rules are in `docs/design-reference/paseo/README.md`.

## Colors

Paseo theme keys only; the hex values above are Paseo's dark theme, shown for reference. Code reads `theme.colors`, so light, dark and plugin themes follow the person's setting.

- **statusSuccess:** done marks and the filled part of the progress bar.
- **statusDanger:** a blocked step's mark and note, and a turn that stopped on an error.
- **statusWarning:** Claude waits on the person: the running step's still dot, "답변 기다림", a permission it waits for, a step to check. Not the accent, which is green in some themes and would read as done.
- **accent:** links.
- **foreground:** step names and the running step; **foregroundMuted:** finished steps, details, counts, labels, the running card's border.
- **surface0** the panel, **surface1** cards, **surface2** the progress track and the line beside tasks that run together; **border** card edges, stems and brackets.

## Typography

Paseo's UI font. Weight marks the running step and the title; nothing is monospaced. The mod's words are kept (동시에, 답변 기다림, 예상, 진행 중) so the mod and the plugin read the same.

## Layout

One column in the Explorer. A thin stem joins the stages; stages that run together sit side by side under a bracket of the same hairline when the panel is wide and there are at most three, otherwise they stack under a `동시에` label (`layout.compact` on phones and narrow windows). Rows that fold reach 44 points with their press slop.

## Elevation & Depth

None. Hierarchy comes from cards, nesting and weight, not shadows.

## Components

- **Head:** title, goal in muted text, a progress bar with `3/13 · 23%`, and one line on what is happening now taken from the agent's own state: running (turning mark and the step), your turn, waiting for a permission, stopped on an error, or done. A warning-coloured line counts the steps waiting for the person's check.
- **Stage card:** a rounded card; mark, name, and on the right the count `1/4` with a chevron. Pressing it folds or unfolds; the panel tab remembers the choice. The stage Claude is on opens on its own, finished stages stay folded, as in the mod.
- **Tasks:** inside an open card under a hairline, indented by their level. Tasks that run together sit behind a line in surface2 with a `동시에` label.
- **Status marks:** done check (success), turning ring while Claude works, still dot (warning) while it waits on the person, cross (danger) for blocked, minus for skipped, eye (warning) for a step to check, empty circle for one still to come.
- **Links:** under a step whose row shows, `PR #42` and short URLs in accent with Paseo's own link arrow; a file path shows its name.
- **Closing card:** once every step is done and Claude summed it up, a card with a success border ends the axis.
- **Expected work:** dashed cards with an `예상` tag after the last stage, never counted.
- **Pill above the composer:** `step · 3/13` beside Tasks and Subagents while the agent's plan has open work; pressing it opens the panel.
- **Workspace row badge:** `3/13` with a list icon for the workspace's newest plan with open work; nothing otherwise.

## Do's and Don'ts

- Do use Paseo theme keys and Paseo's own parts (Icon, ExternalLink, WorkspaceRowBadge, Loading); never a literal colour.
- Do animate only the running step, and only while the agent runs.
- Do show nothing, a loading state or an error rather than a count that may be wrong.
- Don't add sections for questions, stuck work or activity, or time estimates; the panel shows the plan only.
- Don't draw a left-to-right canvas; the panel is narrow.
